/**
 * Runtime permissions the Harbor SDK needs to scan for / connect to towers.
 *
 * - iOS asks for Bluetooth itself the first time CoreBluetooth is used; the
 *   usage descriptions are added by plugins/withHarborLockers.js.
 * - Android needs fine location for BLE scanning on every version, and on
 *   Android 12+ (API 31) BLUETOOTH_SCAN / BLUETOOTH_CONNECT as runtime
 *   permissions. `PermissionsAndroid` is React Native core – no extra module.
 */

import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionOutcome = {
  granted: boolean;
  /** What was denied, in words, for the UI. */
  denied: string[];
};

export async function requestTowerPermissions(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    return { granted: true, denied: [] };
  }

  const apiLevel = Number(Platform.Version);
  const wanted = [
    { permission: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, label: 'Location (required for Bluetooth scanning)' },
  ];
  if (apiLevel >= 31) {
    wanted.push(
      { permission: PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, label: 'Nearby devices (Bluetooth scan)' },
      { permission: PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, label: 'Nearby devices (Bluetooth connect)' }
    );
  }

  const results = await PermissionsAndroid.requestMultiple(wanted.map((w) => w.permission));
  const denied = wanted
    .filter((w) => results[w.permission] !== PermissionsAndroid.RESULTS.GRANTED)
    .map((w) => w.label);
  return { granted: denied.length === 0, denied };
}
