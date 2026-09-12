# Privacy and local data

This describes the inspected source as of 2026-09-12, not a third-party certification.

The process tap captures audio from the selected app and relevant child processes. A browser selection can include every audible tab and notification in that browser. The physical mic enters OBS directly. BlackHole devices carry audio between applications; they are not private, per-client audio vaults.

The mixer has no X login, cloud account, analytics client, or audio-file recorder in the inspected code. Audio intentionally reaches the destination you choose. OBS and that destination may record or transmit it independently; their settings and privacy policies still apply.

The local API exposes running app names/bundle identifiers, device names/UIDs, OBS collection/scene status, levels, mutes, and trim state. It listens on 127.0.0.1:4780. Requests from local processes without Origin are trusted; there is no per-session controller credential. Other local software is therefore inside the current trust boundary. Host/Origin checks restrict browser access; local software without an Origin remains trusted.

| Location | Contents |
|---|---|
| `~/Library/Application Support/spaces-mixer/state.json` | Selected music bundle ID, auto-trim setting, trim dB |
| `$TMPDIR/spaces-mixer.XXXXXX/controller.log` | Source-build server log |
| Project `bin/` | Compiled Swift helpers |
| OBS's Application Support directory | Existing OBS config, WebSocket password, profile/scene state, and `.spaces-mixer.bak` backups when patched |
| Panel origin storage | Music/mic picker preferences |

The panel sends controls and level/status messages over localhost HTTP/WebSocket. OBS WebSocket is a separate password-protected service when Prepare has run; localhost binding of the panel does not make OBS loopback-only. Preparation rotates its password and writes private files/backups; the WebSocket config directory is restricted to the current user, including inherited ACL removal.

Closing the native panel requests verified stop and controller shutdown. A disconnected OBS or hard crash cannot be certified silent. Mute/disconnect the destination first; see [Walkthrough](WALKTHROUGH.md#after-the-session). Revoking macOS audio permission can interrupt capture but is not a substitute for a clear stop action in the planned app.

Do not post raw OBS configs, state files, full app/device dumps, logs, or recordings publicly. There is no automatic diagnostic uploader or redaction tool yet.
