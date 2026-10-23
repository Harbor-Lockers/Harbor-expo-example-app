/**
 * Harbor SDK reference flow, top to bottom:
 *
 *   1. Get SDK credentials      Harbor cloud API (works everywhere)
 *   2. Initialize SDK           permissions + setAccessToken + initializeSDK
 *   3. My tower is in range?    startTowersDiscovery -> "TowersFound" event
 *   4. Connect to my tower      connectToTowerWithIdentifier -> sendRequestSessionAdvanced -> syncConnectedTower
 *   5. Get available lockers    Harbor cloud API
 *   6. Open locker X            drop-off token (API) -> sendOpenLockerWithTokenCommand -> door check
 *   7. Reopen last locker       sendReopenLockerCommand
 *   8. Disconnect               sendTerminateSession
 *
 * Steps 2–8 need the native SDK, i.e. a development/production build. In Expo
 * Go the status card explains why they cannot work; nothing crashes.
 */

import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Config from './credentials';
import * as API from './lib/api';
import {
  addHarborListener,
  describeError,
  getHarborAvailability,
  getHarborSDK,
  HarborUnavailableError,
  type HarborSDK,
} from './lib/harbor';
import { requestTowerPermissions } from './lib/permissions';

const MY_TOWER_ID = (Config.MY_TOWER_ID ?? '').trim();
/** Session role passed to the session request (from Harbor's sample). */
const SESSION_ROLE = 5;
/** Session duration in seconds (the SDK's own default for sendRequestSession). */
const SESSION_DURATION = 60 * 60;
/** Seconds to wait for the door sensor after the tower accepts an open command. */
const DOOR_TIMEOUT = 6;
const DOOR_POLL_MS = 500;

type LastOpen = { lockerName: string; lockerNumber: number; acceptedAt: number; doorOpened: boolean };

type LogLine = { id: number; time: string; level: 'INFO' | 'WARNING' | 'ERROR'; message: string };

const availability = getHarborAvailability();

export default function App() {
  // ---- cloud state
  const [credentials, setCredentials] = useState<API.Credentials | null>(null);
  // ---- tower state
  const [harbor, setHarbor] = useState<HarborSDK | null>(null); // set once the SDK is initialized
  const [towerInRange, setTowerInRange] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [lockers, setLockers] = useState<API.Locker[]>([]);
  const [lockersWithoutLock, setLockersWithoutLock] = useState<string[]>([]);
  const [lastOpen, setLastOpen] = useState<LastOpen | null>(null);
  // ---- on-device log (a phone has no console)
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logId = useRef(0);
  const log = useCallback((message: string, level: LogLine['level'] = 'INFO') => {
    const time = new Date().toLocaleTimeString(undefined, { hour12: false });
    setLogs((prev) => [...prev.slice(-199), { id: ++logId.current, time, level, message }]);
  }, []);

  const alert = (title: string, body: string) => Alert.alert(title, body, [{ text: 'OK' }]);
  const fail = (title: string, error: unknown) => {
    log(`${title}: ${describeError(error)}`, 'ERROR');
    alert(error instanceof HarborUnavailableError ? 'Harbor SDK not available here' : title, describeError(error));
  };

  // ---- SDK events. Safe in Expo Go (no-op subscriptions).
  useEffect(() => {
    const found = addHarborListener('TowersFound', (towers) => {
      log(`TowersFound: ${towers.map((t) => `${t.towerId} "${t.towerName}" rssi ${t.rssi}`).join(', ') || 'none'}`);
      if (towers.some((t) => t.towerId.toLowerCase() === MY_TOWER_ID.toLowerCase())) setTowerInRange(true);
    });
    const disconnected = addHarborListener('TowerDisconnected', (tower) => {
      log(`TowerDisconnected: ${tower.towerId} "${tower.towerName}"`, 'WARNING');
      setConnecting(false);
      setConnected(false);
      setSynced(false);
      setLockers([]);
      setLastOpen(null);
    });
    return () => {
      found.remove();
      disconnected.remove();
    };
  }, [log]);

  // ---- 1. credentials (cloud)
  const loadCredentials = async () => {
    try {
      setCredentials(await API.retrieveCredentials(Config.CLIENT_ID, Config.CLIENT_SECRET));
      log('SDK credentials retrieved from the Harbor API');
    } catch (error) {
      fail('Could not get SDK credentials', error);
    }
  };

  // ---- 2. initialize the SDK
  const initSdk = async () => {
    if (!credentials) return;
    try {
      const sdk = getHarborSDK(); // throws with a reason in Expo Go
      const permissions = await requestTowerPermissions();
      if (!permissions.granted) {
        alert('Permissions needed', `Grant these in your device settings:\n\n${permissions.denied.join('\n')}`);
        return;
      }
      sdk.setAccessToken(credentials.sdk_token, Config.SDK_ENV);
      sdk.initializeSDK();
      // Do NOT call sdk.setLogLevel(): with SDK 1.0.39 the native log forwarder can crash the app
      // (iOS: nil log context in an NSDictionary literal; Android: byte[] context cast to Object[]).
      setHarbor(sdk);
      log(`SDK initialized for environment "${Config.SDK_ENV}"`);
    } catch (error) {
      fail('Could not initialize the SDK', error);
    }
  };

  // ---- 3. discovery
  const discoverMyTower = () => {
    if (!harbor) return;
    if (!MY_TOWER_ID) {
      alert('Missing tower id', 'Set MY_TOWER_ID in credentials.ts (16 hexadecimal characters).');
      return;
    }
    try {
      setTowerInRange(false);
      harbor.startTowersDiscovery();
      log(`Scanning for tower ${MY_TOWER_ID}`);
    } catch (error) {
      fail('Could not start discovery', error);
    }
  };

  // ---- 4. connect + session + sync
  const connectToMyTower = async () => {
    // One connect at a time: the native module keeps a single pending promise and can settle it
    // twice if asked again while connecting (fatal on Android).
    if (!harbor || connecting || connected) return;
    setConnecting(true);
    let step = 'Error connecting to tower';
    try {
      const towerName = await harbor.connectToTowerWithIdentifier(MY_TOWER_ID);
      setConnected(true);
      log(`Connected to "${towerName}", requesting session (role ${SESSION_ROLE})`);
      step = 'Error establishing session';
      await requestSession(harbor);
      log('Session established, syncing tower with the Harbor cloud');
      // Sync explicitly and wait for its result. The session above is requested with the SDK's
      // automatic sync disabled, so this is the only sync running: it resolves when the tower and
      // the cloud are in sync, and rejects with the tower's / cloud's error instead of leaving us
      // to poll isSyncing() against a background process we can neither observe nor time.
      step = 'Tower could not sync';
      await harbor.syncConnectedTower();
      setSynced(true);
      log('Tower synced');
    } catch (error) {
      fail(step, error);
    } finally {
      setConnecting(false);
    }
  };

  // ---- 5. lockers (cloud)
  const loadLockers = async () => {
    if (!credentials) return;
    try {
      const all = await API.getAllLockersInTower(MY_TOWER_ID, credentials.api_access_token);
      const available = all.filter((l) => l.status?.name === 'available');
      setLockers(available);
      log(`Backend lockers (${all.length}): ${all.map((l) => `${l.name}=${l.status?.name ?? '?'}`).join(', ')}`);
      log(`${available.length} locker(s) available for drop-off`);
      if (available.length === 0) alert('No lockers', 'The tower reports no available lockers for drop-off.');
    } catch (error) {
      fail('Could not load lockers', error);
    }
  };

  // ---- 6. open
  const openLocker = async (locker: API.Locker) => {
    if (!harbor || !credentials) return;
    try {
      const token = await API.createDropOffToken(MY_TOWER_ID, locker.id, credentials.api_access_token);
      // Resolves with the tower's numeric locker id (not the API's locker uuid).
      const lockerNumber = await harbor.sendOpenLockerWithTokenCommand(token.payload, token.payload_auth);
      log(`Tower accepted open command for "${locker.name}" (locker #${lockerNumber}); tracking door`);
      // Reopen is available from this moment: it re-fires the latch if the door did not pop open.
      setLastOpen({ lockerName: locker.name, lockerNumber, acceptedAt: nowMs(), doorOpened: false });
      void trackDoor(locker);
    } catch (error) {
      fail(`Could not open locker ${locker.name}`, error);
    }
  };

  const readDoorState = () => new Promise<boolean>((resolve) => harbor?.sendCheckLockerDoorCommand(resolve));

  /**
   * The tower accepts an open command even for a port with no lock connected; the door sensor is
   * what tells the difference. A connected lock reports "open" within the window, an empty port
   * never does (a stuck door on a real lock looks the same – hence the Reopen hint).
   */
  const trackDoor = async (locker: API.Locker) => {
    const timeline: string[] = [];
    let openedAfterMs: number | null = null;
    for (let elapsed = 0; elapsed <= DOOR_TIMEOUT * 1000; elapsed += DOOR_POLL_MS) {
      if (elapsed > 0) await sleep(DOOR_POLL_MS);
      const open = await readDoorState();
      timeline.push(`${(elapsed / 1000).toFixed(1)}s=${open ? 'open' : 'closed'}`);
      if (open) {
        openedAfterMs = elapsed;
        break;
      }
    }
    log(`Door timeline for "${locker.name}": ${timeline.join(' ')}`, openedAfterMs === null ? 'WARNING' : 'INFO');

    if (openedAfterMs !== null) {
      setLockers((prev) => prev.filter((l) => l.id !== locker.id));
      setLockersWithoutLock((prev) => prev.filter((id) => id !== locker.id));
      setLastOpen((prev) => (prev ? { ...prev, doorOpened: true } : prev));
      log(`Door of "${locker.name}" opened ${openedAfterMs}ms after the tower accepted the command`);
      return;
    }
    setLockersWithoutLock((prev) => (prev.includes(locker.id) ? prev : [...prev, locker.id]));
    log(`No lock detected on "${locker.name}": door never reported open within ${DOOR_TIMEOUT}s`, 'ERROR');
    alert(
      `No lock detected on ${locker.name}`,
      `The tower accepted the open command for ${locker.name}, but its door sensor never reported the door ` +
        `opening (checked for ${DOOR_TIMEOUT} seconds). Most likely no lock is connected to this port.\n\n` +
        'If a lock is installed and the door is just stuck, press "Reopen last locker" to fire the latch again. ' +
        'Otherwise mark this locker out of service in the Harbor console so it is no longer offered as available.'
    );
  };

  // ---- 7. reopen
  const reopenLastLocker = async () => {
    if (!harbor || !lastOpen) return;
    const secondsSinceOpen = Math.round((nowMs() - lastOpen.acceptedAt) / 1000);
    const doorNow = await readDoorState();
    const context =
      `${secondsSinceOpen}s after the open command; door ${doorNow ? 'open' : 'closed'} when pressed; ` +
      `door ${lastOpen.doorOpened ? 'had' : 'had not'} been seen open`;
    try {
      log(`Reopen requested for "${lastOpen.lockerName}" (#${lastOpen.lockerNumber}): ${context}`);
      const lockerNumber = await harbor.sendReopenLockerCommand();
      log(`Tower accepted reopen for locker #${lockerNumber}`);
      void trackDoor({ id: '', name: lastOpen.lockerName });
    } catch (error) {
      log(`Reopen refused: ${describeError(error)} (${context})`, 'ERROR');
      if (String((error as { code?: unknown })?.code) === '503') {
        // The tower holds no "last opened locker" record: reopen re-fires the last open command of
        // this session and the record is gone once that door has opened / after a new session.
        alert(
          'Tower has no locker to reopen',
          `The tower answered that it holds no valid "last opened locker" record (503). This is the tower\u2019s ` +
            `decision, not an app error.\n\nContext: ${context}.`
        );
      } else {
        fail('Could not reopen locker', error);
      }
    }
  };

  // ---- 8. disconnect
  const disconnect = async () => {
    if (!harbor) return;
    try {
      await harbor.sendTerminateSession(0, 'Session terminated by user');
      log('Session terminated');
    } catch (error) {
      fail('Could not terminate session', error);
    } finally {
      setConnecting(false);
      setConnected(false);
      setSynced(false);
      setTowerInRange(false);
      setLockers([]);
      setLastOpen(null);
    }
  };

  const noLockNames = lockers.filter((l) => lockersWithoutLock.includes(l.id)).map((l) => l.name);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* Which runtime is this, and can the SDK work here? */}
      <View style={styles.card}>
        <Text style={[styles.cardTitle, { color: availability.available ? '#35C759' : '#FF453A' }]}>
          {availability.available ? '● Harbor SDK available' : '● Harbor SDK unavailable'}
        </Text>
        <Text style={styles.cardMeta}>
          {availability.isExpoGo ? 'Expo Go' : `Execution: ${Constants.executionEnvironment}`} · SDK{' '}
          {require('@harborlockers/react-native-sdk/package.json').version}
        </Text>
        {availability.reason ? <Text style={styles.cardBody}>{availability.reason}</Text> : null}
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.controls}>
        <DemoButton title="1. Get SDK credentials" onPress={() => void loadCredentials()} />
        <DemoButton title="2. Initialize SDK" onPress={() => void initSdk()} disabled={!credentials || !!harbor} />
        <DemoButton
          title={towerInRange ? '3. My tower is in range ✓' : '3. My tower is in range?'}
          onPress={discoverMyTower}
          disabled={!harbor}
        />
        <DemoButton
          title={connecting ? 'Connecting…' : '4. Connect to my tower'}
          onPress={() => void connectToMyTower()}
          disabled={!towerInRange || connecting || connected}
        />
        <DemoButton title="5. Get available lockers" onPress={() => void loadLockers()} disabled={!synced} />

        {noLockNames.length > 0 ? <Text style={styles.noLock}>{`⚠ No lock detected on: ${noLockNames.join(', ')}`}</Text> : null}
        {lockers.map((locker) => {
          const noLock = lockersWithoutLock.includes(locker.id);
          return (
            <DemoButton
              key={locker.id}
              title={noLock ? `⚠ No lock detected – retry ${locker.name}` : `6. Open locker ${locker.name}`}
              color={noLock ? '#FF453A' : undefined}
              onPress={() => void openLocker(locker)}
            />
          );
        })}

        <DemoButton
          title={
            lastOpen
              ? `7. Reopen last locker (${lastOpen.lockerName}, ${lastOpen.doorOpened ? 'door opened' : 'door not seen open'})`
              : '7. Reopen last locker'
          }
          onPress={() => void reopenLastLocker()}
          disabled={!lastOpen}
        />
        <DemoButton title="8. Disconnect from tower" onPress={() => void disconnect()} disabled={!connected} />
      </ScrollView>

      <View style={styles.logHeader}>
        <Text style={styles.logTitle}>Log</Text>
        <Pressable onPress={() => setLogs([])}>
          <Text style={styles.logClear}>clear</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
        {logs.map((line) => (
          <Text key={line.id} style={[styles.logLine, { color: LOG_COLOR[line.level] }]}>
            <Text style={styles.logTime}>{line.time} </Text>
            {line.message}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function DemoButton({
  title,
  onPress,
  disabled = false,
  color = '#F7EA48',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.button, { backgroundColor: color, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nowMs = () => Date.now();

/**
 * Requests a tower session with the SDK's automatic background sync turned off, so the sync can
 * be run and awaited explicitly (see connectToMyTower). Wraps the SDK's callback pair in a
 * promise; a failure rejects with an Error carrying the tower's error code.
 */
const requestSession = (sdk: HarborSDK) =>
  new Promise<void>((resolve, reject) =>
    sdk.sendRequestSessionAdvanced(
      false,
      SESSION_DURATION,
      SESSION_ROLE,
      (errorCode, errorMessage) => reject(Object.assign(new Error(errorMessage), { code: String(errorCode) })),
      () => resolve()
    )
  );

const LOG_COLOR = { INFO: '#E5E5EA', WARNING: '#FF9F0A', ERROR: '#FF453A' } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', paddingTop: Constants.statusBarHeight },
  flex: { flex: 1 },
  card: { margin: 12, padding: 12, borderRadius: 12, backgroundColor: '#1C1C1E' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardMeta: { color: '#8E8E93', fontSize: 12, marginTop: 4 },
  cardBody: { color: '#E5E5EA', fontSize: 13, lineHeight: 18, marginTop: 8 },
  controls: { alignItems: 'center', paddingVertical: 8, gap: 10 },
  button: { width: '90%', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { color: '#000', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  noLock: { color: '#FF453A', fontWeight: '600', textAlign: 'center', marginHorizontal: 16 },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3A3A3C',
  },
  logTitle: { color: '#F7EA48', fontSize: 14, fontWeight: '600' },
  logClear: { color: '#8E8E93', fontSize: 13 },
  log: { flex: 1, maxHeight: 220 },
  logContent: { padding: 12 },
  logLine: { fontSize: 11, lineHeight: 15, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  logTime: { color: '#636366' },
});
