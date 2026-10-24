# Architecture

`tools/build.py` combines the modules below into one auto-loaded Lua entry. The generated entry has a source/binding build ID for matching logs to a release. Modules remain separate for development; they must not be copied individually into UEVR's auto-load directory.

| File | Responsibility |
|---|---|
| `runtime.lua` | UEVR callbacks, native input bridge, rig allocation, pose updates, UI and cleanup. |
| `ik_math.lua` | Quaternion/vector math and two-bone arm IK in Unreal centimeters. |
| `motion.lua`, `shake_rate.lua` | Physical stroke detection, trigger gating, cadence and bounded native shake credits. |
| `gestures.lua` | Controller gestures, finger pose data/animation and left pointing ray. |
| `calibration.lua` | Optional wrist calibration saved through UEVR's sandboxed data API. |
| `pointer.lua` | Left ray → view ray, native target selection, sphere/progress feedback and visual recovery. |
| `squeeze.lua` | Native squeeze-timer ownership; refresh target immediately before each native charge/action tick. |
| `turning.lua` | Keep native input classified as gamepad; defer snap turns to UEVR. |
| `visuals.lua` | Exact asset loading, registry recovery and owned pointer mesh/material factories. |
| `rendering.lua` | Pixel/grid correction and scoped rat/photo fill lights, with restoration. |
| `hud.lua` | Hide desktop mouse prompts; leave the original shake-meter HUD intact. |

The runtime copies the game's arm mesh into an owned poseable mesh, solves each wrist independently from tracked controller poses and applies finger poses. It retains the native rat component, materials and animation. Head movement is separate from hand aiming.

Shaking uses tracked motion to call the native counter/audio path; it does not write the meter directly. Squeeze executes the native dispatcher every 0.3 seconds, immediately after a fresh pointer trace. This ordering prevents a native camera trace from replacing the hand-selected actor before dispatch. The game still decides whether the charge, rat and story state allow an action.

All optional presentation failures are isolated from gameplay. Components/assets are rebuilt after loss with bounded retries. Reset restores borrowed properties and destroys owned components. Do not add reflection calls inside UFunction hooks: UEVR 1.05's hook callback lock is non-reentrant.

## Bindings

The profile includes Oculus Touch and Valve Index OpenXR overrides. Existing passive AButtonTouch actions carry index contact; BButtonTouch actions carry aggregate thumb contact. Gameplay buttons/poses remain available. Disable **Quest/Index touch bindings** for profiles without these overrides; pointing then uses grip without trigger. No OpenXR hand-joint stream is consumed.

## Useful upstream documentation

- [UEVR Lua API and script loading](https://docs.uevr.io/plugins/lua)
- [UEVR source/releases](https://github.com/praydog/UEVR)
- [Official UEVR plugin using Import Config](https://github.com/praydog/FF7R-UEVR)

No upstream implementation source, game assets or decompiler output is required by this repository's build or tests.
