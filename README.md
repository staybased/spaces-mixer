# Spaces Mixer

An audio mixer for **X Spaces hosts, co-hosts, and approved speakers**, with a planned simple installation on Windows PCs and Macs. The current working implementation is a Mac source build. Send music from one app alongside your microphone, and keep music, voice, and headphone volume within reach in an always-on-top panel.

**Developer preview — public release preparation.** This is a working local prototype, not yet a signed download or a broadly verified X integration. Read the [current verification and security status](docs/security/CURRENT-STATUS.md) before testing. No public repository or release has been created by this scaffold.

## Start here

- [Windows and Mac installation plan](docs/INSTALLER-SPEC.md)
- [Current Mac source setup](docs/GETTING-STARTED.md)
- [Controls and daily walkthrough](docs/WALKTHROUGH.md)
- [FAQ and troubleshooting](docs/FAQ.md)
- [Privacy and local data](docs/PRIVACY.md)
- [Security policy](SECURITY.md)
- [Contribute](CONTRIBUTING.md)
- [Public-release plan and checklist](docs/RELEASE-PLAN.md)

## What it does today

| Control | What changes |
|---|---|
| Music | Level and mute for one selected app sent to the mix |
| Mic | Level and mute for one physical microphone sent to the mix |
| PHONES | macOS default output volume; local listening only |
| Music source picker | Retargets a CoreAudio process tap to another app |
| Setup | Selects a microphone and builds the Spaces Mixer scene collection in OBS |

It does not switch your default headphone device, mix several independent music apps, route arbitrary device channels, or supply an X login/integration. Those are potential future features, not controls that exist today.

```text
Music app → CoreAudio process tap → BlackHole 16ch ─┐
                                                 ├→ OBS → BlackHole 2ch → browser microphone
Physical microphone ─────────────────────────────┘
```

The recorded working configuration uses **Firefox for music and Brave for the Space**. Keep music and the Space in separate browsers: echo cancellation can remove a browser's own playback. Capture targets an app's processes, including relevant child processes, rather than OBS's per-app capture; other music apps can be selected, but compatibility must be verified per app.

**Who this is for:** people already on the speaker panel as a host, co-host, or approved speaker. Setup assumes that speaking role is established. On your Mac, confirm that the client you use for the Space can select **BlackHole 2ch** as its microphone; that device-routing check is part of setup and release testing.

## Windows and Mac download goal

The intended setup is **download → install → choose music, mic and headphones → test → start sharing**. End users should not need Terminal, Git, Bun, or Swift tools. A guided installer handles missing audio components with explicit OS approval where required.

Windows support needs a platform-specific capture/device backend and desktop shell; it is not available in the current Mac code. Signed Windows and Mac packages, guided setup, output-device selection, are planned in the [installer specification](docs/INSTALLER-SPEC.md).

## Build from source

Read [Getting started](docs/GETTING-STARTED.md) first. Source builds require macOS 14.2+ APIs, compatible OBS, both BlackHole drivers, Bun, and Swift command-line tools. The actual baseline is macOS 15.7.4 and Bun 1.3.10 on one Mac; other versions and architectures are unverified.

From the downloaded source folder:

```sh
bun test
./start.sh
```

The panel uses `http://127.0.0.1:4780`. There are 131 tests in the current working tree. Tests do not require OBS and do not certify that audio reaches a Space.

## Hardening

The existing implementation has localhost binding, foreign-Origin rejection for mutations and sockets, JSON-only mutation intent, authenticated OBS preparation, config backups and atomic replacement, OBS timeouts/reconnect serialization, acknowledged mute, final fader flush, offline keyboard guards, and no wheel/scroll fader control. The panel uses local fonts.

The current implementation also validates Host/Origin and request schemas, bounds request/socket resources, restricts native navigation, isolates OBS profile changes, rejects unsafe setup during active outputs, and verifies Stop sharing before quitting. Startup leaves capture stopped and both mixer inputs muted. Credentials and backups are private; preparation rotates the OBS password while OBS is closed.

131 tests pass. The native window, startup persistence, live Firefox music capture, stable trim, source selection, verified close and OBS restart were observed on the test Mac. Spoken-mic/listening acceptance, clean-machine testing, OBS incoming-network isolation and independent review remain open. These results are not a security certification. See [current status](docs/security/CURRENT-STATUS.md).

## License and distribution

The mixer’s own source is licensed under [MIT](LICENSE). See [dependency and distribution notes](docs/LICENSING.md). OBS and BlackHole are installed separately; their source and binaries are not bundled here. No affiliation with X, OBS, or BlackHole is implied.
