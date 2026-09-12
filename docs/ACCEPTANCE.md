# Release acceptance checklist

Run on a dedicated test Mac/account/profile, off-air first. Record each step as PASS, FAIL, or NOT RUN with observations, versions, architecture, and date. Never infer success from a configuration value alone.

| Check | Evidence required |
|---|---|
| Unit tests | Full bun test result, at least 131 passes |
| Fresh install/build | Clean Mac prerequisites, successful builds, visible native widget, three usable strips, OUT green |
| Music | Music playing; movement in both panel and OBS Browser Music |
| Mic | Intended physical mic responds; unplugging it cannot enable another mic |
| Output mix | Both music and voice audible from BlackHole 2ch; music about 10–15 dB below voice peaks |
| Destination | As a host, co-host, or approved speaker, select BlackHole 2ch in the desktop client; another consenting listener hears both music and voice |
| Auto-trim | Observe several minutes of steady music, quiet/loud sections, silence/resume and track changes; record trim/pre-fader peaks and audible pumping |
| Source change | Capture follows another running app; stopped/missing app visible as unavailable; restore original selection |
| Faders and mute | Final silence reaches OBS; acknowledged mute; no wheel adjustment; remote/keyboard changes reconcile |
| Disconnect/reconnect | OBS quit/relaunch reconnects without duplicate clients or error spam; failed controls do not indicate success |
| Shutdown | Document exactly what closing widget/server/OBS does; verify explicit Stop and native-window close |
| Isolation | Other OBS profiles/collections unchanged; prepare/setup refused during unrelated active recording/streaming using the implemented guards |
| Permissions | First-run prompts, denied permission, revoked permission, missing mic/driver, and recovery tested |
| Packaging | Verified signature/notarization, clean-machine install/update/uninstall, each advertised CPU architecture |

Security-specific acceptance: strict Host/Origin/content-type/schema checks, controller trust policy, private credentials/backups, malformed and oversized messages, connection limits, and independent review of Swift buffer/lifecycle safety. See audit IDs for precise remaining fixes.

The earlier single-Mac success and current unit tests are useful baselines, not this completed matrix. See [current verification](security/CURRENT-STATUS.md) for the latest observed checks.

## Windows and Mac installer acceptance

Run the [installer specification](INSTALLER-SPEC.md) acceptance on each advertised OS/architecture. Test a clean computer without Bun, Git or compilers; reuse installed dependencies; deny permission/elevation; interrupt/retry a download; restart/resume; update off-air; and uninstall without removing shared dependencies. Record a nontechnical user completing setup in the GUI. Windows needs its own capture/mic/virtual-device end-to-end result, not just passing shared unit tests.
