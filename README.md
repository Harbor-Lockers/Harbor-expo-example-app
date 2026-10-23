# harbor-expo-example

A minimal Expo app showing how to drive a physical Harbor tower with
[`@harborlockers/react-native-sdk`](https://www.npmjs.com/package/@harborlockers/react-native-sdk)
**without writing any native code**. It is a reference for developers, not a product: one screen
(`App.tsx`) walks through the SDK flow step by step, and everything else exists only because the
SDK needs it.

```
App.tsx                      the whole flow: credentials → init → discover → connect → lockers → open → reopen → disconnect
lib/harbor.ts                safe access to the SDK (is it in this binary? typed events, readable errors)
lib/api.ts                   the Harbor cloud API calls the flow uses (fetch, no dependencies)
lib/permissions.ts           Android runtime permissions for BLE
plugins/withHarborLockers.js config plugin: iOS/Android permissions + a Gradle pin the SDK needs (see below)
credentials-example.ts       copy to credentials.ts (git-ignored; npm install does it) and fill in
__tests__/                   the two pieces above, tested without a device
```

Dependencies: `expo`, `expo-dev-client`, `expo-constants`, `expo-status-bar`, `react`,
`react-native`, the SDK. No router, navigation, theming or HTTP library – bring your own.

## Expo Go vs. a development build (read this first)

The SDK is native code (Java + the `harbor-android-sdk` AAR, Objective‑C + the `HarborLockersSDK`
pod). Native code only exists in a binary compiled with it.

| | Expo Go (store app) | Development build (`eas build --profile development`) |
|---|---|---|
| Bluetooth / Harbor SDK | **Not present** – `NativeModules.HarborLockersSDK` is `undefined` | Present |
| Native code you write | None | **None** – `expo prebuild` + the config plugin generate it |
| Can talk to a tower | No, by any JavaScript | Yes |

In Expo Go this app starts, the status card says why the SDK cannot work there, and the cloud
steps (credentials, locker list) still run. Everything that touches the tower needs the
development build. `lib/harbor.ts` is what makes the difference a message instead of a crash.

## Setup

```sh
npm install            # creates credentials.ts from credentials-example.ts if missing
```

Fill in `credentials.ts`: `CLIENT_ID`, `CLIENT_SECRET`, `SDK_ENV` (`sandbox` | `development` |
`production`), `MY_TOWER_ID` (16 hex characters).

## Build the development build (once, then reuse)

```sh
npm install -g eas-cli && eas login && eas init     # links the project to your Expo account
npm run build:dev:android                            # free; EAS gives you an APK link/QR to install
npm run build:dev:ios                                # needs an Apple Developer Program membership
                                                     # (+ `eas device:create` to register the iPhone)
```

Rebuild only when native dependencies change (e.g. a new SDK version). JS changes hot‑reload.
Local alternative with Android Studio / Xcode installed: `npm run android` / `npm run ios`.

## Run

```sh
npm run start:dev-client   # then open the *harbor-expo-example* app on the phone, not Expo Go
npm start                  # Expo Go mode (cloud steps + the "why not here" explanation only)
```

Phone and computer must share a network; otherwise `npm run start:tunnel`.

## Things about the SDK you will run into (all handled here)

* **`NoClassDefFoundError: kotlinx/datetime/Clock$System` in `HarborSDK.sendRequestSession`
  (Android dev builds).** The Harbor Android SDK is compiled against kotlinx-datetime 0.6.x;
  0.7 moved `Clock`/`Instant` into the Kotlin stdlib and dropped those classes; `expo-dev-launcher`
  (debug builds) depends on 0.7.1 and wins Gradle's version conflict. The config plugin forces
  `kotlinx-datetime:0.7.1-0.6.x-compat`, JetBrains' build with both the old classes and the new
  APIs. Gradle change ⇒ needs a native build to take effect.
* **Never call `setLogLevel()`** with SDK 1.0.39: it installs a native log forwarder that crashes the
  process on some messages (iOS: `nil` log context in an `NSDictionary` literal; Android: `byte[]`
  context cast to `Object[]`). The app keeps its own on‑screen log instead.
* **One connect at a time.** The native module keeps a single pending connect promise and can settle
  it twice if `connectToTowerWithIdentifier()` is called again while connecting (fatal on Android).
* **`sendOpenLockerWithTokenCommand` resolves a number** (the tower's locker id), not an array.
* **Ports with no lock connected.** The tower accepts the open command anyway. The door sensor is
  the tell: the app polls `sendCheckLockerDoorCommand` every 500 ms for 6 s after an accepted open –
  a connected lock reports open within that window, an empty port never does → "No lock detected"
  alert + red locker button. A stuck door looks the same, hence the Reopen hint. Durable fix: mark
  such lockers out of service in the Harbor console.
* **Reopen → `Sys_last_open_info: … (503)`.** The tower has no "last opened locker" record. Reopen
  re‑fires the latch of the last open command in this session; the record is gone once that door has
  opened. The button is enabled as soon as an open is accepted, which is when it is useful.
* **Scanning the QR gives "No usable data found".** Expo Go isn't installed, or you scanned a
  dev‑client QR (`npm run start:dev-client`) without the dev build installed yet. `.env` sets
  `EXPO_NO_REDIRECT_PAGE=1` so each mode prints a direct QR instead of a chooser page whose
  "Development Build" button only deep‑links into an already installed build.
* **Expo Go only runs the latest Expo SDK.** If it refuses the project:
  `npx expo install expo@latest && npx expo install --fix` (nothing here is SDK‑specific).

## Scripts

`npm test` · `npm run typecheck` · `npm run lint`
