# Ratshaker VR - UEVR Mod

An **AI-slop Lua script** that turns [RATSHAKER](https://store.steampowered.com/app/3290710/RATSHAKER/) into a motion-controlled VR game using [praydog's UEVR](https://github.com/praydog/UEVR).

Independent tracked hands with arm IK, physical rat shaking with native sounds, squeeze interactions, and a left-hand pointer with target and charge feedback. Keeps the original shake-meter HUD and story progression. Reduces the pixelation/vertex wobble and adds adjustable lighting for the rat and photo pieces.

**Tested:** Quest 3, physical Quest controllers, Virtual Desktop, OpenXR and UEVR 1.05. Other headsets/controllers are untested; see [compatibility and troubleshooting](docs/compatibility.md). It's a working community mod, with some rough edges.

[![Watch RATSHAKER VR gameplay on YouTube](https://img.youtube.com/vi/iAd6nirdmec/hqdefault.jpg)](https://youtu.be/iAd6nirdmec)

[Watch the gameplay demo on YouTube](https://youtu.be/iAd6nirdmec).

## Install

1. Install RATSHAKER and [UEVR](https://github.com/praydog/UEVR/releases). Connect your headset to PC VR.
2. Download **[Ratshaker-Win64-Shipping.zip](https://github.com/KMielnik/Ratshaker-VR-UEVR-Mod/releases/latest/download/Ratshaker-Win64-Shipping.zip)** from the [latest release](https://github.com/KMielnik/Ratshaker-VR-UEVR-Mod/releases/latest). **Keep that filename.**
3. With the game closed, back up any existing RATSHAKER UEVR profile. Open UEVR and choose **Import Config**, then select the ZIP. Remove older copies of this mod's scripts if upgrading.
4. Launch RATSHAKER, select **Ratshaker-Win64-Shipping** in UEVR, select **OpenXR**, and click **Inject**. Close UEVR's in-game menu and play normally.

**Already injected when you imported?** Import Config copies the files but does not reload Lua. Close the game completely, relaunch and inject again so Lua and the supplied controller bindings load together.

No UE4SS, DLL installation, game-file patching, Python or Node.js is needed to play. For manual installation, copy the ZIP contents into `%APPDATA%\UnrealVRMod\Ratshaker-Win64-Shipping\` (not the Steam game folder). [Install, update and uninstall details](docs/compatibility.md#installation-details).

## Controls

| Action | Control |
|---|---|
| Move / turn | Left stick / right stick. Smooth or snap turning is selected in **UEVR → VR → Input → Snap Turn**. |
| Shake | Hold **right trigger** and shake your hand back and forth. Holding still adds no charge. |
| Squeeze / choke | Hold **right trigger + right grip**. This takes priority over shaking. |
| Point | Hold **left grip** and lift your index finger off the trigger. The sphere turns amber on an interactable target. |
| Interact | Charge the rat, point with the left hand, then hold **right trigger + grip** until the charge bar advances. Native game requirements still apply. |
| Open UEVR menu | **Insert**, or press both sticks. Use **LuaLoader → Script UI** for wrist calibration, shake sensitivity and visibility fill. |

On controllers without the supplied touch mappings, disable **Quest/Index touch bindings** in the script UI; pointing then uses left grip with left trigger released. Controllers are the supported input method; Virtual Desktop hand tracking is experimental.

## Develop

Use Python 3.10+ and Node.js 20+:

```sh
npm ci
npm run build
npm test
```

Edit `src/`, rebuild, and copy `profile/` into the game's UEVR profile. The build produces the importable ZIP in `dist/`. Offline tests use a simulated UEVR host; test changes in VR too. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License and credits

[MIT](LICENSE) for this mod's original code. RATSHAKER belongs to Sunscorched Studios; UEVR belongs to its respective authors. Neither is bundled or relicensed. Unofficial and unaffiliated. [Notices](NOTICE.md).
