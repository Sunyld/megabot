/**
 * Thin adapter between the activation services and supabase-js (migration 006).
 * Reads go to the tables (RLS: members of the tenant); every write is an RPC
 * command — the API has no INSERT/UPDATE grant on devices, SIMs or tasks.
 */
import type { Database, Json, MegabotSupabaseClient } from '@/lib/supabase';

type Tables = Database['public']['Tables'];

export type DeviceRow = Tables['devices']['Row'];
export type DeviceSimRow = Tables['device_sims']['Row'];
export type ActivationTaskRow = Tables['activation_tasks']['Row'];
export type ActivationAttemptRow = Tables['activation_task_attempts']['Row'];
export type ActivationEventRow = Tables['activation_task_events']['Row'];
export type PairingRow = Database['public']['Functions']['create_device']['Returns'][number];
export type RegistrationRow = Database['public']['Functions']['register_device']['Returns'][number];
/** What the activation screens show about the order (snapshot, never the product). */
export type ActivationOrderRow = Pick<
  Tables['orders']['Row'],
  | 'id'
  | 'public_reference'
  | 'product_name_snapshot'
  | 'customer_phone'
  | 'product_price_snapshot'
  | 'currency_snapshot'
  | 'data_amount_snapshot'
  | 'data_unit_snapshot'
>;

export type TaskListQuery = { status: string | null; orderId: string | null; ids: string[] | null; limit: number };
export type AttemptListQuery = { taskIds: string[] | null; deviceId: string | null; since: string | null; limit: number };
export type EventListQuery = { taskId: string | null; deviceId: string | null; limit: number };

export type HeartbeatArgs = {
  deviceId: string;
  deviceToken: string;
  appVersion: string | null;
  capabilities: Json | null;
  telemetry: Json | null;
  sims: Json | null;
};

export type ResultArgs = {
  deviceId: string;
  deviceToken: string;
  taskId: string;
  outcome: string;
  resultCode: string;
  operatorResponse: string | null;
  ussdTrace: string | null;
};

export interface ActivationGateway {
  listDevices(tenantId: string, ids?: string[] | null): Promise<DeviceRow[]>;
  createDevice(tenantId: string, name: string): Promise<PairingRow[]>;
  createPairingCode(deviceId: string): Promise<PairingRow[]>;
  updateDevice(id: string, name: string | null, status: string | null): Promise<DeviceRow[]>;
  listSims(tenantId: string, deviceId: string | null): Promise<DeviceSimRow[]>;
  registerSim(deviceId: string, slotIndex: number, operator: string, phoneNumber: string | null): Promise<DeviceSimRow[]>;
  updateSim(id: string, operator: string | null, phoneNumber: string | null, status: string | null): Promise<DeviceSimRow[]>;
  listTasks(tenantId: string, query: TaskListQuery): Promise<ActivationTaskRow[]>;
  listAttempts(tenantId: string, query: AttemptListQuery): Promise<ActivationAttemptRow[]>;
  listEvents(tenantId: string, query: EventListQuery): Promise<ActivationEventRow[]>;
  listOrders(tenantId: string, ids: string[]): Promise<ActivationOrderRow[]>;
  automationSettings(tenantId: string): Promise<Json | null>;
  dispatch(tenantId: string): Promise<number>;
  retryTask(id: string, note: string | null): Promise<ActivationTaskRow[]>;
  resolveTask(id: string, outcome: string, note: string): Promise<ActivationTaskRow[]>;
  // worker protocol
  registerDevice(pairingCode: string, deviceIdentifier: string, appVersion: string): Promise<RegistrationRow[]>;
  heartbeat(args: HeartbeatArgs): Promise<Json>;
  fetchTask(deviceId: string, deviceToken: string): Promise<Json | null>;
  startTask(deviceId: string, deviceToken: string, taskId: string): Promise<Json>;
  reportProgress(deviceId: string, deviceToken: string, taskId: string, status: string): Promise<ActivationTaskRow[]>;
  reportResult(args: ResultArgs): Promise<ActivationTaskRow[]>;
  // platform
  platformDevices(tenantId: string): Promise<DeviceRow[]>;
  platformTasks(tenantId: string, limit: number): Promise<ActivationTaskRow[]>;
}

const DEVICE_COLUMNS =
  'id, tenant_id, device_name, device_identifier, platform, app_version, status, capabilities, telemetry, last_seen_at, registered_at, registered_by, created_by, created_at, updated_at';
const SIM_COLUMNS =
  'id, tenant_id, device_id, slot_index, operator, phone_number, status, unavailable_reason, capabilities, sim_fingerprint, last_seen_at, created_by, created_at, updated_at';
const TASK_COLUMNS =
  'id, tenant_id, order_id, product_id, device_id, sim_id, status, priority, operator, ussd_flow, flow_version, attempt_count, max_attempts, assigned_at, started_at, submitted_at, completed_at, result_code, result_message, failure_reason, created_at, updated_at';
const ATTEMPT_COLUMNS =
  'id, tenant_id, task_id, sequence, attempt_number, device_id, sim_id, slot_index, outcome, result_code, retryable, source, ussd_trace, operator_response, note, decided_by, started_at, finished_at, created_at';
const EVENT_COLUMNS = 'id, tenant_id, task_id, event_type, from_status, to_status, device_id, sim_id, actor_user_id, metadata, created_at';
const ORDER_COLUMNS =
  'id, public_reference, product_name_snapshot, customer_phone, product_price_snapshot, currency_snapshot, data_amount_snapshot, data_unit_snapshot';

/** Optional RPC arguments are omitted (not sent as null) so the SQL defaults apply. */
const optional = <K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> =>
  value === null ? {} : ({ [key]: value } as Record<K, V>);

export function createActivationGateway(getClient: () => MegabotSupabaseClient): ActivationGateway {
  return {
    async listDevices(tenantId, ids = null) {
      let request = getClient().from('devices').select(DEVICE_COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: true });
      if (ids) request = request.in('id', ids);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async createDevice(tenantId, name) {
      const { data, error } = await getClient().rpc('create_device', { p_tenant_id: tenantId, p_device_name: name });
      if (error) throw error;
      return data ?? [];
    },

    async createPairingCode(deviceId) {
      const { data, error } = await getClient().rpc('create_device_pairing_code', { p_device_id: deviceId });
      if (error) throw error;
      return data ?? [];
    },

    async updateDevice(id, name, status) {
      const { data, error } = await getClient().rpc('update_device', {
        p_device_id: id,
        ...optional('p_device_name', name),
        ...optional('p_status', status),
      });
      if (error) throw error;
      return data ?? [];
    },

    async listSims(tenantId, deviceId) {
      let request = getClient()
        .from('device_sims')
        .select(SIM_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('device_id')
        .order('slot_index');
      if (deviceId) request = request.eq('device_id', deviceId);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async registerSim(deviceId, slotIndex, operator, phoneNumber) {
      const { data, error } = await getClient().rpc('register_device_sim', {
        p_device_id: deviceId,
        p_slot_index: slotIndex,
        p_operator: operator,
        ...optional('p_phone_number', phoneNumber),
      });
      if (error) throw error;
      return data ?? [];
    },

    async updateSim(id, operator, phoneNumber, status) {
      const { data, error } = await getClient().rpc('update_device_sim', {
        p_sim_id: id,
        ...optional('p_operator', operator),
        ...optional('p_phone_number', phoneNumber),
        ...optional('p_status', status),
      });
      if (error) throw error;
      return data ?? [];
    },

    async listTasks(tenantId, { status, orderId, ids, limit }) {
      let request = getClient()
        .from('activation_tasks')
        .select(TASK_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (status) request = request.eq('status', status);
      if (orderId) request = request.eq('order_id', orderId);
      if (ids) request = request.in('id', ids);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async listAttempts(tenantId, { taskIds, deviceId, since, limit }) {
      let request = getClient()
        .from('activation_task_attempts')
        .select(ATTEMPT_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('finished_at', { ascending: false })
        .limit(limit);
      if (taskIds) request = request.in('task_id', taskIds);
      if (deviceId) request = request.eq('device_id', deviceId);
      if (since) request = request.gte('finished_at', since);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async listEvents(tenantId, { taskId, deviceId, limit }) {
      let request = getClient()
        .from('activation_task_events')
        .select(EVENT_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (taskId) request = request.eq('task_id', taskId);
      if (deviceId) request = request.eq('device_id', deviceId);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async listOrders(tenantId, ids) {
      if (!ids.length) return [];
      const { data, error } = await getClient().from('orders').select(ORDER_COLUMNS).eq('tenant_id', tenantId).in('id', ids);
      if (error) throw error;
      return data;
    },

    async automationSettings(tenantId) {
      const { data, error } = await getClient().from('tenant_settings').select('automation').eq('tenant_id', tenantId).maybeSingle();
      if (error) throw error;
      return data?.automation ?? null;
    },

    async dispatch(tenantId) {
      const { data, error } = await getClient().rpc('dispatch_activation_tasks', { p_tenant_id: tenantId });
      if (error) throw error;
      return data ?? 0;
    },

    async retryTask(id, note) {
      const { data, error } = await getClient().rpc('retry_activation_task', { p_task_id: id, ...optional('p_note', note) });
      if (error) throw error;
      return data ?? [];
    },

    async resolveTask(id, outcome, note) {
      const { data, error } = await getClient().rpc('resolve_activation_task', { p_task_id: id, p_outcome: outcome, p_note: note });
      if (error) throw error;
      return data ?? [];
    },

    async registerDevice(pairingCode, deviceIdentifier, appVersion) {
      const { data, error } = await getClient().rpc('register_device', {
        p_pairing_code: pairingCode,
        p_device_identifier: deviceIdentifier,
        p_platform: 'ANDROID',
        p_app_version: appVersion,
      });
      if (error) throw error;
      return data ?? [];
    },

    async heartbeat({ deviceId, deviceToken, appVersion, capabilities, telemetry, sims }) {
      const { data, error } = await getClient().rpc('device_heartbeat', {
        p_device_id: deviceId,
        p_device_token: deviceToken,
        ...optional('p_app_version', appVersion),
        ...optional('p_capabilities', capabilities),
        ...optional('p_telemetry', telemetry),
        ...optional('p_sims', sims),
      });
      if (error) throw error;
      return data;
    },

    async fetchTask(deviceId, deviceToken) {
      const { data, error } = await getClient().rpc('worker_fetch_task', { p_device_id: deviceId, p_device_token: deviceToken });
      if (error) throw error;
      return data ?? null;
    },

    async startTask(deviceId, deviceToken, taskId) {
      const { data, error } = await getClient().rpc('worker_start_task', {
        p_device_id: deviceId,
        p_device_token: deviceToken,
        p_task_id: taskId,
      });
      if (error) throw error;
      return data;
    },

    async reportProgress(deviceId, deviceToken, taskId, status) {
      const { data, error } = await getClient().rpc('worker_report_progress', {
        p_device_id: deviceId,
        p_device_token: deviceToken,
        p_task_id: taskId,
        p_status: status,
      });
      if (error) throw error;
      return data ?? [];
    },

    async reportResult({ deviceId, deviceToken, taskId, outcome, resultCode, operatorResponse, ussdTrace }) {
      const { data, error } = await getClient().rpc('worker_report_result', {
        p_device_id: deviceId,
        p_device_token: deviceToken,
        p_task_id: taskId,
        p_outcome: outcome,
        p_result_code: resultCode,
        ...optional('p_operator_response', operatorResponse),
        ...optional('p_ussd_trace', ussdTrace),
      });
      if (error) throw error;
      return data ?? [];
    },

    async platformDevices(tenantId) {
      const { data, error } = await getClient().rpc('platform_list_tenant_devices', { p_tenant_id: tenantId });
      if (error) throw error;
      return data ?? [];
    },

    async platformTasks(tenantId, limit) {
      const { data, error } = await getClient().rpc('platform_list_tenant_activation_tasks', { p_tenant_id: tenantId, p_limit: limit });
      if (error) throw error;
      return data ?? [];
    },
  };
}
