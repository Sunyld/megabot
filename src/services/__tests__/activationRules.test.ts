import { ACTIVATION_PROTOCOL, type UssdFlow } from '@/types';

import {
  ACTIVATION_RESULT_CODES,
  assertValidDeviceName,
  assertValidSimInput,
  canTaskTransition,
  capabilitiesFromWire,
  capabilitiesToWire,
  classifyUssdResponse,
  heartbeatTimeoutSeconds,
  isAutomaticRetry,
  isDeviceOnline,
  normalizeDecisionNote,
  normalizePairingCode,
  parseActivationPayload,
  TASK_STATUSES,
  telemetryToWire,
  verifyWorkerClaim,
} from '../activationRules';
import { AppError } from '../errors';

/*
 * Same cases as supabase/tests/006_devices_activation.test.sql (section 2):
 * the app's copy of the engine rules must agree with the database, which
 * stays the only authority over task states and retries.
 */

const FLOW: UssdFlow = {
  version: 1,
  start: '*111#',
  steps: [{ type: 'confirm' }],
  success: { contains: ['Sucesso', 'activado'] },
  failure: { contains: ['saldo insuficiente'] },
};

describe('task state machine (mirrors activation_task_transition_allowed)', () => {
  it('has exactly 19 transitions', () => {
    const count = TASK_STATUSES.flatMap((from) => TASK_STATUSES.filter((to) => canTaskTransition(from, to))).length;
    expect(count).toBe(19);
  });

  it.each([
    ['SUCCESS', 'EXECUTING'],
    ['FAILED', 'EXECUTING'],
    ['UNKNOWN', 'QUEUED'],
    ['UNKNOWN', 'EXECUTING'],
    ['QUEUED', 'SUCCESS'],
    ['ASSIGNED', 'SUCCESS'],
  ] as const)('refuses %s → %s', (from, to) => {
    expect(canTaskTransition(from, to)).toBe(false);
  });

  it('only a person leaves UNKNOWN (to SUCCESS or FAILED)', () => {
    expect(canTaskTransition('UNKNOWN', 'SUCCESS')).toBe(true);
    expect(canTaskTransition('UNKNOWN', 'FAILED')).toBe(true);
  });
});

describe('retry policy', () => {
  it('UNKNOWN is never retried, whatever the code', () => {
    expect(isAutomaticRetry('UNKNOWN', 'TIMEOUT', 1, 3)).toBe(false);
    expect(isAutomaticRetry('UNKNOWN', 'NETWORK_ERROR', 1, 3)).toBe(false);
  });

  it('retries only retryable FAILED codes with attempts left', () => {
    expect(isAutomaticRetry('FAILED', 'NETWORK_ERROR', 1, 3)).toBe(true);
    expect(isAutomaticRetry('FAILED', 'SIM_UNAVAILABLE', 2, 3)).toBe(true);
    expect(isAutomaticRetry('FAILED', 'NETWORK_ERROR', 3, 3)).toBe(false);
    expect(isAutomaticRetry('FAILED', 'INSUFFICIENT_BALANCE', 1, 3)).toBe(false);
    expect(isAutomaticRetry('FAILED', 'INVALID_DESTINATION', 1, 3)).toBe(false);
    expect(isAutomaticRetry('FAILED', 'USSD_REJECTED', 1, 3)).toBe(false);
  });

  it('workers cannot send manual decisions or backend codes', () => {
    expect(ACTIVATION_RESULT_CODES.MANUAL_CONFIRMED.worker).toBe(false);
    expect(ACTIVATION_RESULT_CODES.MANUAL_REJECTED.worker).toBe(false);
    expect(ACTIVATION_RESULT_CODES.INVALID_FLOW.worker).toBe(false);
  });
});

describe('UssdResponseParser rules', () => {
  it.each([
    ['Pacote activado com SUCESSO.', 'SUCCESS'],
    ['Operacao falhou: saldo insuficiente', 'FAILED'],
    ['Sucesso? saldo insuficiente', 'UNKNOWN'],
    ['Menu: 1 Dados 2 Voz', 'UNKNOWN'],
    ['', 'UNKNOWN'],
    [null, 'UNKNOWN'],
  ] as const)('%p → %s', (response, expected) => {
    expect(classifyUssdResponse(FLOW, response)).toBe(expected);
  });

  it('without success texts nothing proves success', () => {
    expect(classifyUssdResponse({ success: undefined, failure: undefined }, 'Pacote activado')).toBe('UNKNOWN');
  });
});

describe('verifyWorkerClaim (mirrors worker_report_result)', () => {
  it('SUCCESS only when the screen proves it', () => {
    expect(verifyWorkerClaim(FLOW, { outcome: 'SUCCESS', resultCode: 'ACTIVATED', operatorResponse: 'Pacote activado' }, true)).toEqual({
      outcome: 'SUCCESS',
      resultCode: 'ACTIVATED',
    });
    expect(verifyWorkerClaim(FLOW, { outcome: 'SUCCESS', resultCode: 'ACTIVATED', operatorResponse: 'Obrigado' }, true)).toEqual({
      outcome: 'UNKNOWN',
      resultCode: 'UNKNOWN_RESPONSE',
    });
    expect(verifyWorkerClaim(FLOW, { outcome: 'SUCCESS', resultCode: 'ACTIVATED', operatorResponse: 'saldo insuficiente' }, true)).toEqual({
      outcome: 'FAILED',
      resultCode: 'USSD_REJECTED',
    });
  });

  it('after submission a failure needs the failure text; otherwise UNKNOWN', () => {
    expect(verifyWorkerClaim(FLOW, { outcome: 'FAILED', resultCode: 'TIMEOUT', operatorResponse: null }, true)).toEqual({
      outcome: 'UNKNOWN',
      resultCode: 'TIMEOUT',
    });
    expect(verifyWorkerClaim(FLOW, { outcome: 'FAILED', resultCode: 'INSUFFICIENT_BALANCE', operatorResponse: 'saldo insuficiente' }, true)).toEqual({
      outcome: 'FAILED',
      resultCode: 'INSUFFICIENT_BALANCE',
    });
  });

  it('a failure contradicted by the screen is UNKNOWN', () => {
    expect(verifyWorkerClaim(FLOW, { outcome: 'FAILED', resultCode: 'USSD_REJECTED', operatorResponse: 'Pacote activado' }, false)).toEqual({
      outcome: 'UNKNOWN',
      resultCode: 'UNKNOWN_RESPONSE',
    });
  });

  it('before submission a failure is accepted as reported', () => {
    expect(verifyWorkerClaim(FLOW, { outcome: 'FAILED', resultCode: 'NETWORK_ERROR' }, false)).toEqual({ outcome: 'FAILED', resultCode: 'NETWORK_ERROR' });
  });
});

describe('devices', () => {
  const NOW = Date.parse('2026-10-02T12:00:00.000Z');

  it('online is derived from the last heartbeat and the timeout', () => {
    expect(isDeviceOnline({ status: 'ACTIVE', lastSeenAt: '2026-10-02T11:59:00.000Z' }, NOW)).toBe(true);
    expect(isDeviceOnline({ status: 'ACTIVE', lastSeenAt: '2026-10-02T11:50:00.000Z' }, NOW)).toBe(false);
    expect(isDeviceOnline({ status: 'ACTIVE', lastSeenAt: '2026-10-02T11:50:00.000Z' }, NOW, 900)).toBe(true);
    expect(isDeviceOnline({ status: 'DISABLED', lastSeenAt: '2026-10-02T11:59:59.000Z' }, NOW)).toBe(false);
    expect(isDeviceOnline({ status: 'UNREGISTERED', lastSeenAt: null }, NOW)).toBe(false);
  });

  it('reads the configured heartbeat timeout (bounded)', () => {
    expect(heartbeatTimeoutSeconds({ heartbeat_timeout_seconds: 300 })).toBe(300);
    expect(heartbeatTimeoutSeconds({ heartbeat_timeout_seconds: 5 })).toBe(120);
    expect(heartbeatTimeoutSeconds(null)).toBe(120);
  });

  it('normalizes pairing codes (unambiguous alphabet)', () => {
    expect(normalizePairingCode(' ab cd-23 45 ')).toBe('ABCD2345');
    expect(normalizePairingCode('ABCD-EF0O')).toBeNull();
    expect(normalizePairingCode('ABC')).toBeNull();
  });

  it('validates names and SIMs (explicit operator, E.164 phone)', () => {
    expect(assertValidDeviceName('  Worker 1 ')).toBe('Worker 1');
    expect(() => assertValidDeviceName('X')).toThrow(AppError);
    expect(assertValidSimInput({ deviceId: 'd', slotIndex: 0, operator: 'vodacom', phoneNumber: '84 555 0100' })).toMatchObject({
      phoneNumber: '+258845550100',
    });
    expect(() => assertValidSimInput({ deviceId: 'd', slotIndex: 9, operator: 'vodacom' })).toThrow(AppError);
    expect(() => assertValidSimInput({ deviceId: 'd', slotIndex: 0, operator: 'mtn' as never })).toThrow(AppError);
    expect(() => assertValidSimInput({ deviceId: 'd', slotIndex: 0, operator: 'vodacom', phoneNumber: '123' })).toThrow(AppError);
  });

  it('decisions on UNKNOWN need a note', () => {
    expect(() => normalizeDecisionNote('  ', { required: true })).toThrow(AppError);
    expect(normalizeDecisionNote(null, { required: false })).toBeNull();
  });

  it('maps capabilities / telemetry to the database format, dropping anything else', () => {
    expect(capabilitiesToWire({ ussd: true, ussdInteractive: false, multiSim: true })).toEqual({ ussd: true, ussd_interactive: false, multi_sim: true });
    expect(capabilitiesFromWire({ ussd: true, ussd_interactive: 'yes', root: true })).toEqual({
      ussd: true,
      ussdInteractive: undefined,
      sms: undefined,
      multiSim: undefined,
    });
    expect(telemetryToWire({ batteryLevel: 77.4, networkType: '4G', model: 'SM-A12', signalLevel: 9 as never })).toEqual({
      battery_level: 77,
      network_type: '4G',
      model: 'SM-A12',
    });
  });
});

describe('parseActivationPayload (fail closed)', () => {
  const valid = {
    protocol: ACTIVATION_PROTOCOL,
    task_id: 't1',
    order_id: 'o1',
    product_id: 'p1',
    device_id: 'd1',
    sim_id: 's1',
    status: 'ASSIGNED',
    attempt: 0,
    operator: 'vodacom',
    sim: { slot_index: 0, fingerprint: 'sub-0001-aaaa', operator: 'vodacom' },
    destination_number: '+258840000777',
    flow_version: 1,
    flow: FLOW,
    values: { destination_number: '840000777', price: '777' },
    limits: { step_timeout_ms: 30000, session_timeout_ms: 120000 },
  };

  it('accepts a valid payload', () => {
    expect(parseActivationPayload(valid)).toMatchObject({ taskId: 't1', sim: { slotIndex: 0, fingerprint: 'sub-0001-aaaa' }, values: { price: '777' } });
  });

  it.each([
    ['another protocol', { ...valid, protocol: 'megabot.activation.v2' }],
    ['no flow', { ...valid, flow: null }],
    ['an invalid flow', { ...valid, flow: { version: 1, start: 'x', steps: [] } }],
    ['SIM of another network', { ...valid, sim: { ...valid.sim, operator: 'movitel' } }],
    ['an invalid destination', { ...valid, destination_number: '123' }],
    ['an unknown value key', { ...valid, values: { pin: '1234' } }],
    ['an unknown status', { ...valid, status: 'DONE' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseActivationPayload(payload)).toBeNull();
  });
});
