# Tests

These tests run Lua through Fengari with small simulated reflected objects. They require no game install and must remain portable.

- Prefer behavioral regressions: pose independence, native call order, charge cadence, invalid input, respawn/retry and cleanup.
- `test_runtime.cjs` provides the host fixture; `test_all_modules.cjs` also runs the actual generated release entry with all real modules.
- Don't reintroduce private file paths, cooked assets, full animation data or proprietary source as fixtures. Small hand-written host contracts belong here.
- Packaging checks verify generated-file drift, a flat UEVR import ZIP and reproducibility.
- Passing tests does not prove appearance, frame timing, actual game progression or support for a new controller. Use docs/compatibility.md for the manual acceptance checklist.
