import { errorMessage } from '@/services/errors';
import type { WorkerService } from '@/services/types';
import { ACTIVATION_RULES } from '@/services/activationRules';
import type { DeviceTelemetry, WorkerIdentity, WorkerResultReport } from '@/types';

import { forgetIdentity, installationId, loadIdentity, saveIdentity, type CredentialStore } from './credentials';
import { deliverReport, executeActivation, PendingReportError } from './taskExecutor';
import type { UssdCapabilities, UssdExecutor } from './ussd/types';

export type WorkerPhase = 'loading' | 'unpaired' | 'stopped' | 'running';

export type WorkerLogEntry = { id: number; at: string; message: string; tone: 'info' | 'success' | 'warning' | 'danger' };

/** What the worker screen shows. The device token is never part of it. */
export type WorkerState = {
  phase: WorkerPhase;
  device: { id: string; name: string } | null;
  executor: UssdExecutor['kind'];
  capabilities: UssdCapabilities | null;
  lastHeartbeatAt: string | null;
  currentTaskId: string | null;
  pendingReports: number;
  lastError: string | null;
  log: WorkerLogEntry[];
};

type Deps = {
  service: WorkerService;
  executor: UssdExecutor;
  store: CredentialStore;
  appVersion: string;
  telemetry: () => DeviceTelemetry;
  /** Loop tick (ms). */
  tickMs?: number;
};

const MAX_LOG = 50;

/**
 * The Android worker: heartbeat → ask for work → execute one task at a time →
 * report. Runs while the app is in the foreground (a foreground service is
 * needed for background execution — see docs/phase7). It never runs two
 * activations at once and never re-executes a task it may have started.
 */
export class WorkerRuntime {
  private state: WorkerState;
  private readonly listeners = new Set<() => void>();
  private identity: WorkerIdentity | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastHeartbeat = 0;
  private lastPoll = 0;
  private logSeq = 0;
  private readonly pending: { taskId: string; report: WorkerResultReport }[] = [];

  constructor(private readonly deps: Deps) {
    this.state = {
      phase: 'loading',
      device: null,
      executor: deps.executor.kind,
      capabilities: null,
      lastHeartbeatAt: null,
      currentTaskId: null,
      pendingReports: 0,
      lastError: null,
      log: [],
    };
  }

  // ── store (useSyncExternalStore) ──
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<WorkerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private log(message: string, tone: WorkerLogEntry['tone'] = 'info') {
    const entry = { id: ++this.logSeq, at: new Date().toISOString(), message, tone };
    this.set({ log: [entry, ...this.state.log].slice(0, MAX_LOG) });
  }

  // ── lifecycle ──
  async load() {
    const [identity, capabilities] = await Promise.all([loadIdentity(this.deps.store), this.deps.executor.capabilities()]);
    this.identity = identity;
    this.set({
      phase: identity ? 'stopped' : 'unpaired',
      device: identity ? { id: identity.deviceId, name: identity.deviceName } : null,
      capabilities,
    });
  }

  async pair(pairingCode: string) {
    const deviceIdentifier = await installationId(this.deps.store);
    const identity = await this.deps.service.register({ pairingCode, deviceIdentifier, appVersion: this.deps.appVersion });
    await saveIdentity(this.deps.store, identity);
    this.identity = identity;
    this.set({ phase: 'stopped', device: { id: identity.deviceId, name: identity.deviceName }, lastError: null });
    this.log(`Emparelhado como “${identity.deviceName}”.`, 'success');
  }

  /** Forgets the identity on this phone (the backend device stays; re-pair with a new code). */
  async unpair() {
    this.stop();
    await forgetIdentity(this.deps.store);
    this.identity = null;
    this.set({ phase: 'unpaired', device: null, currentTaskId: null, lastHeartbeatAt: null });
  }

  start() {
    if (!this.identity || this.timer) return;
    this.set({ phase: 'running', lastError: null });
    this.log('Worker iniciado.');
    this.lastHeartbeat = 0;
    this.lastPoll = 0;
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? 5_000);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.state.phase === 'running') {
      this.set({ phase: 'stopped' });
      this.log('Worker parado.');
    }
  }

  /** One loop step (exposed for tests). */
  async tick() {
    const identity = this.identity;
    if (!identity || this.busy) return;
    this.busy = true;
    try {
      await this.flushPending(identity);
      const now = Date.now();
      let taskHint: string | null = null;
      if (now - this.lastHeartbeat >= ACTIVATION_RULES.heartbeatIntervalMs) {
        taskHint = await this.heartbeat(identity);
        this.lastHeartbeat = now;
      }
      const capabilities = this.state.capabilities;
      const canExecute = !!capabilities?.ussd && !!capabilities.ussdInteractive;
      if (canExecute && this.pending.length === 0 && (taskHint || now - this.lastPoll >= ACTIVATION_RULES.pollIntervalMs)) {
        this.lastPoll = now;
        await this.runNextTask(identity);
      }
      if (this.state.lastError) this.set({ lastError: null });
    } catch (error) {
      this.set({ lastError: errorMessage(error) });
      this.log(errorMessage(error), 'danger');
    } finally {
      this.busy = false;
    }
  }

  private async heartbeat(identity: WorkerIdentity) {
    const capabilities = await this.deps.executor.capabilities();
    const sims = await this.deps.executor.listSims();
    const result = await this.deps.service.heartbeat(identity, {
      appVersion: this.deps.appVersion,
      capabilities: { ussd: capabilities.ussd, ussdInteractive: capabilities.ussdInteractive, multiSim: capabilities.multiSim, sms: false },
      telemetry: this.deps.telemetry(),
      sims: sims ? sims.map((s) => ({ slotIndex: s.slotIndex, fingerprint: s.fingerprint })) : null,
    });
    this.set({ capabilities, lastHeartbeatAt: result.serverTime });
    return result.taskId;
  }

  private async runNextTask(identity: WorkerIdentity) {
    const payload = await this.deps.service.fetchTask(identity);
    if (!payload) return;
    this.set({ currentTaskId: payload.taskId });
    try {
      const task = await executeActivation(this.deps.service, identity, payload, this.deps.executor, (message) => this.log(message));
      this.log(
        `Tarefa ${task.status === 'SUCCESS' ? 'concluída' : task.status === 'UNKNOWN' ? 'sem confirmação (UNKNOWN)' : task.status === 'QUEUED' ? 'devolvida à fila' : 'falhou'}.`,
        task.status === 'SUCCESS' ? 'success' : task.status === 'UNKNOWN' ? 'warning' : task.status === 'QUEUED' ? 'info' : 'danger'
      );
    } catch (error) {
      if (error instanceof PendingReportError) {
        this.pending.push({ taskId: error.taskId, report: error.report });
        this.set({ pendingReports: this.pending.length });
        this.log('Resultado guardado: será reenviado quando houver ligação. A tarefa não é repetida.', 'warning');
      } else {
        throw error;
      }
    } finally {
      this.set({ currentTaskId: null });
    }
  }

  /** Results that could not be delivered are sent again before any new work. */
  private async flushPending(identity: WorkerIdentity) {
    while (this.pending.length) {
      const [next] = this.pending;
      try {
        await deliverReport(this.deps.service, identity, next.taskId, next.report);
      } catch (error) {
        if (error instanceof PendingReportError) return;
        throw error;
      }
      this.pending.shift();
      this.set({ pendingReports: this.pending.length });
      this.log('Resultado pendente entregue.', 'success');
    }
  }
}
