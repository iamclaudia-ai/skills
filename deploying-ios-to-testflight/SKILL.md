---
name: deploying-ios-to-testflight
description: "MUST be used when archiving an iOS app and uploading it to App Store Connect or TestFlight from the command line, or when bumping an iOS app's version/build number for a new release. Covers the version bump in project.pbxproj, xcodebuild archive, exportArchive upload with automatic signing, and the Homebrew-rsync 'Copy failed' export bug. Includes per-project notes (Fuse3 / Fuse3b). Triggers on: deploy to TestFlight, upload to App Store Connect, archive the app, archive and upload, TestFlight expired, TestFlight build expiring, refresh TestFlight, new TestFlight build, bump app version, bump build number, xcodebuild archive, exportArchive, Copy failed, distribute app, ship iOS build, Fuse3 deploy."
---

# Deploying iOS Apps to TestFlight

Archive and upload iOS builds to App Store Connect entirely from the terminal. Xcode
already has Michael's Apple ID signed in, so `-allowProvisioningUpdates` handles
certificates and profiles automatically, with no API key needed.

## When to Use

- A TestFlight build is about to expire (90 days) and needs a refresh
- A fix needs to ship to internal testers
- Bumping `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` before a release

## Available Commands

- **`deploy`**: archive each scheme, then export and upload it to App Store Connect

```bash
anima skills run deploying-ios-to-testflight deploy /abs/path/App.xcworkspace SchemeA SchemeB --sync
```

Each scheme takes about 3-5 minutes to archive plus 2 minutes to upload. `longRunning` is set, so
without `--sync` it queues as a task (`anima skills task <id> --watch`). Archives
go to `~/Library/Developer/Xcode/Archives/<date>/`, so they appear in Xcode's Organizer.
The script prints a log directory; check the per-scheme logs there on failure.

When App Store Connect is slow, an upload can loop on "asset-description… is not yet
complete; will check status in 5 seconds" for 10+ minutes. A two-scheme deploy then runs past
the 10-minute Bash timeout. That's Apple, not a hang: re-run `anima skills task <id> --watch`
and check the `*-upload.log` files in the log directory.

## Instructions

1. **Bump the version.** Every upload needs a build number App Store Connect has never seen.
   - Find the values: `grep -n "MARKETING_VERSION\|CURRENT_PROJECT_VERSION" <proj>/project.pbxproj`
   - Each target has Debug and Release configs, so expect 2 lines per target. Only bump the
     targets being shipped. Do **not** use `agvtool`, because it changes every target.
   - Edit by exact value (e.g. `CURRENT_PROJECT_VERSION = 10709;` → `10710;`) and confirm the
     line count afterwards.
   - Check `git diff` first. Michael often deploys from Xcode without committing, so an
     uncommitted bump has probably already been uploaded. Bump past it, not to it.
2. **Compile check** (optional but cheap): `xcodebuild -workspace ... -scheme X -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`
3. **Deploy** with the `deploy` command above.
4. **Commit** using conventional commits and push when done.
5. Tell Michael the builds are processing; they show up in TestFlight in about 10-20 minutes.

## The "Copy failed" Gotcha (Homebrew rsync)

`xcodebuild -exportArchive` fails with only `error: exportArchive Copy failed` when
Homebrew's rsync is on PATH. The real error is buried in
`$TMPDIR/<Scheme>_<date>.xcdistributionlogs/IDEDistributionPipeline.log`:

```
Running /usr/bin/rsync '-8aPhhE' ...
rsync error: syntax or usage error (code 1) at main.c(1806) [server=3.4.4]
```

Apple's `/usr/bin/rsync` is openrsync. For a local copy it spawns its server half via a
PATH lookup, finds `/opt/homebrew/bin/rsync` (3.4.x), and the protocols don't match.
**Fix:** run xcodebuild with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. The deploy script
already does this. Xcode's GUI Organizer is unaffected because Dock-launched apps don't get
the shell PATH.

## Other Gotchas

- **dcg hook:** inline Bash with a redirect to a `$VAR` path, or a `$VAR`-named executable,
  is blocked. Use literal paths or run the script file.
- **`ITSAppUsesNonExemptEncryption`:** set it to `NO` in every target's Info.plist. Otherwise each
  build waits in TestFlight on the export-compliance question.
- **iOS 27+ requires the UIScene lifecycle.** Apps without a scene manifest crash at launch
  in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. To fix, add a `SceneDelegate`
  plus `UIApplicationSceneManifest` (see Fuse3 commit `fb93a2c` for a storyboard-based example).

## Known Projects

### Fuse3 (`~/Projects/fuse/fuse3ios`)

- Workspace: `Fuse3.xcworkspace` (CocoaPods). Remote: `onezerone/Fuse3Revamp`, branch `master`.
- **Fuse3** (`ai.apptimum.fuse3`) and **Fuse3b** (`ai.apptimum.fuse3b`) are the same app
  under two bundle IDs, to get past the 100-internal-tester limit. Ship both, with the same version.
- Info.plists: `Fuse3/Info.plist` (Fuse3) and `Fuse3 copy-Info.plist` (Fuse3b). Keep them identical.
- **FuseSteris** is ignored unless Michael asks. It is on its own version track (1.7.7 / 10707).
- Version scheme: `1.7.N` ↔ build `107NN` (1.7.10 → 10710).
- Usually only refreshed when the 90-day TestFlight build expires. The app will be retired once
  Evolution is in the App Store.

```bash
anima skills run deploying-ios-to-testflight deploy ~/Projects/fuse/fuse3ios/Fuse3.xcworkspace Fuse3 Fuse3b --sync
```

### Fuse IGT (`~/Projects/fuse/fuse-igt-ios`)

- Workspace: **`4.xcworkspace`** (project `4.xcodeproj`). Ignore `FuseIGT.xcworkspace`, which
  is stale and references a path on a former developer's machine. Remote: `onezerone/fuse-igt-ios`, branch `master`.
- **FuseIGT** (`ai.apptimum.fuse.igt`, `FuseIGT/Info.plist`) and **SignalMountain**
  (`ai.apptimum.fuse.signalmountain`, `SignalMountain.plist`): ship both, with the same version.
  Their plists differ on purpose (display name, orientations).
- Version scheme: `1.15.N` ↔ build `115NN` (1.15.11 → 11511).
- Toasts force-unwrap `(UIApplication.shared.delegate as! AppDelegate).window!`, so the
  SceneDelegate must hand its window back to AppDelegate.
- Templates download from `<currentURL>/Content/Templates/<Client>/<file>`. The `Client` comes
  from the Info.plist (`GTECH`). SignalMountain always uses `https://signalmountain.fuse.do`.
  If you see "Unable to find file X.json", check the ETag/Caches handling first (fixed in `d91b858`).

```bash
anima skills run deploying-ios-to-testflight deploy ~/Projects/fuse/fuse-igt-ios/4.xcworkspace FuseIGT SignalMountain
```
