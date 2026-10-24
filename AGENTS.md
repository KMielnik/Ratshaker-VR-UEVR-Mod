# Working in this repository

This is a Lua mod loaded by UEVR into RATSHAKER, not a standalone game or a native DLL.
Read README.md and docs/architecture.md first. Nested AGENTS.md files add module-specific guidance.

## Commands

- `npm ci` installs the pinned test-only Fengari dependency.
- `npm run build` regenerates `profile/scripts/main.lua` and the import ZIP in `dist/`.
- `npm test` verifies the generated entry, runs packaging tests and the portable Lua suite.
- Edit `src/`, never the generated entry directly. Commit the regenerated entry with source changes.
- Python 3.10+ and Node.js 20+ suffice. Building/testing does not require game assets, UEVR, Windows, credentials or a headset.

## Boundaries

- Preserve the user's save, normal story progression, native meter/interaction gates and UEVR turn settings.
- Keep head tracking independent of hands. Right trigger + motion shakes; right trigger + grip squeezes; left grip + released index points.
- Do not commit game files, reverse-engineering dumps, runtime logs, screenshots, credentials, local calibration, machine paths, node_modules or dist output.
- Never label a simulated test as proof of stereo rendering or hardware compatibility. Record live tests separately in docs/compatibility.md.
- Do not launch, inject, restart or control somebody's live game unless the current task authorizes it. Offline checks are safe to run normally.
- Fix only the requested scope; retain lifecycle cleanup and native state restoration. New input/layout choices need a clear default and documented fallback.
- Public release assets are `Ratshaker-Win64-Shipping.zip` and `SHA256SUMS.txt`. Keep the ZIP filename and its flat profile layout: UEVR derives the destination from that name.

## Release

Update VERSION, build, run the tests, review the ZIP contents and update the concise release notes. Test in VR when possible. Publish a tag and matching GitHub release only when requested. Do not bundle UEVR or game assets.
