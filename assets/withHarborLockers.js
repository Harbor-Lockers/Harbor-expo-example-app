const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins")

const withHarborLockers = (config) => {
  // Add iOS permissions
  config = withInfoPlist(config, (config) => {
    if (!config.modResults) {
      config.modResults = {}
    }

    config.modResults.NSBluetoothAlwaysUsageDescription =
      config.modResults.NSBluetoothAlwaysUsageDescription || "This app uses Bluetooth to connect to Harbor Lockers"
    config.modResults.NSBluetoothPeripheralUsageDescription =
      config.modResults.NSBluetoothPeripheralUsageDescription || "This app uses Bluetooth to connect to Harbor Lockers"
    return config
  })

  // Add Android permissions
  config = withAndroidManifest(config, (config) => {
    if (!config.modResults) {
      config.modResults = {}
    }

    const androidManifest = config.modResults

    if (!androidManifest.manifest) {
      androidManifest.manifest = { application: [{}] }
    }

    const mainApplication = androidManifest.manifest.application[0]

    // Ensure permissions exist in the manifest
    if (!androidManifest.manifest["uses-permission"]) {
      androidManifest.manifest["uses-permission"] = []
    }

    // Add Bluetooth permissions
    const permissions = [
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_FINE_LOCATION",
    ]

    permissions.forEach((permission) => {
      if (!androidManifest.manifest["uses-permission"].some((p) => p.$?.["android:name"] === permission)) {
        androidManifest.manifest["uses-permission"].push({
          $: {
            "android:name": permission,
          },
        })
      }
    })

    return config
  })

  return config
}

module.exports = withHarborLockers
