# Climate Simulator Repository Memory

This is a dependency-free static WebGL 2 climate simulator. Keep it build-free unless the task explicitly requests an architectural change.

## Start here

- Read `README.md` for the behavioral specification and model rationale.
- Use `$climate-simulator-development` for repository changes.
- Also use `$climate-simulator-model-tuning` for GLSL physics, packed simulation state, seasonal statistics, or climate-classification work.
- Check `git status --short --branch` and preserve unrelated edits.

## Source map

- `index.html`: semantic UI, controls, view-mode radios, legends, point-climate panel.
- `styles.css`: all presentation and responsive behavior.
- `js/app.js`: WebGL wrappers, DOM wiring, textures/framebuffers, pass scheduling, seasons, readback, charts, rendering, presets, upload/download.
- `js/shaders.js`: all GLSL simulation, classification, and rendering programs.
- `assets/`: preset heightmaps and lookup/gradient textures.
- `.github/workflows/pages.yml`: syntax validation, static artifact assembly, GitHub Pages deployment.

## Invariants

- Keep HTML control IDs synchronized with JavaScript selectors and event wiring.
- Keep view-mode values 0-10 synchronized across HTML radios, `VIEW_NAMES`, `this.legends`, render-shader branches, overlays, and download names. View 9 is the current annualized precipitation rate; view 10 sums the twelve monthly climatology channels into the modeled annual total.
- Keep GLSL uniform names and output locations synchronized with JavaScript bindings, framebuffer attachments, and `drawBuffers`.
- Treat texture formats and channels as APIs. In particular, atmospheric RGBA stores water vapor, annualized precipitation, marine stability, and marine provenance; deep-ocean RGBA stores XY current, temperature, and salinity.
- Custom pressure areas have no fixed count limit: js/app.js rasterizes them into a 512×256 R32F forcing texture sampled by the advection shader. Preserve X wrapping, convert UI Y with textureY = 1 - verticalPosition, upload CPU arrays with UNPACK_FLIP_Y_WEBGL disabled, keep intensity within 0.1×–3×, and clamp combined forcing to ±0.25.
- Pressure-map files use the versioned climate-simulator-pressure-map JSON format. Export latitude/longitude rather than internal canvas coordinates; validate the full import before replacing state, then regenerate forcing and reset climate statistics.
- Preserve the surface-ocean -> deep-ocean -> atmosphere -> biome pass order and never read from a texture while rendering into it.
- Scale model tendencies for `simulationTimeStep`; use the existing `scaledFraction`/`pow` patterns for speed-invariant relaxation and decay.
- Observable model, control, limitation, run, or deployment changes require matching README updates.
- Avoid geographic special cases. Tune continuous mechanisms that work with arbitrary equirectangular heightmaps, retrograde rotation, and both hemispheric seasons.

## Validation

Run:

```sh
git diff --check
node --check js/app.js
node --check js/shaders.js
python3 -m http.server 8000
```

Use a WebGL 2 browser for runtime validation because Node does not compile the embedded GLSL. Confirm no startup error, exercise affected views/controls, and let automatic seasons complete a full model year when monthly climate or Köppen-like zones are affected. GitHub Pages copies only `index.html`, `styles.css`, `assets/`, and `js/` into `_site`; update the workflow if deployable files are added elsewhere.
