/**
 * Safe access to `@harborlockers/react-native-sdk`.
 *
 * The SDK is native code. It exists only in binaries compiled with it
 * (development / production builds). In Expo Go `NativeModules.HarborLockersSDK`
 * is `undefined`, and calling into it is the crash you want to avoid. This
 * module answers "is the SDK here?" with a reason when it is not, hands out the
 * SDK object when it is, and types the SDK's events.
 *
 * Usage:
 *   const harbor = getHarborSDK();          // throws HarborUnavailableError in Expo Go / web
 *   harbor.setAccessToken(token, 'sandbox');
 *   harbor.initializeSDK();
 *   const sub = addHarborListener('TowersFound', (towers) => { ... });
 */

import type HarborLockersSDK from '@harborlockers/react-native-sdk';
import type { Tower } from '@harborlockers/react-native-sdk/HarborTypes';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type { LockerTypesAvailability, SyncEvents, SyncStatus, Tower } from '@harborlockers/react-native-sdk/HarborTypes';

/** The SDK's method set, exactly as `@harborlockers/react-native-sdk` types it. */
export type HarborSDK = typeof HarborLockersSDK;

export const HARBOR_NATIVE_MODULE_NAME = 'HarborLockersSDK';

/** Events emitted by the native module (see `supportedEvents` in RCTHarborLockersSDKModule). */
export type HarborEventMap = {
  TowersFound: Tower[];
  TowerDisconnected: Tower;
  HarborLogged: { message: string; logType: string; context?: Record<string, unknown> | null };
};

export type HarborAvailability = {
  available: boolean;
  isExpoGo: boolean;
  /** Why the SDK cannot be used in this runtime (null when it can). */
  reason: string | null;
};

export class HarborUnavailableError extends Error {
  readonly code = 'harbor_sdk_unavailable';

  constructor(reason: string) {
    super(reason);
    this.name = 'HarborUnavailableError';
  }
}

type NativeHarborModule = HarborSDK & {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

function nativeModule(): NativeHarborModule | null {
  if (Platform.OS === 'web') return null;
  const module = (NativeModules as Record<string, unknown>)[HARBOR_NATIVE_MODULE_NAME];
  return module ? (module as NativeHarborModule) : null;
}

export function getHarborAvailability(): HarborAvailability {
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (nativeModule()) {
    return { available: true, isExpoGo, reason: null };
  }
  let reason: string;
  if (Platform.OS === 'web') {
    reason = 'The Harbor SDK talks to towers over Bluetooth from a phone; it is not available on web.';
  } else if (isExpoGo) {
    reason =
      'This is Expo Go. Expo Go is a prebuilt app that only contains Expo\u2019s own modules \u2013 it has ' +
      'no Bluetooth module and the Harbor SDK\u2019s native code is not inside it, so no JavaScript can ' +
      'make it reach a tower.\n\nRun this project as a development build instead ' +
      '(npm run build:dev:android / build:dev:ios). You still write no native code \u2013 EAS compiles ' +
      'the SDK in for you.';
  } else {
    reason =
      `The native module "${HARBOR_NATIVE_MODULE_NAME}" is not in this binary: it was built without ` +
      '@harborlockers/react-native-sdk. Run npm install and create a new development build.';
  }
  return { available: false, isExpoGo, reason };
}

/** The SDK object. Throws `HarborUnavailableError` (with the reason) when the native module is absent. */
export function getHarborSDK(): HarborSDK {
  const module = nativeModule();
  if (!module) {
    throw new HarborUnavailableError(getHarborAvailability().reason ?? 'Harbor SDK unavailable.');
  }
  return module;
}

let emitter: NativeEventEmitter | null = null;

/**
 * Subscribes to one of the SDK's events. Safe to call in any runtime: without
 * the native module the subscription is a no-op (nothing can emit anyway).
 */
export function addHarborListener<K extends keyof HarborEventMap>(
  eventName: K,
  listener: (payload: HarborEventMap[K]) => void
): { remove(): void } {
  const module = nativeModule();
  if (!module) {
    return { remove() {} };
  }
  // The native module implements addListener/removeListeners, which RN's NativeEventEmitter
  // requires; the Android module only emits TowersFound while it has listeners.
  emitter ??= new NativeEventEmitter(module as never);
  const subscription = emitter.addListener(eventName, listener as (payload: unknown) => void);
  return { remove: () => subscription.remove() };
}

/** Readable text for anything the SDK or the API may reject with. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const { code, userInfo } = error as { code?: unknown; userInfo?: { NSLocalizedDescription?: unknown } };
    // iOS promise rejections carry the SDK's NSError; its description is often more specific than
    // the message the module rejects with (e.g. "Sync connected tower failed").
    const detail = userInfo?.NSLocalizedDescription;
    const message =
      typeof detail === 'string' && detail && detail !== error.message ? `${error.message}: ${detail}` : error.message;
    return typeof code === 'string' && code && code !== message ? `${message} (${code})` : message;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}
