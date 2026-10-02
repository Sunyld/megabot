import type { ActivationOutcome, ActivationResultCode, UssdTextMatch } from '@/types';

/** What the phone can do right now (reported in the heartbeat). */
export type UssdCapabilities = {
  /** A USSD request can be sent from this app (native module present and allowed). */
  ussd: boolean;
  /** Multi-step menus can be answered (select / input / confirm). Every product flow needs it. */
  ussdInteractive: boolean;
  multiSim: boolean;
  /** Why USSD is not available, for the worker screen. */
  reason?: string;
};

/** A SIM as the phone sees it. `fingerprint` is opaque (computed on the phone, never the ICCID itself). */
export type UssdSimInfo = {
  slotIndex: number;
  fingerprint: string | null;
  carrierName: string | null;
};

/** One step of the execution plan built from the product flow (see plan.ts). */
export type UssdPlanStep =
  | {
      kind: 'send';
      /** What is sent to the network. */
      value: string;
      /** What the trace shows (same as value; kept separate for masking later). */
      display: string;
      /** Text the current screen must show before sending. */
      expect?: UssdTextMatch;
      /** The submission point: sending this step can complete the activation. */
      final: boolean;
    }
  | { kind: 'wait'; ms: number };

export type UssdPlan = {
  start: string;
  steps: UssdPlanStep[];
  success?: UssdTextMatch;
  failure?: UssdTextMatch;
};

export type UssdExecutionRequest = {
  /** Android SIM slot index chosen by the backend. Never another SIM. */
  slotIndex: number;
  /** The SIM the backend expects in that slot (null = not known yet). */
  expectedFingerprint: string | null;
  plan: UssdPlan;
  stepTimeoutMs: number;
  sessionTimeoutMs: number;
  /**
   * Called right before the final step is sent. It reports SUBMITTED to the
   * backend; if it fails, the final step is NOT sent (nothing was activated).
   */
  onBeforeSubmit: () => Promise<void>;
};

export type UssdResult = {
  outcome: ActivationOutcome;
  resultCode: ActivationResultCode;
  /** The last screen shown by the operator. */
  finalResponse: string | null;
  /** "*111# › 5 › 840000001 › 1" — what was actually sent. */
  trace: string;
  /** Whether the final step was sent (after it, failures are not provable without the operator's text). */
  submitted: boolean;
};

/**
 * Executes one activation on the phone network. Implementations:
 *   • AndroidUssdExecutor — real execution through the native module (development / production build)
 *   • MockUssdExecutor    — scripted responses, ONLY in mock mode (never reaches the real backend)
 */
export interface UssdExecutor {
  readonly kind: 'android' | 'mock';
  capabilities(): Promise<UssdCapabilities>;
  /** `null` when the phone cannot read its SIMs (permission / unsupported). */
  listSims(): Promise<UssdSimInfo[] | null>;
  execute(request: UssdExecutionRequest): Promise<UssdResult>;
}

/** Low-level interactive session the runner drives (implemented by the native module or the mock). */
export interface UssdSession {
  /** Sends one reply and returns the next screen text. */
  send(input: string, timeoutMs: number): Promise<string>;
  close(): Promise<void>;
}

/** Error raised by a session / native module, with a structured code. */
export class UssdError extends Error {
  readonly code: 'SIM_UNAVAILABLE' | 'PERMISSION_DENIED' | 'USSD_NOT_SUPPORTED' | 'TIMEOUT' | 'NETWORK_ERROR';

  constructor(code: UssdError['code'], message: string) {
    super(message);
    this.name = 'UssdError';
    this.code = code;
  }
}
