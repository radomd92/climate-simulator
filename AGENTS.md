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
- `js/app.js`: minimal browser entry point; instantiate and initialize `ClimateSimulator` only.
- `js/climate-simulator.js`: orchestration, DOM wiring, simulation passes, seasons, rendering, presets, readback, and downloads.
- `js/webgl.js`: WebGL program, mesh, texture, and framebuffer wrappers.
- `js/pressure-map.js`: pressure-map validation, serialization, and CPU rasterization.
- `js/map-magnifier.js`: live hover-lens state and rendering.
- `js/point-climate-panel.js`: point-climate table and chart presentation.
- `js/simulation-config.js`: shared simulator constants; `js/climate-catalog.js`: months, seasons, and Köppen labels.
- `js/shaders.js`: all GLSL simulation, classification, and rendering programs.
- `assets/`: preset heightmaps and lookup/gradient textures.
- `.github/workflows/pages.yml`: syntax validation, static artifact assembly, GitHub Pages deployment.

## Invariants

- Keep HTML control IDs synchronized with JavaScript selectors and event wiring.
- The optional map magnifier is a pointer-transparent 2D canvas fed from the final WebGL canvas. Keep its toggle label/`aria-pressed`, hover visibility, Escape behavior, 3× crop math, and render-loop refresh synchronized.
- Keep view-mode values 0-13 synchronized across HTML radios, `VIEW_NAMES`, `this.legends`, render-shader branches, overlays, and download names. View 9 is the current annualized precipitation rate; view 10 sums the twelve monthly precipitation channels; views 11-13 read the twelve monthly temperature channels for annual mean, coldest monthly mean, and warmest monthly mean.
- Keep GLSL uniform names and output locations synchronized with JavaScript bindings, framebuffer attachments, and `drawBuffers`.
- Current, annual-mean, coldest-month, and warmest-month temperature views share one −80 °C to 50 °C normalization. Keep the GLSL palette and CSS legends synchronized: 0 °C is green, subzero values progress through cyan/blue/violet, and positive values progress through yellow/orange/red.
- Treat texture formats and channels as APIs. In particular, atmospheric RGBA stores water vapor, annualized precipitation, marine stability, and marine provenance; deep-ocean RGBA stores XY current, temperature, and salinity.
- Custom pressure areas have no fixed count limit: js/pressure-map.js rasterizes them into a 512×256 R32F forcing texture sampled by the advection shader. Preserve X wrapping, convert UI Y with textureY = 1 - verticalPosition, upload CPU arrays with UNPACK_FLIP_Y_WEBGL disabled, keep intensity within 0.1×–3×, and clamp combined forcing to ±0.25.
- Pressure-map files use the versioned climate-simulator-pressure-map JSON format. Export latitude/longitude rather than internal canvas coordinates; validate the full import before replacing state, then regenerate forcing and reset climate statistics.
- Preserve the surface-ocean -> deep-ocean -> atmosphere -> biome pass order and never read from a texture while rendering into it.
- Scale model tendencies for `simulationTimeStep`; use the existing `scaledFraction`/`pow` patterns for speed-invariant relaxation and decay.
- Atmospheric pressure gradients retain radial acceleration and add a bounded contour-parallel adjustment. Preserve hemisphere and rotation-direction reversal, continuous fading near the equator/zero rotation/weak gradients, and the 70-unit wind cap.
- Keep pressure-driven moisture bounded: evaporation uses a saturating wind factor, marine monsoon gates require regional ocean-to-land flow in both the atmosphere and statistics shaders, and overlapping monsoon rainfall paths share one 950 cm/year cap.
- Observable model, control, limitation, run, or deployment changes require matching README updates.
- Avoid geographic special cases. Tune continuous mechanisms that work with arbitrary equirectangular heightmaps, retrograde rotation, and both hemispheric seasons.

## Validation

Run:

```sh
git diff --check
for file in js/*.js; do node --input-type=module --check < "$file"; done
python3 -m http.server 8000
```

Use a WebGL 2 browser for runtime validation because Node does not compile the embedded GLSL. Confirm no startup error, exercise affected views/controls, and let automatic seasons complete a full model year when monthly climate or Köppen-like zones are affected. GitHub Pages copies only `index.html`, `styles.css`, `assets/`, and `js/` into `_site`; update the workflow if deployable files are added elsewhere.
