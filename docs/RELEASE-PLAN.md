# Open-source release plan

Status: local scaffold, 2026-09-12. GitHub identity staybased is verified and MIT is the source-license default. Repository URL, private reporting channel, release signer and public support policy remain to be configured. Nothing has been uploaded. The current source includes security and lifecycle remediation; see current status.

## Windows and Mac requirement

Deliver a normal desktop installation for Windows PCs and Macs. Users should not need a terminal or separately install Bun/Swift development tools. The [installer specification](INSTALLER-SPEC.md) defines the GUI flow, platform adapters, dependency handling, security boundaries, and acceptance criteria. Current code supports only the Mac source preview.

## The intended user experience

1. Visit the public GitHub README; immediately see that the app is for hosts, co-hosts, and approved speakers, plus supported Windows/Mac versions, a real screenshot, and a short demonstration with permitted music.
2. Choose Download for Windows or Download for Mac; receive a signed Windows installer or signed/notarized Mac app for a tested architecture. Verify provenance without asking users to disable security controls.
3. Open the app. A prerequisite screen detects OBS and the platform’s audio components (BlackHole on Mac; a validated Windows virtual-audio component on PC), explains missing items, and guides their verified installation. Installation remains explicit; no silent driver installation.
4. Choose a music app, physical microphone, and local listening device. Show exactly what is captured. Output-device selection and expanded input management are future implementation work.
5. Preview the dedicated OBS profile/collection and requested permissions; configure it while off-air. Start muted and verify the intended devices before enabling a session.
6. Play music, speak, and complete a short audio check. Only then choose the displayed platform-specific virtual microphone in the Space client and go live.
7. Use the compact panel. End with an explicit Stop sharing action; quitting has predictable, visible capture behavior.

Today, only the source build and existing mixer panel exist. Do not add a working “Download app” button, screenshots of a fictional wizard, or broad compatibility claims until those deliverables are real.

## Repository scaffold

```text
README.md                   Clear scope, preview status, guide links
SECURITY.md                 Private reporting process and support status
CONTRIBUTING.md             Development and review rules
docs/INSTALLER-SPEC.md       Windows/Mac GUI installer and portability requirements
docs/GETTING-STARTED.md      Current Mac source prerequisites and setup
docs/WALKTHROUGH.md          Daily controls and shutdown
docs/FAQ.md                  Troubleshooting and limitations
docs/PRIVACY.md              Audio scope, metadata, storage and lifecycle
docs/ARCHITECTURE.md         Existing audio topology and modules
docs/ACCEPTANCE.md           Evidence-driven release tests
docs/LICENSING.md            MIT source license and separate-dependency notes
docs/security/              Current audit and later remediation evidence
.github/ISSUE_TEMPLATE/     Bug and feature forms
.github/PULL_REQUEST_TEMPLATE.md
.github/workflows/ci.yml    Bun tests; compile Swift without running it
.github/dependabot.yml      Reviewable GitHub Action update proposals
```

Existing local handoffs/review transcripts are retained as an archive. They are not automatically suitable for the public tree/history. MIT is included. CODEOWNERS, a public repository URL, security contact and hosted-CI badges require actual configuration.

## Phased work and release gates

| Phase | Work | Exit evidence |
|---|---|---|
| 0. Verify supported setups | Test desktop microphone routing for hosts, co-hosts, and approved speakers; settle Windows/Mac/CPU/OS support | Dated tests from people on the speaker panel using the advertised clients and devices |
| 1. Security fixes | Address SEC-01–07, OBS network policy and local trust boundary | Reviewed fixes with adversarial regression tests, then independent security review |
| 2. Source preview | Sanitize public content/history; complete guides; run hosted CI and dependency/secret scans | Clean candidate with no unresolved release blockers and reproducible setup on a second Mac |
| 3. Windows and Mac installers | Package the existing Mac app; implement Windows capture/device/OBS adapters and shell; bundle verified runtimes; add guided setup and explicit stop lifecycle | Fresh Windows/Mac installation, real audio tests, permissions/denial, restart/resume, update/uninstall and signature validation |
| 4. Input/output expansion | Explicit output-device picker, additional named mic/app strips, saved sessions with safe defaults | Separate UX specs; per-device mute/capture privacy tests; full audio checks for every topology change |
| 5. Public launch | Tagged reviewed release, walkthrough video, FAQ, release notes, supported-version policy | Actual download artifacts, checksums, provenance, recovery steps, and completed acceptance matrix |

For the proposed Mac download, follow Apple's [notarization workflow](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). Signing/notarization establishes distribution checks; it is not a substitute for security review or correct audio routing. Do not bundle OBS or BlackHole before resolving licensing and installer obligations.

## GitHub settings to configure when a reviewed repository is created

- Choose owner, repository name, description, license/copyright identity, and approved public commit identity.
- Preserve the local archive. Review a sanitized public export/history; do not just push the existing root commit with its personal paths/context/email. Scan all refs/artifacts intended for publication with a dedicated secret scanner and manually review hits.
- Require pull requests and passing CI on the default branch; limit who can bypass protections. Set CODEOWNERS once maintainers are known.
- Enable and test [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), maintain a monitored fallback contact, and define realistic triage/support commitments. A SECURITY.md file alone does not activate reports.
- Enable secret scanning/push protection where available, dependency alerts, and [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning). Configure JS/TS analysis and a reviewed Swift build analysis separately as needed; record coverage gaps around Bun/CoreAudio. None of these scans has run from this scaffold.
- Keep PR CI read-only on hosted runners, without signing secrets, production credentials, or pull_request_target execution of untrusted code. Current action refs are full commit pins verified against upstream tags on 2026-09-12. Pinning controls drift; it does not certify an action's contents.
- Put signing/notarization credentials only in a separate protected release environment. Release from an approved immutable commit; verify artifact signatures, checksums, provenance and dependency notices. No release workflow is enabled here.
- Add real screenshots/demo, release notes, support scope and Discussions/issue labels only when the repository and maintainer process exist.

## Launch checklist

- [ ] Desktop microphone routing verified for hosts, co-hosts, and approved speakers on supported Windows PCs and Macs/clients.
- [ ] License and attribution finalized; third-party distribution reviewed.
- [ ] Private docs, personal identifiers and commit history reviewed/sanitized.
- [ ] Security findings closed and independently reviewed; residual risks documented.
- [ ] CI executed successfully on GitHub; dependency/secret/code scanning reviewed.
- [ ] Full acceptance matrix completed, including auto-trim listening and native widget.
- [ ] Signed Windows installers and signed/notarized Mac apps installed on clean test machines for every advertised build.
- [ ] Nontechnical users complete installation and audio setup without a terminal or developer tools.
- [ ] Permissions, device failures, profile isolation, background capture, stop/quit and uninstall tested.
- [ ] Private reporting channel tested; supported versions and patch process published.
- [ ] Maintainer reviews final public tree, repository settings and release artifacts before publication.

## Current validation

See [current status](security/CURRENT-STATUS.md). Local tests and live Mac checks are recorded there. The source export excludes old local history and personal handoffs. Hosted CI, independent review, clean-machine acceptance and signed packaging remain release work.
