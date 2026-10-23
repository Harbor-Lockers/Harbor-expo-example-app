/**
 * lib/harbor must be safe to import and call in any runtime: in Expo Go it
 * explains instead of crashing; with the native module present it hands the
 * SDK out unchanged and delivers its events.
 */
import { DeviceEventEmitter, NativeModules } from 'react-native';

import {
  addHarborListener,
  describeError,
  getHarborAvailability,
  getHarborSDK,
  HARBOR_NATIVE_MODULE_NAME,
  HarborUnavailableError,
} from '../lib/harbor';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, executionEnvironment: 'storeClient' } };
});

const modules = NativeModules as Record<string, unknown>;

afterEach(() => {
  delete modules[HARBOR_NATIVE_MODULE_NAME];
});

describe('without the native module (Expo Go)', () => {
  it('reports unavailable with an explanation that names Expo Go and the fix', () => {
    const availability = getHarborAvailability();
    expect(availability.available).toBe(false);
    expect(availability.isExpoGo).toBe(true);
    expect(availability.reason).toMatch(/Expo Go/);
    expect(availability.reason).toMatch(/development build/);
  });

  it('getHarborSDK throws HarborUnavailableError instead of returning undefined', () => {
    expect(() => getHarborSDK()).toThrow(HarborUnavailableError);
    try {
      getHarborSDK();
    } catch (error) {
      expect((error as HarborUnavailableError).code).toBe('harbor_sdk_unavailable');
      expect(describeError(error)).toMatch(/Expo Go.*\(harbor_sdk_unavailable\)/s);
    }
  });

  it('addHarborListener is a harmless no-op', () => {
    const listener = jest.fn();
    const subscription = addHarborListener('TowersFound', listener);
    expect(() => subscription.remove()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('with the native module (development build)', () => {
  const fakeModule = () => ({
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    initializeSDK: jest.fn(),
    setAccessToken: jest.fn(),
    sendOpenLockerWithTokenCommand: jest.fn().mockResolvedValue(7),
  });

  it('hands out the SDK object itself', async () => {
    const native = fakeModule();
    modules[HARBOR_NATIVE_MODULE_NAME] = native;

    expect(getHarborAvailability()).toMatchObject({ available: true, reason: null });
    const sdk = getHarborSDK();
    sdk.setAccessToken('token', 'sandbox');
    expect(native.setAccessToken).toHaveBeenCalledWith('token', 'sandbox');
    // Resolves with the tower's numeric locker id – a number, not an array.
    await expect(sdk.sendOpenLockerWithTokenCommand('aa', 'bb')).resolves.toBe(7);
  });

  it('delivers native events and registers the listener with the module', () => {
    const native = fakeModule();
    modules[HARBOR_NATIVE_MODULE_NAME] = native;

    const found = jest.fn();
    const subscription = addHarborListener('TowersFound', found);
    // The Android module only emits TowersFound while its listener count is > 0.
    expect(native.addListener).toHaveBeenCalledWith('TowersFound');

    const towers = [{ towerId: '0011223344556677', towerName: 'Tower A', firmwareVersion: '1', rssi: -40 }];
    DeviceEventEmitter.emit('TowersFound', towers); // what the native side does
    expect(found).toHaveBeenCalledWith(towers);

    subscription.remove();
    DeviceEventEmitter.emit('TowersFound', towers);
    expect(found).toHaveBeenCalledTimes(1);
  });
});
