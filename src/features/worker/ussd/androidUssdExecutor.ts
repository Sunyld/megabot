import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { runUssdSession } from './runner';
import { UssdError, type UssdCapabilities, type UssdExecutionRequest, type UssdExecutor, type UssdResult, type UssdSimInfo } from './types';

/**
 * Contract of the native Android module `MegabotUssd` (Kotlin, Expo Modules API).
 * It is NOT part of Expo Go: it needs a development / production build. See
 * docs/phase7/PHASE7_ACTIVATION_ENGINE.md for the implementation plan
 * (TelephonyManager.createForSubscriptionId + an interactive session layer).
 *
 * Errors are rejected with codes: SIM_UNAVAILABLE (slot empty / different SIM),
 * PERMISSION_DENIED, USSD_NOT_SUPPORTED, TIMEOUT, NETWORK_ERROR.
 */
export type MegabotUssdNativeModule = {
  getCapabilities(): Promise<{ ussd: boolean; interactive: boolean; multiSim: boolean; reason?: string }>;
  listSims(): Promise<{ slotIndex: number; fingerprint: string | null; carrierName: string | null }[]>;
  /** Opens a session on exactly this slot; rejects SIM_UNAVAILABLE if the SIM there is not the expected one. */
  openSession(slotIndex: number, expectedFingerprint: string | null, code: string, timeoutMs: number): Promise<{ sessionId: string; text: string }>;
  send(sessionId: string, input: string, timeoutMs: number): Promise<string>;
  close(sessionId: string): Promise<void>;
};

const KNOWN_CODES: UssdError['code'][] = ['SIM_UNAVAILABLE', 'PERMISSION_DENIED', 'USSD_NOT_SUPPORTED', 'TIMEOUT', 'NETWORK_ERROR'];

/** Native rejections → UssdError with a structured code. */
function toUssdError(error: unknown): UssdError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return new UssdError((KNOWN_CODES as string[]).includes(code) ? (code as UssdError['code']) : 'NETWORK_ERROR', message);
}

const NOT_SUPPORTED_REASON =
  'O módulo USSD nativo não está nesta versão da app (Expo Go ou build sem o módulo). O telemóvel não recebe ativações.';

export class AndroidUssdExecutor implements UssdExecutor {
  readonly kind = 'android' as const;
  private readonly native: MegabotUssdNativeModule | null;

  constructor(native: MegabotUssdNativeModule | null = Platform.OS === 'android' ? requireOptionalNativeModule<MegabotUssdNativeModule>('MegabotUssd') : null) {
    this.native = native;
  }

  get available() {
    return this.native !== null;
  }

  async capabilities(): Promise<UssdCapabilities> {
    if (!this.native) return { ussd: false, ussdInteractive: false, multiSim: false, reason: NOT_SUPPORTED_REASON };
    try {
      const caps = await this.native.getCapabilities();
      return { ussd: caps.ussd, ussdInteractive: caps.ussd && caps.interactive, multiSim: caps.multiSim, reason: caps.reason };
    } catch (error) {
      return { ussd: false, ussdInteractive: false, multiSim: false, reason: toUssdError(error).message };
    }
  }

  async listSims(): Promise<UssdSimInfo[] | null> {
    if (!this.native) return null;
    try {
      return await this.native.listSims();
    } catch {
      return null; // no permission to read SIMs: the backend keeps the last known state
    }
  }

  async execute(request: UssdExecutionRequest): Promise<UssdResult> {
    const native = this.native;
    if (!native) {
      return { outcome: 'FAILED', resultCode: 'USSD_NOT_SUPPORTED', finalResponse: null, trace: request.plan.start, submitted: false };
    }
    return runUssdSession(async (start, timeoutMs) => {
      try {
        const opened = await native.openSession(request.slotIndex, request.expectedFingerprint, start, timeoutMs);
        return {
          screen: opened.text,
          session: {
            send: (input, stepTimeoutMs) => native.send(opened.sessionId, input, stepTimeoutMs).catch((error) => Promise.reject(toUssdError(error))),
            close: () => native.close(opened.sessionId),
          },
        };
      } catch (error) {
        throw toUssdError(error);
      }
    }, request);
  }
}
