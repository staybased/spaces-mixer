# Architecture

## Preserved audio path

Music process → CoreAudio process tap → BlackHole 16ch → OBS music source.
Physical microphone → OBS mic source.
OBS monitoring mix → BlackHole 2ch → destination microphone.

Local Output selects the macOS default output by stable CoreAudio device UID and independently controls its volume/mute when supported. It is not an OBS master/broadcast fader. Virtual/aggregate devices and known broadcast cables are excluded. Commands carry the expected output UID so a delayed adjustment cannot affect a newly selected device. Mic selection requires stopped sharing, validates the physical device and existing CoreAudio source, then verifies mute/monitor-off before and after updating only that source’s device settings.

| Component | Responsibilities |
|---|---|
| `src/server.ts` | Loopback HTTP/WS, status, controls, helper orchestration, auto-trim |
| `src/http-guard.ts` | Host/Origin checks for all routes; JSON mutation intent |
| `src/http-router.ts`, `src/request-schema.ts` | Request schemas, body/concurrency bounds and security headers |
| `src/sharing.ts`, `src/obs-safety.ts` | Verified stop/start state, OBS identity and active-output guards |
| `src/obs-client.ts` | OBS v5 protocol, request/identify deadlines |
| `src/obs-config.ts`, `src/obs-process.ts` | Configuration backups/patching and OBS lifecycle |
| `src/setup.ts` | Scene collection, source/filter reconciliation, mic selection |
| `src/tap.ts`, `src/running-apps.ts` | Capture helper lifecycle and app discovery through lsappinfo |
| `src/sysvol.ts` | System output volume helper |
| `src/trim.ts` | Target −10 dBFS; gradual increases, quick decreases, 1.5 dB deadband, hold on silence |
| `public/` | Local dashboard and controls |
| `widget/` | Floating WKWebView, CoreAudio tap/cable bridge, system volume helper |

The tap includes relevant child processes using responsibility_get_pid_responsible_for_pid when available, a private API dependency that needs portability review. OBS reads the ordinary BlackHole input because a raw tap-only aggregate previously yielded silence. The aggregate input includes cable and tap buffers; the helper deliberately selects the stereo tap buffer.

Trust boundaries and known weaknesses are recorded in the [audit](security/CURRENT-STATUS.md). This design note describes current code; it does not claim all boundary protections are complete.

## Planned Windows implementation

The current topology and modules above describe the working Mac implementation. The [installer specification](INSTALLER-SPEC.md) defines platform boundaries for Windows app capture, devices, OBS integration, storage, lifecycle and shell. Share the existing controls where possible, preserve the Mac audio chain, and independently verify the proposed Windows path. No Windows backend is implemented yet.
