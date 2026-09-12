# Getting started — current Mac source preview

The product goal is a GUI installer for both Windows and Mac, requiring no developer tools. See the [installer specification](INSTALLER-SPEC.md). Those packages and the Windows backend have not been built yet.

This walkthrough describes the current Mac source build. The signed app and onboarding wizard in the [release plan](RELEASE-PLAN.md) do not exist yet. Resolve the security release blockers before inviting general users to install it.

## 1. Check that this fits your setup

You need a Mac, headphones, a physical microphone, a music app, and a destination that accepts a microphone device. Windows, Linux, iOS, and Android are not supported by this implementation.

This guide is for **hosts, co-hosts, and approved speakers already on an X Space’s speaker panel**. With that role established, confirm your desktop client can select **BlackHole 2ch** as the microphone. The walkthrough focuses on getting music and voice into that input. Desktop client and device-routing compatibility still need testing across the supported Mac configurations.

## 2. Install the prerequisites

| Requirement | Purpose | Where to get it |
|---|---|---|
| macOS 14.2+ APIs | CoreAudio process taps | Current tested system: macOS 15.7.4; minimum-version testing pending |
| Compatible OBS (tested: 32.1.2) | Mixing, filters, monitoring | [Official OBS downloads](https://obsproject.com/download); follow the chosen release's macOS requirements |
| BlackHole 2ch **and** 16ch | Final mix cable and music capture bridge | [Official BlackHole instructions](https://github.com/ExistentialAudio/BlackHole#installation-instructions) |
| Bun | Local server and tests | [Official Bun installation](https://bun.sh/docs/installation); baseline 1.3.10 |
| Xcode Command Line Tools | Build the Swift helpers | Apple's tools, installed with `xcode-select --install` if absent |
| Headphones and microphone | Listen without speaker feedback; capture voice | Connect before setup |

Install dependencies from their official sources. Driver installation may require an administrator and restart. Running the mixer itself should not require sudo. Do not disable Gatekeeper, SIP, or macOS privacy protections.

If you already use Homebrew, BlackHole documents these commands:

```sh
brew install blackhole-2ch
brew install blackhole-16ch
```

Open OBS once so it creates its configuration. In Audio MIDI Setup, verify both BlackHole devices exist. Keep your normal headphones as the Mac output; do not change the system output to BlackHole 2ch.

## 3. Get and build the source

After a maintainer publishes the reviewed repository, download its source archive or clone its verified URL. There is no canonical GitHub URL yet; do not substitute an unverified mirror. Open Terminal in the extracted project folder, then:

```sh
bun --version
swiftc --version
bun test
./start.sh
```

The launcher compiles three helpers into `bin/`, starts a detached local server, and opens `bin/Spaces Mixer.app`. `bun start` runs only the server. The app has no npm dependencies to install at present.

If compilation fails, stop and save the error. The launcher stops on a failed rebuild and preserves the previous binary without launching it. If the panel is blank, check the terminal and the troubleshooting guide before changing permissions.

## 4. Prepare OBS deliberately

Do this while off-air, with OBS neither streaming nor recording. Export/back up existing OBS profiles and scene collections. Prepare creates the dedicated **Spaces Mixer** profile/collection while OBS is closed. If OBS is already using another profile or collection, close it yourself before Prepare; the app refuses to control an unrelated setup.

Open the panel's Setup gear. **Prepare OBS** enables password-protected OBS WebSocket access and configures monitoring to BlackHole 2ch. When OBS is open, preparation requires quitting and relaunching it; the panel asks before doing that. Never patch its config while OBS is running.

OBS WebSocket is a separate service from the localhost panel. This project does not enforce a loopback-only bind for OBS itself. Do not expose or port-forward it. In macOS System Settings → Network → Firewall, enable the firewall and block incoming connections for OBS; administrator authentication may be required. Verify that local mixer control still works. Effective isolation must be tested on each release target.

## 5. Build and check the mix

1. Open Firefox, choose a track you are permitted to share, and start playback. Keep unrelated audio tabs closed in this music browser.
2. Connect your intended microphone. In Setup, choose Firefox and that exact microphone.
3. Select **Build mix**. It creates/repairs the Spaces Mixer scene collection and configures filters and monitoring. It can mute other audio sources in that collection.
4. Inspect OBS: Browser Music should use BlackHole 16ch; Mic should use your selected physical microphone. Do not choose a BlackHole device as the physical mic.
5. Setup leaves sharing stopped and both channels muted. Confirm the selected device, choose **Start sharing**, then deliberately unmute each channel while off-air and check both signals independently. A missing selected mic now stops setup with an error; an existing Mic is muted and monitoring is disabled before device validation. If a safety command fails, setup stops and reports that failure; verify silence in OBS/destination directly.
6. Follow the [daily walkthrough](WALKTHROUGH.md), then complete all [acceptance checks](ACCEPTANCE.md) before a live session.

macOS may ask for system-audio capture, microphone, or app-control permissions. Grant only the permission matching the action you started; the identity shown for a source-built helper may differ from a future signed app. A denied prompt is a stop condition to diagnose, not a reason to grant blanket access.
