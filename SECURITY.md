# Security policy

## Release status

No release is currently designated security-supported. This is a developer preview with remaining acceptance limits in [current security status](docs/security/CURRENT-STATUS.md). Passing unit tests is not proof of safe broadcast behavior or absence of vulnerabilities.

## Report privately

Before public launch, the maintainer must enable and test GitHub private vulnerability reporting and publish a monitored backup contact. Those channels are not configured by this local scaffold.

Once enabled, use the repository's **Security → Advisories → Report a vulnerability** flow. If that button is absent, do not put exploit details or credentials in a public issue; obtain a verified private contact from the maintainer first. No response-time or bounty commitment has been established yet.

Include affected version/commit, macOS and dependency versions, prerequisites, minimal reproduction, observed impact, and suggested mitigation. Use fake credentials/devices where possible. Do not attach real audio, OBS passwords, app inventories, or personal data.

## Scope and boundaries

Review the HTTP/WS control plane, OBS authentication/configuration, microphone selection and mute semantics, CoreAudio helpers, process lifecycle, local storage, native webview, build/release pipeline, and update provenance. The current model trusts local processes without an Origin header; it does not isolate against malicious software running as the same user.

Security work must preserve loopback binding and request guards, keep credentials out of logs/HTML, and never enumerate the application property of an OBS sck_audio_capture source. Do not test destructive or live-broadcast paths against a user's running setup without an isolated test environment.

Maintainers should triage privately, reproduce safely, fix with regression coverage, arrange independent review, publish a patch and advisory, and document supported versions. See [Release plan](docs/RELEASE-PLAN.md) for the proposed operational process.
