# Contributing

The source uses MIT. Public contribution intake begins when the maintainer opens the reviewed repository; this candidate remains local.

Start with the README, getting-started guide, architecture, and security audit. For a change: explain the user problem, keep the patch focused, and include evidence of what you tested.

## Development rules

- Run `bun test` before and after every change; preserve at least the current 131 passing baseline tests.
- Use small TypeScript modules, immutable updates where practical, explicit errors, and one test file per module. Swift handles native/CoreAudio operations.
- Keep the server on 127.0.0.1 and preserve the request guards. Never add wheel/scroll control to faders.
- Do not change the audio topology without the full [acceptance checklist](docs/ACCEPTANCE.md).
- Never query obs-websocket for an sck_audio_capture source's application-property list; use src/running-apps.ts.
- Do not patch OBS configuration while it is running. Test against a dedicated profile/collection; do not alter unrelated broadcasting setups.
- Keep audio, device dumps, passwords, local state, compiled helpers, and personal handoffs out of public contributions.

Unit tests use fake OBS and DOM objects. CI also compiles Swift helpers on a macOS runner without launching them. CI cannot hear audio or validate macOS permissions, X speaking availability, or live routing.

## Pull requests and issues

Use the templates. Report bugs with sanitized system/version details and precise observations. For routing, microphone, or permission changes, include failure/denial cases and the acceptance evidence. Keep security disclosures private per SECURITY.md. Be respectful, describe behavior rather than people, and do not include private information in discussion.

Changes to dependencies and GitHub Actions require source/provenance review. Use pinned action commits, minimal token permissions, hosted test runners, and no release credentials in pull-request workflows.
