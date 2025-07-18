"use client";

import HarborLockersSDK from "@harborlockers/react-native-sdk";
import * as Location from "expo-location";
import type React from "react";
import { useEffect, useState } from "react";
import {
  Alert,
  NativeEventEmitter,
  NativeModules,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Config from "../../credentials";
import * as API from "../api";
import { Button } from "../Button";

interface Locker {
  id: string;
  name: string;
  status?: {
    name: string;
  };
}

interface AccessConfig {
  api_access_token: string;
  token_type: string;
  sdk_token: string;
  my_tower_is_connected: boolean;
  sdk_initializated: boolean;
  my_tower_is_synced: boolean;
  can_reopen_locker: boolean;
  available_lockers: Locker[];
}

const CLIENT_NAME = Config.CLIENT_ID;
const CLIENT_SECRET = Config.CLIENT_SECRET;
const SDK_ENV = Config.SDK_ENV;
const MY_TOWER_ID = Config.MY_TOWER_ID;
const SESSION_ROLE = 5;
const TOWER_SYNC_TIMEOUT = 30;
const DOOR_TIMEOUT = 6;

const initialState: AccessConfig = {
  api_access_token: "",
  token_type: "",
  sdk_token: "",
  my_tower_is_connected: false,
  sdk_initializated: false,
  my_tower_is_synced: false,
  can_reopen_locker: false,
  available_lockers: [],
};

// Initialize event emitter at the top level
let eventEmitter: NativeEventEmitter | null = null;
if (NativeModules.HarborLockersSDK) {
  eventEmitter = new NativeEventEmitter(NativeModules.HarborLockersSDK);
} else {
  console.warn("HarborLockersSDK is not available in NativeModules.");
}

const App: React.FC = () => {
  const [accessConfig, setAccessConfig] = useState<AccessConfig>({
    ...initialState,
  });
  const [towerInRange, setTowerInRange] = useState(false);

  const displayAlert = (alertTitle: string, alertBody: string) => {
    Alert.alert(alertTitle, alertBody, [{ text: "OK", onPress: () => {} }]);
  };

  const checkBluetoothPermissions = async () => {
    if (Platform.OS === "android") {
      try {
        const { status: locationStatus } =
          await Location.requestForegroundPermissionsAsync();

        if (locationStatus !== "granted") {
          displayAlert(
            "Location Permission Required",
            "Please grant location permission in your device settings to use Bluetooth scanning."
          );
          return false;
        }

        return true;
      } catch (error) {
        console.error("Error requesting Android permissions:", error);
        return false;
      }
    } else if (Platform.OS === "ios") {
      return true;
    }

    return true;
  };

  const loadConfig = async () => {
    try {
      const userData = await API.retrieveCredentials(
        CLIENT_NAME,
        CLIENT_SECRET
      );
      setAccessConfig((prev) => ({ ...prev, ...userData }));
    } catch (error) {
      displayAlert(
        "Network error",
        "Is your information in credentials.js correct?"
      );
      console.log("Failed at loading config", error);
    }
  };

  const initSdk = (sdkToken: string, env: string) => {
    HarborLockersSDK.setAccessToken(sdkToken, env);
    HarborLockersSDK.initializeSDK();
    setAccessConfig((prev) => ({ ...prev, sdk_initializated: true }));
  };

  const discoverMyTower = () => {
    HarborLockersSDK.startTowersDiscovery();
  };

  const connectToMyTower = (towerId: string) => {
    HarborLockersSDK.connectToTowerWithIdentifier(towerId)
      .then(() => {
        HarborLockersSDK.sendRequestSession(
          SESSION_ROLE,
          (errorCode: number, errorMessage: string) => {
            displayAlert(
              `Error establishing session - ${errorCode}`,
              errorMessage
            );
          },
          () => {
            waitForTowerToCompleteSync(TOWER_SYNC_TIMEOUT);
          }
        );
      })
      .catch((error) => {
        displayAlert("Error establishing session", error.message);
        console.log("Cannot connect to tower", error);
      });
  };

  const waitForTowerToCompleteSync = (retryCount: number) => {
    HarborLockersSDK.isSyncing((syncing: boolean) => {
      if (retryCount === 0) {
        displayAlert("Timeout exceeded", "Tower could not sync");
      } else if (syncing) {
        setTimeout(() => {
          waitForTowerToCompleteSync(retryCount - 1);
        }, 1000);
      } else {
        setAccessConfig((prev) => ({ ...prev, my_tower_is_synced: true }));
      }
    });
  };

  const getAvailableLockersForDropOff = async (
    towerId: string,
    bearerToken: string
  ) => {
    try {
      const availableLockers: Locker[] = await API.getLockersInTower(
        towerId,
        bearerToken
      );
      if (availableLockers.length !== 0) {
        setAccessConfig((prev) => ({
          ...prev,
          available_lockers: [...availableLockers],
        }));
      }
    } catch (error) {
      displayAlert(
        "Network error",
        "Failed to retrieve lockers, Try refreshing your SDK credentials"
      );
      console.log("Failed getting available lockers", error);
    }
  };

  const openLockerForDropOff = async (
    towerId: string,
    lockerId: string,
    bearerToken: string
  ) => {
    setAccessConfig((prev) => ({ ...prev, can_reopen_locker: false }));
    try {
      const lockerKeyPair = await API.createDropOffToken(
        towerId,
        lockerId,
        bearerToken
      );

      const resultFromOpenCommand: number =
        await HarborLockersSDK.sendOpenLockerWithTokenCommand(
          lockerKeyPair.payload,
          lockerKeyPair.payload_auth
        );

      if (
        Array.isArray(resultFromOpenCommand) &&
        resultFromOpenCommand.length > 0
      ) {
        confirmDoorIsOpen(resultFromOpenCommand[0], DOOR_TIMEOUT);
      } else {
        displayAlert(
          "SDK Error",
          "Received invalid response when trying to open locker"
        );
      }
    } catch (error) {
      displayAlert("Door error", "Could not open target door");
      console.log("Failed while opening the locker for drop off", error);
    }
  };

  const confirmDoorIsOpen = (lockerId: string, retryCount: number) => {
    HarborLockersSDK.sendCheckLockerDoorCommand((doorOpen: boolean) => {
      if (retryCount === 0) {
        displayAlert("Door error", "Could not verify door state");
      } else if (doorOpen) {
        const updatedLockerArray = accessConfig.available_lockers.filter(
          (item) => item.id !== lockerId
        );
        setAccessConfig((prev) => ({
          ...prev,
          available_lockers: [...updatedLockerArray],
          can_reopen_locker: true,
        }));
      } else {
        setTimeout(() => {
          confirmDoorIsOpen(lockerId, retryCount - 1);
        }, 1000);
      }
    });
  };

  const reOpenLastDoorOpened = () => {
    HarborLockersSDK.sendReopenLockerCommand();
  };

  const endTowerSession = () => {
    HarborLockersSDK.sendTerminateSession(0, "Session terminated by user");
    setAccessConfig({ ...initialState });
  };

  useEffect(() => {
    checkBluetoothPermissions();
  }, []);

  useEffect(() => {
    if (!eventEmitter) return;

    const subscription = eventEmitter.addListener(
      "TowersFound",
      (towers: any[]) => {
        towers.forEach((tower) => {
          if (tower.towerId.toLowerCase() === MY_TOWER_ID?.toLowerCase()) {
            setTowerInRange(true);
          }
        });
      }
    );

    const subscriptionLog = eventEmitter.addListener(
      "HarborLogged",
      (result: any) => {
        console.log("HARBOR SDK LOG: ", result);
      }
    );

    return () => {
      subscriptionLog.remove();
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaView style={styles.flexContainer}>
      <View style={styles.controls}>
        <Text style={styles.sectionTitle}>{"Controls"}</Text>
        <Text
          style={styles.sectionTitle}
        >{`Available Lockers: ${accessConfig.available_lockers.length}`}</Text>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.scrollviewOuter}
          contentContainerStyle={styles.scrollviewContent}
        >
          <Button title="Get SDK Credentials" onPress={loadConfig} />
          <Button
            title="Initialize SDK"
            onPress={() => initSdk(accessConfig.sdk_token, SDK_ENV)}
            disabled={!accessConfig.sdk_token || accessConfig.sdk_initializated}
          />
          <Button
            title="My Tower Is In Range?"
            onPress={discoverMyTower}
            disabled={!accessConfig.sdk_initializated}
          />
          <Button
            title="Connect to My Tower"
            onPress={() => connectToMyTower(MY_TOWER_ID)}
            disabled={!towerInRange}
          />
          <Button
            title="Get Available Lockers"
            onPress={() =>
              getAvailableLockersForDropOff(
                MY_TOWER_ID,
                accessConfig.api_access_token
              )
            }
            disabled={!accessConfig.my_tower_is_synced}
          />
          <Button
            title="Reopen last locker"
            onPress={reOpenLastDoorOpened}
            disabled={!accessConfig.can_reopen_locker}
          />
          <Button
            title="Disconnect from Tower"
            onPress={endTowerSession}
            disabled={!accessConfig.my_tower_is_synced}
          />
        </ScrollView>
      </View>
      <View style={styles.lockerLst}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.scrollviewOuter}
          contentContainerStyle={styles.scrollviewContent}
        >
          {accessConfig.available_lockers.map((locker) => (
            <Button
              title={`Open locker ${locker.name}`}
              onPress={() =>
                openLockerForDropOff(
                  MY_TOWER_ID,
                  locker.id,
                  accessConfig.api_access_token
                )
              }
              disabled={!accessConfig.api_access_token}
              key={locker.id}
            />
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flexContainer: { flex: 1, backgroundColor: "black" },
  controls: { flex: 5 },
  lockerLst: { flex: 3 },
  scrollviewContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 20,
  },
  scrollviewOuter: { flex: 1 },
  sectionTitle: {
    fontSize: 26,
    marginVertical: 16,
    alignSelf: "center",
    color: "#F7EA48",
  },
});

export default App;
