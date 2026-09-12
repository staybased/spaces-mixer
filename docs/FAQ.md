# FAQ and troubleshooting

## Who is Spaces Mixer for?

X Spaces hosts, co-hosts, and approved speakers who are already on the speaker panel and want to mix music with their microphone from a Mac. Your desktop client must accept BlackHole 2ch as its microphone. The planned releases cover Windows PCs and Macs. The current implementation is Mac-only; Windows capture/device support and installers still need to be built. Phone-to-computer audio routing is not implemented.

## Will I need Terminal or developer tools?

The planned Windows and Mac releases require neither. Download the app, run the installer, and follow a setup wizard that checks audio components and helps select music, mic, and headphones. Administrator/permission prompts may still be needed for audio components.

Those installers do not exist yet. Today’s Mac source preview requires developer tools and separate OBS/BlackHole installation. See the [Windows and Mac installer plan](INSTALLER-SPEC.md).

## Why two BlackHole drivers?

The music process tap feeds BlackHole 16ch, which OBS captures. OBS combines music and mic, then sends its monitoring output through BlackHole 2ch to the destination microphone. They have distinct jobs; do not swap them or simplify the topology without end-to-end testing.

## Can I use Spotify, Music, or a different browser?

The picker supports running apps and known music players through a process tap. Compatibility is broader than OBS's per-app capture, but not every app, protected-content policy, or macOS version has been tested. For browser music, use a different browser from the Space. A streaming subscription alone should not be treated as permission to broadcast a track; use content you have permission to share.

## Meters move but the Space is silent

Check that you are unmuted on the Space’s speaker panel, BlackHole **2ch** is selected as the desktop client’s microphone, and the Space/music are in separate browsers. Check that OBS is on Spaces Mix and both sources use Monitor and Output. Listen to BlackHole 2ch in an off-air monitor app to distinguish local routing from the destination's processing.

## The Music meter does not move

Choose Start sharing, then confirm the selected app is running and actively playing. Confirm the system-audio permission and both drivers. Browser Music in OBS must capture BlackHole 16ch. If the tap's input peak is −120 dBFS, it reports silence; increasing the fader cannot create a signal. Stop and report exact errors rather than repeatedly rebuilding OBS.

## The Mic meter does not move, or I hear the wrong microphone

Connect the selected physical microphone and inspect its device in OBS. Stop the destination audio before changing it. Build mix now stops with an error when the selected mic is missing, without selecting a fallback. Setup mutes an existing Mic and disables its monitoring before validation. Successful setup leaves sharing stopped; confirm the device, choose Start sharing and deliberately unmute it while off-air. If OBS rejects a safety command, setup stops and reports the failure; use OBS/destination controls to verify silence.

## Music is too quiet or pumps

Test the source while music is actually playing. Auto trim raises gain gradually, holds within 1.5 dB of target to avoid small repeated changes, and holds on silence; compression and limiting follow it. Do not infer pre-fader gain from the panel's post-processing meter alone. Auto-trim listening acceptance is still open; include track dynamics and observed trim changes in a report, without uploading copyrighted audio or private conversation.

## How do I choose a microphone, speakers or headphones?

Click the device name at the top of **Mic** or **Local output**. The menus refresh as devices connect or disconnect. Missing selections are shown as unavailable, never silently replaced by a different mic.

Stop sharing before changing Mic. The switch updates the existing OBS Mic source, retains its level and filters, and leaves sharing stopped with both sources muted. Choose Start sharing, then deliberately unmute Mic when ready. Setup is still used to build the initial mix.

Local Output selects the Mac's default listening device for applications that follow it, including connected speakers, headphones, USB audio and display audio. It uses the selected device's existing volume; it does not copy the old device's level. Devices without software volume show **Use device volume**; adjust them with their physical controls. The output selector stays usable. Virtual/aggregate devices are excluded from these menus to keep the broadcast cables separate.

Use headphones when an open microphone could pick up your speakers and cause echo. Explicit output choices made inside other apps may override the Mac default.

## Why does Local Output not change the broadcast?

It controls the Mac's default listening output. Music and Mic control the broadcast mix; OBS continues sending that mix to BlackHole 2ch. Local Output is not a monitor of the combined broadcast. Muting it does not mute the Space.

## Are my other OBS scenes safe?

Prepare writes only the dedicated Spaces Mixer profile/collection while OBS is closed. If OBS is running on an unrelated profile/collection or has active stream/record/replay/virtual-camera output, the app refuses setup/preparation. Back up OBS configuration and prepare off-air.

## Can I mix multiple music apps or microphones?

Not independently in this version. One selected app plus one physical mic are exposed. Additional input strips, output selection, and saved routing presets are roadmap items.

## How do I move or resize the panel?

Drag the native title bar labeled **Spaces Mixer** at the very top to move it. Drag an edge or corner to resize it within the supported limits. Its position and size are remembered when you close and reopen it. The floating panel stays above ordinary windows; use the title bar to move it out of the way. Dragging inside a fader adjusts that channel instead.

These features are called **window management**: title-bar dragging, window resizing, and saved window placement. The browser dashboard uses its browser's window controls.

## What does closing the panel do?

Closing the native panel requests verified Stop sharing, then exits the controller and owned helpers. OBS remains open with both mixer sources muted and monitoring off. A failed/disconnected stop remains visibly unconfirmed; mute the destination directly. See [the shutdown walkthrough](WALKTHROUGH.md#after-the-session).

## How do I report an error safely?

Use the bug-report template for ordinary failures. Include macOS, CPU architecture, OBS/Bun versions, which step failed, and whether meters moved. Redact usernames, device identifiers, app lists, paths, credentials, and conversation content from logs/screenshots. Security issues go through the private channel described in [SECURITY.md](../SECURITY.md), not a public issue.

## How do I remove it?

First disconnect the destination and stop the identified mixer server/helpers; close the widget and quit OBS if no longer needed. Remove the downloaded source folder and optionally its local state directory listed in [Privacy](PRIVACY.md). Restore your ordinary input/output choices and OBS profile. Restore configuration backups only with OBS closed and only after checking what they contain. Remove BlackHole using its [official uninstall instructions](https://github.com/ExistentialAudio/BlackHole#uninstallation-instructions) if other apps no longer need it; do not delete unrelated OBS profiles or drivers.

## OBS shows a crash or Safe Mode prompt

Inspect OBS directly. Safe Mode disables WebSocket control, so the panel cannot connect in that mode. The current launcher retains OBS crash prompts. An AppleScript quit crash was observed on OBS 32.1.2; preparation now uses OBS’s supported graceful SIGTERM path and waits for process exit before patching files. A subsequent restart passed without the prompt. If a crash recurs, keep its diagnostics private and report the exact version and action.
