# Fathom

A scroll-driven descent through the four depth zones of the open ocean, built with Three.js.
Scrolling lowers the camera from the sunlit surface to an unidentified structure on the abyssal floor.

Live: https://deeptutorai.github.io/fathom/

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
npm run preview  # serve the production bundle
```

Requires a browser with WebGL2. Without it, the page falls back to a readable text version of the story.

Every push to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml`.

## Structure

```
src/
  main.js                 Entry: capability checks, loader, fallback
  config.js               Depth zones, palette keyframes, camera path, quality tiers
  core/
    Experience.js         Orchestrator: build steps, frame loop, interaction wiring, disposal
    Renderer.js           WebGLRenderer, post chain (bloom, tone mapping, grade), adaptive resolution
    CameraRig.js          Spline camera, pointer look, sway, intro move, portrait FOV
    ScrollController.js   Native scroll mapped to progress through a critically damped spring
    Pointer.js            Pointer state, ray, speed, taps
    Quality.js            WebGL2 check, device tier, prefers-reduced-motion
  world/                  Scene components (each: object, range, update, optional resize)
  interaction/            Hover picking against creature hit volumes
  ui/                     Loader, narrative typography, HUD telemetry, custom cursor
  audio/SoundEngine.js    Procedural Web Audio, driven only by the event bus
```

Each world component declares the progress `range` in which it can be seen. The frame loop hides
and skips components outside it, so only the current depth is simulated and drawn.

## Behaviour notes

- **Scroll** stays native (keyboard, scrollbar and assistive technology keep working); the camera
  follows with damped momentum and a speed cap.
- **Reduced motion** (`prefers-reduced-motion`) removes camera sway, parallax, blur transitions,
  bubbles and the intro sweep, follows scroll directly and slows ambient animation. It updates live.
- **Quality tiers** lower particle counts, fish counts, pixel ratio and disable bloom on touch-first
  or low-memory devices. Frame time is sampled after the intro; resolution steps down if it stays
  above 25 ms.
- **Sound** is off until the visitor chooses it. All cues are synthesised and subscribe to bus events
  (`hover`, `scatter`, `pulse`, `zone`, `awaken`), so recorded assets can replace them without
  touching interaction code.
- **Resources** are released in `Experience.dispose()`, which also runs on WebGL context loss.

## Content

Zone boundaries, pressure (about 1 atm per 10 m) and the diel vertical migration are real. The
temperature readout follows a typical open-ocean profile. The structure at the end is fiction.
