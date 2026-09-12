# Current verification and security status — 2026-09-12

Mac developer source preview. No public upload or signed installer. Tested on macOS 15.7.4, Apple Silicon, Bun 1.3.10 and OBS 32.1.2. This is an implementation review and observed local testing, not independent certification or a guarantee against every threat.

## Corrected and checked

- Strict Host/Origin, JSON/body schema and size checks; bounded request/socket resources; CSP/framing restrictions; defensive OBS messages and native navigation.
- Missing-mic setup fails closed. Startup stops capture; Start leaves both sources muted; Stop verifies mute and monitoring-off. Native close confirms Stop before exiting the controller and its helpers.
- Dedicated OBS profile/collection guards; unsafe active-output setup/preparation refused; private atomic files/backups, inherited ACL removal, credential rotation while OBS is closed.
- Native diagnostic synchronization and cleanup; atomic helper builds that stop on failure. Controller launches in a separate process group so it survives launcher exit; the panel uses a normal local Mac app bundle.
- Fader requests wait for prior replies and retain the final drag value. Auto-trim now holds within 1.5 dB of target to avoid small repeated adjustments.
- The AppleScript quit path crashed in Qt/Cocoa on the test system. Shutdown now targets the single owned OBS process with SIGTERM, which OBS 32.1.2 handles on its main loop. The subsequent preparation/relaunch completed without a crash prompt and reconnected with one controller connection. [OBS implementation](https://github.com/obsproject/obs-studio/blob/32.1.2/frontend/OBSApp.cpp).

## Verification checklist

FAIL below means the complete acceptance condition was not established; an unrun listening check is not a diagnosed software failure.

| Check | Result | Observed evidence |
|---|---|---|
| Bun suite | PASS | 155 tests, zero failures; includes real controller against fake OBS, invalid requests, lifecycle, file/ACL and launcher failures. |
| Start/native panel/OUT | PASS | Launcher returned successfully; detached controller persisted; native 372×500 panel showed three strips and green OBS/OUT/SRC. |
| Firefox music | PASS | Music playback resumed; tap callbacks advanced with matching input/output peaks; panel and OBS Browser Music meters showed signal. |
| Spoken USB microphone | FAIL — not run | The intended USB condenser was present and real setup succeeded; spoken-mic response was not exercised. |
| Audible final mix/X Space | FAIL — not run | No two-source listening, balance or live speaker-panel acceptance in this session. |
| Change app | PASS for process retargeting | Native selector retargeted to running Music, reporting one tapped process; closed Safari produced amber warning. Firefox restored. No second-app listening claim. |
| OBS restart | PASS after fix | Graceful shutdown, closed-file patch, relaunch on dedicated profile and reconnection observed; one controller connection, no new crash report or controller error spam. |
| Device selectors | PASS for observed control behavior | Native menu selected the connected USB condenser; OBS confirmed its UID, mute and monitoring-off with prior levels retained. Switched local output to built-in speakers, then a display without software volume, then restored CalDigit at 64%. Stale-output volume command rejected with 409; current-device command succeeded. No live mic/listening claim. |
| UI/button review | PASS for exercised controls | Setup and Stop remain visible at 340×440; Escape closes Setup without quitting. Start/Stop transitions, disabled unmute before sharing, locked Mic while sharing, keyboard Music steps, Auto Level and local mute toggles observed with settings restored. Missing-device Start and mute-during-drag regression tests pass. Preparation/rebuild and broadcast unmute not exercised in this review. |
| Native close | PASS | While capturing, close stopped tap, muted both sources, disabled both monitors and exited controller/helpers. Restart returned to stopped state. |
| Window movement and resizing | PASS | Visible native title bar restored outside WebKit. Actual title-bar drag moved the panel; corner drag resized it from 409×526 to 463×583. Reopening restored the same position and size; all three levels stayed unchanged. |
| Auto-trim | PASS for measured steady segment | 40 samples over ~45 seconds: trim held +4.5 dB, OBS gain matched every sample; tap peak + gain ranged −10.96…−9.35 dBFS. Earlier 0.5 dB hunting motivated the tested deadband. This estimate is before the compressor; no audible-pumping, track-change or long-session sign-off. |
| Protected OBS configuration | PASS for checked files | Two protected scene files matched pre-session SHA-256 fingerprints after restarts. |

## Security scans and limits

Gitleaks 8.30.1 found one historical test fixture containing the old OBS password. It matched the retired backup credential, not the rotated current password. The fixture now uses an obvious dummy value. Current working-source scan is clean. The old local commit remains private; the shareable export excludes that history and personal handoffs. Never push the original local history.

No npm dependencies are declared. Bun, OBS, BlackHole, system frameworks and build tools remain separate dependencies. The reviewed upstream [Bun](https://github.com/oven-sh/bun/security/advisories), [OBS](https://github.com/obsproject/obs-studio/security) and [obs-websocket](https://github.com/obsproject/obs-websocket/security) pages listed no published advisories; that is a limited advisory check, not a binary/dependency audit.

The panel listens only on 127.0.0.1. OBS itself still listens on all interfaces with a rotated password. Firewall was disabled on this Mac; administrator authentication is pending for incoming-network restrictions. No network-isolation pass is claimed. The app trusts software running as the same local user. A hard crash or inaccessible OBS cannot be represented as confirmed silence.

## Before general distribution

Complete firewall isolation, spoken-mic and two-source listening/Space acceptance, silence/resume/track-change checks, denied permissions/device-removal tests, clean-machine and independent security review. Run hosted CI and configure private vulnerability reporting. Windows capture and signed Windows/Mac installers are not implemented. The source candidate is MIT; separately bundled dependency licensing remains to be resolved before any combined installer.

## Later session resume

The controller was no longer running and OBS was waiting at its crash-recovery prompt when work resumed. Normal mode was selected without uploading diagnostics, and the mixer was restarted. OBS reconnected on the dedicated profile with sharing stopped. The intervening shutdown cause was not established; the earlier controlled SIGTERM restart result does not certify every shutdown path. Firewall was still disabled and OBS incoming connections allowed; the earlier administrator sheet was no longer open.

## Device-selector session

Added physical microphone and local-output menus, stable UID checks, missing-device placeholders, live device refresh and hardware-volume fallback. Tests cover rejected/missing/virtual devices, protected OBS identities, active sharing, failed mute/settings/readback and delayed volume requests. Actual USB condenser is now connected under a changed UID and was explicitly selected while stopped. CalDigit local output restored at 64%; both broadcast sources remain muted. Bluetooth, physical unplug during switching, and spoken/combined listening acceptance remain unrun.
