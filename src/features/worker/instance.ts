import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { api, dataSource } from '@/services';
import type { DeviceTelemetry } from '@/types';

import { defaultCredentialStore } from './credentials';
import { WorkerRuntime } from './runtime';
import { AndroidUssdExecutor } from './ussd/androidUssdExecutor';
import { MockUssdExecutor } from './ussd/mockUssdExecutor';

const deviceTelemetry = (): DeviceTelemetry => ({
  ...(Device.modelName ? { model: Device.modelName } : {}),
  ...(Device.osVersion ? { osVersion: Device.osVersion } : {}),
});

let runtime: WorkerRuntime | null = null;

/**
 * The app's worker. Supabase mode always uses the real Android executor (on
 * other platforms or without the native module it reports "no USSD" and gets
 * no work); the simulated executor exists only in mock mode.
 */
export function getWorkerRuntime(): WorkerRuntime {
  if (!runtime) {
    runtime = new WorkerRuntime({
      service: api.worker,
      executor: dataSource === 'mock' ? new MockUssdExecutor('success') : new AndroidUssdExecutor(),
      store: defaultCredentialStore(),
      appVersion: Constants.expoConfig?.version ?? '0.0.0',
      telemetry: deviceTelemetry,
    });
    void runtime.load();
  }
  return runtime;
}

export const workerPlatformSupported = Platform.OS === 'android' || dataSource === 'mock';
