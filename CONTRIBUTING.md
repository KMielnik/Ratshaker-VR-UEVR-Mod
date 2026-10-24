# Contributing

Bug reports: include game/UEVR versions, headset, connection/runtime, controller profile, reproduction steps and any LuaLoader error. Mention whether it happens after death or a script reset. Share only relevant, sanitized log lines.

For development:

1. Run `npm ci`, `npm run build`, then `npm test`.
2. Make changes in `src/`; add a regression test for behavioral fixes.
3. Rebuild and test again. Copy the contents of `profile/` into your RATSHAKER UEVR profile after backing it up.
4. Lua-only edits can be loaded with **LuaLoader → Main → Reset scripts**. Binding/config changes require closing the game and a fresh injection.
5. Check normal startup, independent hands, shake sounds/meter, charged photo/door/toilet interaction, death/respawn, pause/resume and script reset. Check bright/dark rooms for lighting changes.

Keep pull requests focused. Describe the behavior, tests and any hardware limitations. Source and generated `profile/scripts/main.lua` must agree; CI checks this. No extraction tools or private investigation files are needed to work on the mod.

See [architecture](docs/architecture.md) and [compatibility](docs/compatibility.md). Release maintainers update VERSION, generate the archive, test it and attach the ZIP plus SHA256SUMS.txt to the corresponding tag.
