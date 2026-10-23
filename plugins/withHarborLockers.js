/**
 * Expo config plugin for @harborlockers/react-native-sdk.
 *
 * The SDK has no config plugin of its own, so this one adds what its native
 * code needs at build time. It runs during `expo prebuild` (which EAS Build
 * does for you) – you never edit android/ or ios/ by hand.
 *
 *  - iOS: Bluetooth usage descriptions (App Store rejects builds without them).
 *  - Android: Bluetooth + location permissions for BLE scanning/connecting.
 *    BLUETOOTH_SCAN carries `neverForLocation` (Android 12+) because the SDK
 *    uses scanning to find towers, not to derive location.
 *  - Android: pins `kotlinx-datetime` to JetBrains' 0.6.x-compat build. The
 *    Harbor Android SDK (harbor-android-sdk 1.0.19) is compiled against
 *    kotlinx-datetime 0.6.x and calls `kotlinx.datetime.Clock.System`. In
 *    kotlinx-datetime 0.7 that class moved to the Kotlin stdlib (kotlin.time)
 *    and no longer exists in the jar. expo-dev-launcher (development builds)
 *    depends on 0.7.1, Gradle picks the highest version, and the first tower
 *    session then dies with
 *      NoClassDefFoundError: kotlinx/datetime/Clock$System
 *    The `0.7.1-0.6.x-compat` artifact contains both the old classes and the
 *    new APIs, so Harbor and the dev launcher are both satisfied.
 */
const { withAndroidManifest, withInfoPlist, withProjectBuildGradle } = require('expo/config-plugins');

const KOTLINX_DATETIME_VERSION = '0.7.1-0.6.x-compat';
const GRADLE_MARKER = '// @generated withHarborLockers: kotlinx-datetime compatibility';
const GRADLE_SNIPPET = `
${GRADLE_MARKER}
allprojects {
  configurations.all {
    resolutionStrategy {
      force 'org.jetbrains.kotlinx:kotlinx-datetime:${KOTLINX_DATETIME_VERSION}'
      force 'org.jetbrains.kotlinx:kotlinx-datetime-jvm:${KOTLINX_DATETIME_VERSION}'
    }
  }
}
`;

const BLUETOOTH_USAGE = 'This app uses Bluetooth to connect to Harbor Lockers';

const ANDROID_PERMISSIONS = [
  { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_SCAN', usesPermissionFlags: 'neverForLocation' },
  { name: 'android.permission.BLUETOOTH_CONNECT' },
  { name: 'android.permission.ACCESS_FINE_LOCATION' },
  { name: 'android.permission.ACCESS_COARSE_LOCATION' },
];

const withHarborLockers = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.NSBluetoothAlwaysUsageDescription =
      config.modResults.NSBluetoothAlwaysUsageDescription || BLUETOOTH_USAGE;
    config.modResults.NSBluetoothPeripheralUsageDescription =
      config.modResults.NSBluetoothPeripheralUsageDescription || BLUETOOTH_USAGE;
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const existing = manifest['uses-permission'];

    for (const permission of ANDROID_PERMISSIONS) {
      const attrs = { 'android:name': permission.name };
      if (permission.maxSdkVersion) attrs['android:maxSdkVersion'] = permission.maxSdkVersion;
      if (permission.usesPermissionFlags) attrs['android:usesPermissionFlags'] = permission.usesPermissionFlags;

      const found = existing.find((p) => p.$ && p.$['android:name'] === permission.name);
      if (found) {
        found.$ = { ...found.$, ...attrs };
      } else {
        existing.push({ $: attrs });
      }
    }
    return config;
  });

  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withHarborLockers: only Groovy android/build.gradle is supported.');
    }
    if (!config.modResults.contents.includes(GRADLE_MARKER)) {
      config.modResults.contents += GRADLE_SNIPPET;
    }
    return config;
  });

  return config;
};

module.exports = withHarborLockers;
