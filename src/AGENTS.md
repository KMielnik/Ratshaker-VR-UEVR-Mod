# Lua implementation rules

- `runtime.lua` owns callbacks and lifecycle; the other files return modules with injected host adapters. Preserve that boundary.
- Engine-thread callbacks own reflected game calls, timers, assets and component allocation. Stereo updates place already-created visuals. Pure math stays in `ik_math.lua`/`motion.lua`.
- UEVR 1.05 Lua hooks are non-reentrant. Do not call reflected functions from UFunction hooks, or add hooks reached by a Lua-initiated native call. Never rewrite FUNC_Native flags.
- Reflected transforms/vectors must come from actual engine constructors or getters. Arbitrary Lua tables are not valid reflected FVector/FTransform arguments.
- Pointer selection uses the head-origin ray through the left ray landing point, native channel 2 and 300 cm reach. Do not bypass IsInteractable or call actors directly to force completion.
- Squeeze refreshes the hand target immediately before the native DrainShakeMeterWhenSqueezing dispatcher, at its 0.3-second cadence. Preserve charge, rat-state and story gates.
- Handle pawn replacement, same-pawn component loss, menu pause, headset loss, partial construction and script reset. Own only what the mod creates; restore borrowed state without overwriting newer game changes.
- Catch asset discovery exceptions before validating returned objects; use exact asset identity, registry fallback and bounded retries. Rendering errors must not break interaction.
- Preserve native rat materials, animation, physics/tail and original meter HUD. Lighting is supplemental fill, not an exact lit/unlit shader blend.
- `gestures.lua` contains the required compact reference/grab pose tables followed by gesture logic. Keep wrist calibration separate from finger transforms. Don't add game asset dumps to regenerate those tables.
- Validate numeric tracking inputs. Avoid frame-rate dependent gains, hitch bursts, unbounded scans and per-frame asset loading.
