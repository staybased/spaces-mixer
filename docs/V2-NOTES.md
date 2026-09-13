# Spaces Mixer v2 notes

Recorded 2026-09-12. The soundboard is explicitly deferred while the current mixer is prepared for release. This is a design proposal, not an implemented feature or a promised release date.

## Soundboard

- Collapsible drawer with 8–12 labeled pads, icons and playback progress; keep the main mixer compact.
- Independent effects volume, consistent clip loudness and an immediately accessible Stop all sounds action.
- Import local clips, rename them and keep favorites. Start with one sound playing at a time to avoid accidental stacking.
- Suggested original or cleared starter effects: applause, air horn, rimshot, crickets, dramatic hit, record scratch, celebration and transition swoosh.
- Later: keyboard shortcuts, optional music ducking, replaceable themed packs and curated trending/meme sounds.

## Content and licensing

Bundle only original audio or material with verified permission for redistribution and the intended uses. Preserve creator, source URL and license records for every bundled file. Trending popularity does not grant permission to ship a recording. Personal import is separate from permission to broadcast it. Review each pack before distribution; do not automatically scrape social platforms.

Freesound supports filtering for CC0 and other licenses; inspect individual uploads and provenance. Pixabay's license restricts standalone distribution, so do not treat its free downloads as a ready-to-bundle sound pack.

- [Freesound licensing FAQ](https://freesound.org/help/faq/)
- [Pixabay license summary](https://pixabay.com/service/license-summary/)

## Proposed integration and acceptance

Evaluate a dedicated OBS media source feeding the existing BlackHole 2ch output. OBS exposes media playback controls. This would add a source and requires the full end-to-end audio verification checklist before acceptance; it must not silently alter the existing music/mic chain.

Include effects in verified Stop audio, quit, disconnect and restart handling. Validate imported file type/size/duration and constrain access to the app's managed sound library. Avoid remote URLs and executable pack content. Test rapid triggers, repeated clicks, missing files, decoder errors, source removal, silent stop/restart, level limits and actual combined-output listening. Keep local preview and broadcast playback visibly distinct if preview is added.

- [OBS media actions](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#triggermediainputaction)

## Other future polish

Full device names at narrow widths, clearer OBS/OUT/SRC explanations and friendlier first-run setup remain UI opportunities. Windows support and signed installers are tracked separately in the [installation plan](INSTALLER-SPEC.md).
