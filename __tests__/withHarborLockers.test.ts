/**
 * Runs the config plugin's mods directly (no prebuild). The kotlinx-datetime
 * pin is the one that matters most: without it the first tower session in an
 * Android development build crashes with
 * `NoClassDefFoundError: kotlinx/datetime/Clock$System`.
 */
import type { ExpoConfig } from 'expo/config';

import withHarborLockersPlugin from '../plugins/withHarborLockers';

const withHarborLockers = withHarborLockersPlugin as (config: ExpoConfig) => ExpoConfig & {
  mods?: Record<string, Record<string, (c: any) => Promise<any>>>;
};

async function applyMod(platform: 'android' | 'ios', name: string, modResults: unknown) {
  const config = withHarborLockers({ name: 'x', slug: 'x' });
  const mod = config.mods?.[platform]?.[name];
  if (!mod) throw new Error(`mod ${platform}.${name} not registered`);
  return (await mod({ ...config, modResults, modRequest: {} as never })).modResults;
}

describe('withHarborLockers config plugin', () => {
  it('forces kotlinx-datetime to the 0.6.x-compat build in android/build.gradle, once', async () => {
    const base = 'apply plugin: "expo-root-project"\n';
    const once = await applyMod('android', 'projectBuildGradle', { language: 'groovy', contents: base });
    expect(once.contents).toContain("force 'org.jetbrains.kotlinx:kotlinx-datetime:0.7.1-0.6.x-compat'");
    expect(once.contents).toContain("force 'org.jetbrains.kotlinx:kotlinx-datetime-jvm:0.7.1-0.6.x-compat'");
    expect(once.contents.startsWith(base)).toBe(true);
    const twice = await applyMod('android', 'projectBuildGradle', once);
    expect(twice.contents).toBe(once.contents);
  });

  it('adds the Android Bluetooth/location permissions without duplicating existing ones', async () => {
    const result = await applyMod('android', 'manifest', {
      manifest: {
        'uses-permission': [{ $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } }],
        application: [{}],
      },
    });
    const names = result.manifest['uses-permission'].map((p: any) => p.$['android:name']);
    expect(names.filter((n: string) => n === 'android.permission.ACCESS_FINE_LOCATION')).toHaveLength(1);
    expect(names).toEqual(
      expect.arrayContaining(['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'])
    );
  });

  it('adds the iOS Bluetooth usage descriptions, keeping custom text', async () => {
    const result = await applyMod('ios', 'infoPlist', { NSBluetoothAlwaysUsageDescription: 'custom' });
    expect(result.NSBluetoothAlwaysUsageDescription).toBe('custom');
    expect(result.NSBluetoothPeripheralUsageDescription).toMatch(/Harbor/);
  });
});
