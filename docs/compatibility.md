# Compatibility and troubleshooting

## Tested setup

Windows, Steam RATSHAKER (UE 5.4), UEVR 1.05, Quest 3 with physical Quest controllers through Virtual Desktop/OpenXR. The tester confirmed independent hands, physical shake and sounds, squeeze, all tested item interactions (including photo/toilet), acceptable fist closure, pointer recovery after death and the revised lighting. This is not a full-game completion certification.

Other headsets, runtimes and controller profiles have not been hardware-tested. Oculus Touch and Valve Index OpenXR mappings are supplied; Index emulation in Virtual Desktop was used during development. For another controller profile, disable **Quest/Index touch bindings** in LuaLoader's script UI and use left grip with left trigger released to point. UEVR must expose Trigger, Grip, poses and movement actions for both hands.

Hand tracking through Virtual Desktop is experimental controller emulation, not native per-finger OpenXR hand tracking. Left-handed control swapping is not implemented. Wrist offsets depend on controller shape; use the script's calibration/offset controls. The native flat rat can still look wrong from its reverse side. New game/UEVR versions may need adjustments.

## Installation details

The release ZIP is a UEVR profile: `config.txt`, two OpenXR binding files and `scripts/main.lua`, plus the license/notices. Import Config derives the destination from the ZIP name. Keep it **Ratshaker-Win64-Shipping.zip**; a browser-added `(1)` suffix should be removed.

Manual path: `%APPDATA%\UnrealVRMod\Ratshaker-Win64-Shipping\`. Copy the contents of `profile/` from a source checkout, or extract the release there. Do not put the files beside the Steam EXE. The script loads automatically on injection.

Before updating, close the game and back up this profile, especially `config.txt`, binding overrides and `data/` calibration. Import overwrites the supplied files and a few baseline settings; no headset resolution or turn angle is prescribed. Remove older Ratshaker mod Lua copies so only one version loads. An older development build may have installed `main.lua`, `ratshaker_vr_ik.lua` or `ratshaker_split_arms.lua`; remove only files you know belong to this mod. Remove old UObjectHook hand attachments from earlier manual experiments if they fight this rig.

To uninstall, close the game, remove this mod's `scripts/main.lua` and restore your backed-up config/bindings. If this was a fresh profile, moving the profile folder aside restores UEVR defaults. Keep `data/` if you want to preserve calibration. The game install and saves are untouched.

## Common problems

- **Flat game / script absent:** confirm the selected process is Ratshaker-Win64-Shipping, use OpenXR, and check the exact profile path above. Open LuaLoader for errors. Close its menu to enable the rig.
- **No pointer:** left grip held, index lifted off trigger. With a different controller profile, disable touch bindings. Use **Retry rig setup** or **Reset scripts** if needed. Report any visual-creation error and whether a death preceded it.
- **Target turns amber but does nothing:** fill the rat meter, keep pointing, and hold right trigger + grip. Charged actions require spending over 20% of meter capacity while charge remains. Amber means selection, not completed interaction.
- **Wrong wrists:** use **Calibrate wrist angles after closing menu**, close the menu, then hold both hands forward with palms facing each other and thumbs up. Manual per-hand offsets are also available.
- **Lighting too bright/dark:** adjust **Visibility fill**. Default 0.5 halves the original supplemental lighting; 0 uses native lighting. This is additive fill, not a mathematically exact 50/50 shader blend.
- **Turning:** UEVR owns snap angle/deadzone; disabling Snap Turn uses the game's smooth turn sensitivity. The right stick is suppressed while right trigger is held.
- **Other injectors:** UE4SS is not needed and caused conflicts during development. Use this as a UEVR-only setup when troubleshooting.

## Validation boundary

`npm test` checks motion/pose math, mocked native dispatch, recovery, cleanup, bindings and release layout. It cannot prove real rendering or headset behavior. Hardware changes should be tested from a normal new/continued game through interactions, death/respawn, a menu pause and a script reset. Never infer compatibility from a passing simulated test alone.
