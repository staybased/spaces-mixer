# Simple installation on Windows and Mac

Status: product requirement and implementation scaffold, 2026-09-12. The current application is a Mac source build. There is no Windows backend, signed installer, bundled runtime, or setup wizard yet.

Audience: X Spaces hosts, co-hosts, and approved speakers already on the speaker panel. The goal is a normal desktop app that people can set up without a terminal, Git, Bun installation, Swift tools, or knowledge of OBS routing.

## What the user should do

1. **Download for Windows** or **Download for Mac** from the reviewed GitHub release. Suggest the detected platform, but show both choices and supported versions.
2. **Install and open Spaces Mixer.** Use a signed Windows installer or a signed/notarized Mac app. The application runtime and precompiled helpers ship with the app.
3. **Complete a guided audio setup.** Detect existing dependencies. Explain any missing audio component, provide its verified installer through the wizard, and resume after installation or restart. Ask for administrator access only for components that actually need it.
4. **Choose music, microphone, and headphones.** Show friendly names, signal meters, and the scope of capture. Confirm the microphone deliberately; do not fall back to another input.
5. **Test music and voice.** Play a track, speak, and check the mixed signal while off-air. Show the exact microphone-device name to select in the Space client, with a copy button and a screenshot appropriate to that client/platform.
6. **Start sharing.** Enable the confirmed mix; keep Music, Mic, and PHONES easy to reach. End with **Stop sharing and quit**, with visible confirmation or a clear failure state.

Only missing dependencies should trigger installation. Returning users should open directly to their saved device selections with sharing off until they start a session. Do not make users reconfigure OBS on each launch.

## Platform implementation

| Area | Mac | Windows PC |
|---|---|---|
| Current status | Existing Swift/CoreAudio implementation | New implementation required |
| Packaging target | Signed/notarized app in a DMG | Signed setup executable; evaluate MSI as needed for managed installs |
| Music capture | Preserve process tap → BlackHole 16ch → OBS | First candidate: OBS Application Audio Capture → OBS; validate with real browsers/players |
| Physical mic | Existing CoreAudio source after selection safeguards | Windows audio endpoint enumeration and explicit OBS mic source selection |
| Mix delivered to Space | Existing BlackHole 2ch | Validated virtual microphone/cable; VB-CABLE is a candidate, not a selected or bundled dependency |
| Local headphones | CoreAudio default-output controls; add explicit device selection | Windows endpoint selection and volume/mute helper |
| Window | Preserve native WKWebView panel | Native Windows panel using a validated webview shell; WebView2 is the initial candidate |
| Runtime | Bundled versioned server runtime and precompiled Swift helpers | Bundled Windows server runtime and precompiled Windows helpers |
| Installation approval | OS prompts for needed permissions/components | OS permission/UAC prompts only where required |

A Windows wrapper around the current executable is insufficient: CoreAudio, lsappinfo, AppleScript, BlackHole UIDs, OBS paths/source kinds, signals, and the Swift panel are platform-specific.

For a Windows prototype, [OBS documents per-application audio capture](https://obsproject.com/kb/application-audio-capture-guide) on supported Windows versions and notes app compatibility limitations. This is a candidate path; its existence does not prove our Windows mix works. The prohibition on querying an sck_audio_capture application's property remains in force for the Mac backend.

If a native Windows process-loopback helper becomes necessary, Microsoft's [application-loopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/) is a reference. Its stated OS build requirements differ from the OBS feature's requirements; select the actual backend before announcing a Windows minimum version.

A virtual cable is still needed to present the OBS mix as a browser microphone. For the [VB-CABLE candidate](https://vb-audio.com/Cable/), playback is sent into CABLE Input and received from CABLE Output; a prototype must validate the actual endpoints and avoid feeding the final mix back into its own sources. Review [redistribution terms](https://vb-audio.com/Services/licensing.htm) before including any installer. Do not label it open-source just because Spaces Mixer will be.

For a WebView2 shell, detect its Runtime and follow [Microsoft's distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution). Users should not need to diagnose a missing web runtime themselves.

## Preserve the existing app while adding platform adapters

Introduce a platform interface behind the existing controller, then move the current implementations without changing their behavior. No adapter refactor has been performed in this scaffold.

| Responsibility | Existing code to isolate | Adapter must provide |
|---|---|---|
| App discovery | src/running-apps.ts, src/capture-sources.ts | Stable capture identifiers, display names, running state, supported capture scope |
| Capture lifecycle | src/tap.ts, widget/spaces-tap.swift | Start only after confirmation; retarget; health; stop; honest failure state |
| Audio devices | src/sysvol.ts, widget/sysvol.swift | Physical inputs, listening outputs, virtual endpoints, volume/mute, device-change events |
| OBS integration | src/obs-config.ts, src/obs-process.ts, src/setup.ts | OS paths/process control/source kinds, isolated profile/collection, safe configuration lifecycle |
| Storage/permissions | src/server.ts, src/obs-config.ts | Platform storage paths, private credentials, atomic writes, supported shutdown signals |
| Desktop shell | widget/SpacesWidget.swift | Local-origin-only panel, own-process lifecycle, setup, tray/menu actions, explicit stop |

Share the dashboard, audio math, OBS protocol client, schema/guard policy, and tests where their semantics match. Expose backend capabilities explicitly instead of silently substituting a different audio device or claiming unavailable features. A shared contract test suite should cover both implementations.

The Mac audio topology stays unchanged. The Windows proposal is a separate topology and cannot be marked supported until its full audio/security acceptance passes. Do not remove OBS or build a new virtual audio driver in this first portability pass; those would be separate larger projects.

## Setup wizard states

| State | Screen/action | Continue when |
|---|---|---|
| Check system | OS/architecture, required runtime, OBS, virtual audio components | Supported configuration identified |
| Install components | Missing items only; vendor identity, purpose, elevation/restart notice | Verified installer finishes and device/service is detected |
| Resume setup | Detect reboot/relaunch and retry the pending check | No half-installed component is treated as ready |
| Choose devices | Music app, explicit physical mic, headphones | Every selected device is present and unambiguous |
| Prepare mix | Preview isolated OBS changes; refuse active unrelated broadcast | Safe setup completes without changing another profile |
| Audio check | Music/mic meters and off-air mixed-audio test | User confirms intended signals; failures remain visible |
| Destination | Exact microphone device name and platform-specific guidance | User selects it in their desktop Space client |
| Ready | Sharing stopped, explicit Start sharing action | User starts deliberately |
| Sharing | Persistent indication and accessible Stop sharing | Confirmed stop or actionable failure explanation |

Canceling installation must leave capture stopped. Denied permissions, failed downloads, missing devices, unsupported systems, and administrator refusal need recoverable screens. No security bypass instructions or silent fallback microphone.

## Installer and update security

- Resolve the existing SEC-01–07 findings before packaging broad distribution; packaging does not fix them.
- Distribute an approved, versioned runtime and helpers. End users never compile code or run remote shell commands.
- Verify download provenance, signatures and integrity before invoking dependency installers. Do not elevate an arbitrary downloaded path or accept an untrusted URL as an installer source.
- Keep routine app operation unprivileged. Separate any installer elevation from the local controller; the HTTP API must not become a general privileged command runner.
- Use app-private storage and appropriate Windows ACLs/Mac file modes for credentials, backups and control credentials. Audit inherited permissions on each OS.
- Keep the controller local, harden its Host/Origin/frame/schema boundaries, and review OBS's separate network listener on both platforms.
- Pin and inventory release inputs; review redistribution notices. Use protected signing credentials and reviewed artifacts, never pull-request builds for release signing.
- Stage updates safely, verify publisher/integrity, and preserve rollback. Never interrupt a live session for an automatic update.
- Uninstall stops owned background processes and offers to remove app data. Keep shared OBS/drivers unless the user deliberately removes them through their vendor's uninstall flow.

## Implementation order and definition of done

1. Fix current security findings and explicit session lifecycle on Mac.
2. Package the existing Mac application without end-user build tools; add guided checks while retaining the working audio chain.
3. Extract/test platform boundaries and prove a Windows music + mic + virtual-microphone path on an actual Windows machine.
4. Build the Windows shell/device helpers and signed installer, then reuse the guided setup flow.
5. Test clean-machine install, dependency reuse, permissions/elevation denial, restart/resume, offline failure, repair/update/uninstall and routing for each released architecture.
6. Have nontechnical hosts/co-hosts/speakers complete setup from the README without terminal commands or developer assistance. Observe success and recovery; record failures rather than estimating ease of use.

Initial Windows validation target: Windows 11 x64; ARM64 and older Windows releases require separate evidence before support claims. Mac Apple Silicon/Intel and minimum macOS versions likewise need separate build and audio tests. “PC or Mac” describes the product goal, not unlimited OS/hardware compatibility.

Success means a user can download, install, select devices, and pass an audio check using the GUI. A passing shared-code CI run on Windows is not Windows audio support. Signed packages and both platform backends remain implementation work; no installers are produced by this document.
