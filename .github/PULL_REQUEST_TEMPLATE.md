## Problem and resulting behavior

Describe the user-visible trigger and what changes.

## Validation

- Baseline and final `bun test` results:
- Browser/native UI checks, if relevant:
- Audio acceptance checks, if routing/capture/filters changed (link sanitized observations):
- Failure/permission/unsupported-device cases:

## Review checklist

- [ ] No credentials, recordings, device dumps, or personal paths added.
- [ ] Loopback binding and guards preserved; no scroll fader control.
- [ ] OBS profile/collection changes are isolated and never patch a running OBS config.
- [ ] Docs describe current behavior and distinguish unverified results.
