---
name: driving-test-devices
description: "MUST be used when installing, launching, tapping, screenshotting, rotating or otherwise driving a real phone or tablet (iPhone, iPad, Pixel, Galaxy, BOOX) or a simulator/emulator from the Mac without a human touching it. Covers the device roster and which ones are safe to drive, devicectl (install, launch with arguments, console, screenshot, orientation), WebDriverAgent taps/typing/swipes on iOS via wda.py, adb input/screencap/rotation on Android, AXe and SimCam on the Simulator, headless emulators, and the traps (interface-only rotation, points vs pixels, stale bundles, production data). Triggers on: tap the phone, tap the iPad, drive the device, device automation, UI automation, screenshot the phone, screenshot the iPad, rotate the device, landscape test, install on device, deploy to my phone, launch the app on device, devicectl, WebDriverAgent, WDA, wda.py, adb tap, adb screencap, adb input, emulator, simulator taps, AXe, SimCam, test station, test rig, camera test, scanner test on device, e-ink, BOOX, turntable."
---

# Driving Test Devices

Every device on the test bench can be driven from the Mac: install, launch, tap, type, rotate,
screenshot. Use this instead of asking Michael to touch a phone.

## When to Use

- Installing a build on a phone or tablet and checking it launched and survived.
- Seeing what is on a device's screen (screenshots are images: Read them).
- Tapping through an app on iOS (WebDriverAgent) or Android (adb).
- Rotation / landscape tests, camera and scanner tests against a printed or e-ink target.
- Simulator or emulator runs when no real device is needed.

## Device roster

| Device | ID | Network name | Notes |
| --- | --- | --- | --- |
| Claudia's iPhone 15 | `00008120-000268DA26F3C01E` | `claudias-iphone-15` | mine. WDA in tmux `wda-claudia`. 3x screen |
| Claudia's iPad (A16, 11") | `00008120-0006452E3CE20032` | `claudias-ipad` | mine. WDA in tmux `wda-ipad`. 2x, 1640x2360 px |
| Michael's iPhone 15 Pro Max | `00008130-001E552A20FA8D3A` | (Wi-Fi via devicectl) | his. Install/launch/screenshot only, no WDA |
| Claudia's Galaxy S25 | `R3CXC0LS9BR` | `claudias-galaxy-s25` | mine. Small phone (3-across grids) |
| Pixel 7a | `34061JEHN03815` | | Michael's dev phone |
| BOOX Go 10.3 Gen II | `448EDB98` | Wi-Fi `192.168.1.135` | e-ink scan target, adb (model `Go103`, ONYX). Wi-Fi MAC `00:0a:67:cf:a2:e5`; UniFi mislabels it "Nokia 6". Doesn't answer ping. See "Test station" |

`xcrun devicectl list devices` and `adb devices -l` show what is reachable right now. A device
listed as "unavailable" is asleep or off Wi-Fi: ask Michael to wake or plug it in.

**What may be driven:** my devices freely. Michael's phones: install and launch dev/test builds
he asked for, nothing else. Apps signed in to FUSE production: **only Hotel Zanzibar** is test
data. Never confirm anything that writes to a real project (Check In, Use Photo, a barcode field
that saves on scan).

## iOS: devicectl (install, launch, look, rotate)

Xcode 27's `devicectl` does everything except touch.

```bash
D=00008120-0006452E3CE20032   # the iPad
xcrun devicectl device install app --device $D path/to/App.app
xcrun devicectl device process launch --terminate-existing --device $D com.example.app
xcrun devicectl device process launch --terminate-existing --device $D com.example.app -- -someKey value   # launch args AFTER `--`
timeout 20 xcrun devicectl device process launch --console --terminate-existing --device $D com.example.app > ./tmp/console.log 2>&1   # stdout/stderr + NSLog
xcrun devicectl device info processes --device $D | grep -c MyApp.app     # still alive?
xcrun devicectl device capture screenshot --device $D --destination ./tmp/shots/x.png
xcrun devicectl device orientation get --device $D
xcrun devicectl device orientation set --device $D landscapeLeft   # portrait, portraitUpsideDown, landscapeLeft, landscapeRight
```

- **Put the app's arguments after `--`.** Without it devicectl parses them as its own flags:
  `-harnessCollect 1` failed with "Missing value for '-l <path>'".
- **Launch arguments land in NSUserDefaults** (`-key value`). React Native reads them with
  `Settings.get('key')` (iOS only). That is how an app opens a screen without a tap: the
  claudia-scan harness takes `-harnessOpen scan|batch|text -harnessCollect 1` (room mode was
  removed in claudia-scan 0.4.0).
- devicectl screenshots of a WDA-driven device show a blue automation banner; `wda.py shot` doesn't.
- `--console` without `timeout` never returns.
- A device the build's profile doesn't include fails to install ("profile doesn't include the
  device"). Build once with `xcodebuild ... -allowProvisioningUpdates -allowProvisioningDeviceRegistration`.
  In an Expo app with Skia, run it **from the repo root** (Skia's script path is relative).
- Error 4016 "usage assertion requirements" = the device is asleep/unreachable.

## iOS: WebDriverAgent (taps, typing, swipes, element tree)

iOS has no `adb input`. WebDriverAgent (appium/WebDriverAgent, cloned at
`~/Projects/3votech/WebDriverAgent`) runs as an XCUITest on the device and serves HTTP on 8100.

```bash
W=~/Projects/iamclaudia-ai/skills/driving-test-devices/scripts/wda.py
WDA_DEVICE=ipad python3 $W status          # "WDA 16.15.3 iOS 27.2 ready"
WDA_DEVICE=ipad python3 $W tree '^Room'    # labels + frames (points)
WDA_DEVICE=ipad python3 $W taplabel Room
WDA_DEVICE=ipad python3 $W tap 410 472
WDA_DEVICE=ipad python3 $W hold 410 472 150
WDA_DEVICE=ipad python3 $W type 'hello'
WDA_DEVICE=ipad python3 $W swipe 400 900 400 300
WDA_DEVICE=ipad python3 $W rotate landscape
WDA_DEVICE=ipad python3 $W shot ./tmp/shots/x.png
```

`WDA_DEVICE` is `iphone` (default) or `ipad`; `WDA_HOST=http://host:8100` for anything else.
Also runnable as `anima skills run driving-test-devices wda <args>`.

**Coordinates are points**: screenshot pixels divided by the scale (3 on the iPhone 15, 2 on
the iPad). The Read tool may show a screenshot downscaled; it says by how much. Prefer
`taplabel` / `tree` over computed coordinates. On the iPad the Read tool typically shows a
2000-px-wide landscape shot of a 1180-pt screen: **x × 0.59** gets points. Tapping at the
screenshot's own x lands far to the right (a 320-pt sidebar tapped at "x=400" missed it and
looked like a bug).

**`tree` lists every mounted view, including ones off screen** (a pager's neighbouring pages,
a hidden sidebar). A label in `tree` is not proof it is visible: confirm with `shot`.

**Starting the runner** (if `status` fails), in its tmux session, from the WDA folder:

```bash
tmux new -d -s wda-ipad -c ~/Projects/3votech/WebDriverAgent \
  'xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
   -destination id=00008120-0006452E3CE20032 -allowProvisioningUpdates \
   -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM=6J89UB9G96 CODE_SIGN_STYLE=Automatic \
   PRODUCT_BUNDLE_IDENTIFIER=com.evotechapps.WebDriverAgentRunner test 2>&1 | tee ~/Projects/3votech/evolution-mobile/tmp/dev-builds/wda-ipad.log'
```

Ready when the log shows `ServerURLHere->http://<ip>:8100`. A new device first fails with
"Timed out while enabling automation mode" until **Settings > Developer > Enable UI Automation**
is on (Michael flips it). The screen must stay unlocked: Auto-Lock = Never.

## Android: adb

**Always set `ANDROID_SERIAL`** (several devices are attached; Gradle and adb otherwise pick
wrong or fail). Coordinates are **device pixels**.

```bash
export ANDROID_SERIAL=R3CXC0LS9BR
adb install -r app-release.apk
adb shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1    # launch
adb shell am force-stop com.example.app
adb shell pidof com.example.app                                             # alive?
adb logcat -c; ...; adb logcat -d -b crash | grep -c FATAL                  # crashed?
adb exec-out screencap -p > ./tmp/shots/s25.png                             # literal path (dcg)
adb shell input tap 540 2214
adb shell input swipe 540 1800 540 600 300
adb shell input text 'hello'
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1                               # 0,1,2,3 quarter turns
# restore afterwards: user_rotation 0, accelerometer_rotation 1
adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml ./tmp/ui.xml   # element tree
```

**A tablet width on a phone** (no Android tablet on hand): lower the density so the window is
wider in dp. On the Pixel 7a (1080 px wide), `adb shell wm density 240` gives 720 dp and
`adb shell wm density 180` gives 960 dp (past Evolution's 900-pt room sidebar breakpoint).
Always `adb shell wm density reset` afterwards (420 on the Pixel). The activity may restart on
the change; an Expo DEV client then lands on its launcher and needs the `localhost:8081`
server tapped.

## Simulator and emulator

- **iOS Simulator** taps: AXe (`axe tap -x X -y Y --udid U`, `axe describe-ui`, points). Wrap
  in `timeout 30`. Native alert buttons and Pressables inside ScrollViews need
  `axe touch --down` / `--up` with a 150 ms hold. Screenshots: `xcrun simctl io U screenshot`.
  No camera: SimCam (`simcamctl set-source --back --image x.png` / `--qr "105"`) fakes one.
- **Android emulator in evolution-mobile: load the project skill
  `testing-on-the-android-emulator`.** It boots with `scripts/emulator.js`, installs the one
  arm64 DEV build, drives by label (`ui.sh`), feeds the camera an image or video
  (`--camera`, a 2 s swap with no restart), and has fixtures and a recipe per scanner.
- **Android emulator elsewhere**: `~/Library/Android/sdk/emulator/emulator -avd
  Medium_Phone_API_36.1 -no-window -no-audio` in tmux (serial `emulator-5554`). Tablets:
  `Pixel_Tablet_API_36`, `Small_Tablet_API_36`. Google's Android CLI
  (`$ANDROID_HOME/cmdline-tools/latest/bin/android emulator list|start|stop|create`) replaces
  avdmanager; `start` waits for a full boot, but `create` exits 0 on failure.
- **The emulator's camera can be any file** (checked 2026-11-07, emulator 36.3):
  `-camera-back imagefile:/ABS/x.png` or `videofile:/ABS/x.mp4` (loops). PNG only (a JPEG fails
  silently and the front "pixel house" camera opens); turn the content 90° anticlockwise
  (`sips -r 270`, ffmpeg `transpose=2`). The file is re-read whenever a camera opens, so swap it
  in place (write beside, rename), then background the app and bring it back
  (`input keyevent KEYCODE_HOME`, `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`).
  `-help-camera-back`'s `videoplayback` is stale and refused. `-camera-back virtualscene` gives a
  3D room (its wall poster is `emulator/resources/poster.png`); `adb emu rotate` turns it.

## Traps

- **WDA `rotate` and `devicectl orientation set` turn the interface, not the device.** The
  device stays physically where it is, so a camera aimed at an upright sign sees it upright in
  the world but sideways relative to the rotated UI. The preview is right to show it that way.
  Text filters keyed to the screen ("horizontal only") then drop it. A real landscape camera
  test needs the device physically turned (the planned motorized holder).
- **Judge a rotation on the live preview, not a frozen proof.**
- **A Release Android harness can ship stale JS** when only a library under `node_modules`
  changed (claudia-scan trap 19). Check the bundle is fresh before believing a device result.
- **Record a screen video outside an Expo project, then copy it in.** A new `.mp4` under the
  project (e.g. `./tmp/pr-images/`) is a new file Metro watches, so it reloads the app mid-take
  and the reload eats the first taps. Record into the scratchpad and `cp` afterwards.
  (`adb shell screenrecord` to `/sdcard` is fine; it is the `adb pull` or ffmpeg output path
  that matters. Wait for `--time-limit` to finish before pulling, or the moov atom is missing.)
- Never pipe device commands into `tail`/`head` (tmux wrapper). Write files to literal paths:
  dcg blocks `> $VAR/x.png`.
- A tap while a list or modal is still animating lands on whatever is underneath. Screenshot
  first, then tap.
- Taps can silently stop reaching a Simulator app after the system Save Password sheet: reboot it.

## Test station (being built)

Michael is building a ring of devices around a **BOOX Go 10.3 Gen II** e-ink display (2480x1860,
300 ppi, Android 15, adb) on a **USB turntable**, so a script can show any label, turn it to face
one device, animate it (motion tests), and replay real proof images as regression targets.
Plan for the BOOX: auto-rotate off (its G-sensor would flip the label), adb over Tailscale,
never sleep while charging, full refresh between images, labels rendered at true scale
(3 in = 900 px). Record the setup here once it exists.

**Rotation is done in software, no servo (decided 2026-11-01).** Turn the device's interface
(`wda.py rotate`, `devicectl orientation set`, adb `user_rotation`) and render the e-ink pattern
turned to match. claudia-scan follows the interface rather than gravity, so to the camera and
the scanner this is the same as a person turning the tablet in front of a level label. It
covers rotation mid-scan, rotation lock (portrait UI, sideways pattern) and upside down, on
demand. A physical turn was checked once by hand on the iPad (room mode read "105"); the only
thing software can't show is iPadOS's own response to the accelerometer.

## Per-project notes

- **claudia-scan harness**: `com.evotechapps.claudiascan.harness`, launch args above, builds
  per its CLAUDE.md. Michael's printed stand sheet: QR (room 105), door sign "105", MAC label
  `00:1A:2B:3C:4D:5E`, Code 128 `ZNZTEST000105`.
- **evolution-mobile**: DEV app `com.evotechapps.evolution.dev`; more in that project's memory
  (`ios-automation.md`, `device-testing-photos.md`).
