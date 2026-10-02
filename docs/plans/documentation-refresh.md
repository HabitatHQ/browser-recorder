# Documentation refresh

Date: 2026-10-03. Implementation baseline: Browser Recorder 0.7.1.

## Scope

Refresh the maintained Markdown documentation and its Astro/Starlight copies against the current implementation. This is a documentation-only change: no capture-policy, browser API, dependency, or release-script changes, and no version bump or release tag.

## Changes

1. Update README, guide, landing page, and known gaps: explicit popup actions, scoped opt-in ring capture and auto-pinning, session/ring suspension, standalone artifacts, pause/resume/discard, crash recovery limitations, browser-specific video, current export contents and names, and experimental features.
2. Align the root and website privacy policies: local collection versus telemetry, persistent recovery storage and cleanup, user-triggered authenticated request replay, local-only dictation, automatic-redaction limits, best-effort session replay input masking and its boundaries, and sensitive CLI artifacts.
3. Correct both CLI guides: supported browser hints, ESM examples, browser installation, capture limits, prompt behavior, conditional ZIP members, and sensitive-data warnings.
4. Update both development guides and publishing instructions: supported toolchain, three-package workspace and separate site, verification commands, GitHub release-to-store automation and secrets names, current version-script restriction, and local release-script caveats.

Historical assessment and implementation plans retain their dated evidence. The untracked ring-refinement draft is not part of this change.

## Verification and delivery

- Check matching claims in every root and website copy, relative links, and documentation-only scope.
- Exercise CLI help and synthetic local capture/export examples without real credentials or external site data.
- Run the existing test suite, build the documentation site, and inspect the rendered guide, privacy, CLI, and development pages.
- Commit the isolated documentation changes, fast-forward main, and push main without tags or store-publishing commands.
