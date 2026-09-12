# Daily walkthrough

First complete [Getting started](GETTING-STARTED.md). This walkthrough assumes you are a host, co-host, or approved speaker on the Space’s speaker panel.

## Before going live

1. Put headphones on. Select your usual output device in macOS; PHONES changes its volume but cannot select another device.
2. Play music in Firefox. Use Brave for the destination Space and confirm BlackHole 2ch is available in its microphone selection. A dedicated music browser prevents unrelated tabs from joining the mix.
3. Run `./start.sh` from the source folder. OBS must be connected and on the Spaces Mixer collection/Spaces Mix scene. Do not run Prepare or Build mix during a broadcast.
4. Confirm the selected physical microphone, choose **Start sharing**, then deliberately unmute each source while off-air. Startup and setup leave both sources muted. Check Music and Mic meters separately. Select **BlackHole 2ch** as the destination's microphone, not the physical mic and not BlackHole 16ch.
5. Do an off-air listening test using another application capable of monitoring BlackHole 2ch. Use headphones to avoid feedback; do not feed that monitor back into the captured music app.
6. Aim for music peaks roughly 10–15 dB below voice peaks, then confirm by listening. Green status lights mean configuration checks passed; they do not prove listeners can hear you.

## During the session

- **Music** changes what the destination receives. The original app still plays locally, so changing this fader does not necessarily change your headphone playback.
- **Mic** changes your voice level in the destination mix.
- **PHONES** changes the Mac's default output volume only. Muting it does not mute your broadcast.
- Drag a fader, or focus it and use ↑/↓. Shift makes larger steps. End sends silence. Music/Mic Home returns to 0 dB; PHONES Home sets full local volume. Scrolling does nothing to faders.
- A mute button changes its indication after OBS confirms it. If the panel disconnects, do not assume the destination is muted; use the destination/OBS mute directly.
- The Music source label is a picker. Switching targets captures all relevant audio from the new app, not one tab. Verify the source and meter before relying on the switch.
- The Trim button toggles automatic adjustment or holds the current trim manually. There is no manual trim-value editor in this UI. Auto targets approximately −10 dBFS before the later processing/fader; listening verification of hunting/pumping remains open.

## After the session

Mute or disconnect the destination microphone first. **Stop** stops the music tap, mutes both OBS mixer inputs and disables their monitoring, then reads the state back. **Stop & quit** also shuts down the controller and its helpers. Closing the native window requests the same verified stop-and-quit operation; OBS stays open.

If OBS is disconnected or rejects a stop command, the panel reports that stop is unconfirmed and stays open. Mute the destination/OBS directly and resolve the connection before retrying. A force-kill, machine failure or malicious local process is outside this confirmation guarantee.
