# Climate Simulator

A WebGL 2 climate visualization that estimates water vapor, temperature,
biomes, atmospheric pressure, and wind from an equirectangular heightmap.

## Atmosphere model

Wind is evolved as a shallow-water fluid rather than prescribed directly.
Each GPU simulation pass:

- transports the previous velocity and moisture fields;
- mixes moisture between neighboring air streams;
- converts atmospheric humidity into surface precipitation using convergence,
  equatorial/subpolar ascent, subtropical subsidence, and terrain uplift;
- relaxes atmospheric pressure toward radiative pressure belts;
- nudges oceanic flow toward trade easterlies, mid-latitude westerlies, and
  polar easterlies;
- applies pressure-gradient acceleration and Coriolis deflection;
- updates pressure from horizontal divergence;
- applies surface drag and fractional terrain-slope precipitation;
- retains 45% of the uphill wind component on strong mountain faces while
  pressure gradients steer the blocked 55% around lower terrain; and
- weakly blends transported precipitation between neighboring cells to prevent
  unresolved one-pixel rainfall boundaries.

Users can add any practical number of high- or low-pressure areas from the
Simulation tab, place them by clicking the map, and move them by dragging or
with the arrow keys. Selecting a marker also exposes a relative intensity
control from 0.1× to 3×. The areas are rasterized into a smooth,
longitude-wrapping pressure-forcing texture, avoiding shader uniform-count
limits. The existing pressure-gradient and Coriolis terms therefore steer winds
outward from highs and inward toward lows without prescribing a wind direction
directly. Overlapping forcing is capped to keep the solver stable.

Pressure maps can be exported as versioned JSON and imported again from the
Simulation tab. Each file stores every area's high/low type, latitude,
longitude, and relative intensity. Import validates the complete file before
replacing the current areas, so malformed files leave the active map unchanged.

Solar declination controls seasonal heating. Positive values heat northern
continents more strongly and negative values heat southern continents,
producing seasonal monsoon reversal through land-ocean pressure differences.
The tropical pressure minimum, trade-wind convergence, and evaporation maximum
follow half of the solar-declination displacement. The precipitation model uses
a narrower migrating ITCZ while subtropical subsidence and subpolar ascent move
less, preventing the summer rain belt from expanding across entire subtropical
continents. The pressure display mode can be used to inspect the fluid solver
directly.

Global circulation is a weak velocity tendency rather than a fixed wind map.
The pressure solver can therefore bend the latitude bands around continents
and reverse local flow during monsoons. The circulation-strength control scales
this tendency from disabled (`0`) to twice Earth-like (`2`), and retrograde
rotation reverses all zonal bands. Monsoon moisture uses the humidity actually
transported by this wind field rather than a fixed east- or west-ocean mask, so
the source direction reverses with the circulation. A separate marine-moisture
tracer is generated over water, transported and mixed with humidity, and
gradually decays over land. Humidity-driven monsoons require a high product of
relative humidity and recent marine provenance, preventing residual continental
humidity from activating a full monsoon.

## Ocean model

The ocean has coupled surface and deep layers. The surface is driven by
atmospheric wind stress, Coriolis deflection, coastline constraints, and
temperature/salinity density gradients. Evaporation raises salinity,
precipitation freshens it, and local radiative forcing slowly restores
sea-surface temperature.

Surface wind stress includes Ekman deflection. Latitude-varying Coriolis and
coast geometry intensify poleward western-boundary currents such as the Gulf
Stream and Kuroshio, while eastern-boundary currents such as California and
Humboldt flow equatorward. Favorable alongshore winds mix deep cold water into
eastern boundaries. Cold SST creates a marine-inversion tracer that is mixed
and transported by the atmospheric wind field. The tracer decays over warm
land and suppresses convective precipitation nonlinearly, so dry coastal air
follows circulation rather than a fixed distance from a coastline. Strong
inversions outside the deep tropics also cap terrain and monsoon rainfall,
preventing generic mountain uplift from making the Atacama or Namib wet while
leaving low-stability equatorial and Indian monsoon coasts largely unaffected.
The precipitation response uses a continuous saturating inversion strength,
avoiding a hard rainfall threshold between neighboring coastal cells. The
inversion source compares SST with the cooler of the seasonal and annual
equilibrium temperatures, so ordinary warm-season ocean lag is not mistaken
for persistent cold-current upwelling.
Low-latitude overturning entrains deep water weakly into the broad ocean mixed
layer; concentrated eastern-boundary upwelling supplies the stronger coastal
cooling. This avoids applying a cold-current inversion to all tropical oceans.

The deep layer develops a slow return flow from density gradients and opposing
surface transport. Cold or saline high-latitude water sinks when it is denser
than the deep layer; buoyant deep water upwells mainly at low latitudes.
Vertical exchange carries surface heat and salinity downward and lets deep
water cool and freshen upwelling regions.

Transported sea-surface temperature feeds back into atmospheric temperature,
pressure, evaporation, biomes, and annual climate zones. The ocean-circulation
control ranges from disabled (`0`) to twice Earth-like (`2`). Deep overturning
has an independent strength control. The Ocean currents and Deep currents
displays visualize each layer's velocity direction and strength.

This remains a two-layer approximation. It does not resolve full 3D basin
bathymetry, multiple thermocline layers, tides, sea ice, or eddies below the
simulation grid.

## Temperature and precipitation

The Current temperature display shows the live modeled surface field. Annual
mean temperature, Coldest monthly mean, and Warmest monthly mean displays use
the twelve stored running monthly climatology values and become available after
all months have been sampled. The minimum and maximum maps are monthly-mean
extrema, not absolute daily or weather-event records. All four temperature maps
share the same −80 °C to 50 °C color scale so colors can be compared directly.
Zero Celsius is green, subzero temperatures transition through cyan, blue, and
violet, and positive temperatures transition through yellow, orange, and red.
Clicking the map reports the annual mean, both monthly-mean extrema, and the
full monthly series.

The Precipitation rate display maps the current season's annualized surface
precipitation rate from `0` to `300+ cm/year`; it is not the completed annual
total. The separate Annual precipitation display sums the twelve stored running
monthly means into a modeled total in `cm/year`. It fills progressively during
the first automatic climate year and remains available while later years refine
the monthly climatology. Both maps combine atmospheric humidity with ascent,
subsidence, convergence, monsoon convection, terrain condensation, and cold
coastal upwelling effects; they are distinct from the atmospheric Water vapor
display. The selected-point charts use the same twelve equal-length model-month
totals and sum those months for the annual total.

Outside the deep tropics, prescribed ascent over land is limited by simulated
convergence and boundary-layer relative humidity. This keeps warm seas near a
subtropical desert from automatically creating a monsoon while retaining
convergent humid coasts and plateau-driven monsoons.

Land and ocean temperatures apply seasonal anomalies around an annual
latitude-based equilibrium rather than treating solar declination as an
instantaneous latitude shift. Land responds more strongly than the ocean,
retaining the thermal contrast that drives monsoons without producing
unrealistically cold subtropical winters. Land temperature also applies a
nonlinear elevation lapse curve with a maximum `70 K` relief penalty. The
exponent concentrates cooling in plateaus and mountain ranges such as the Andes
and Himalayas while limiting the effect on low terrain.

The simulator batches GPU passes during its initial 600-pass warm-up, then
switches to a lower-cost maintenance rate. Changing a planetary parameter
automatically restarts the accelerated settling period without discarding the
current atmospheric state.

## Seasons and climate zones

Automatic seasons advance solar declination through a sinusoidal model year.
The detail selector offers simulated years of roughly 3, 6, 12, 20, 40, 60,
or 120 seconds after warm-up. Each mode covers the same amount of modeled
atmosphere and ocean time: short years use larger transport and relaxation
steps, while long years use smaller steps and collect more seasonal samples.
Sub-quarter solver steps are accumulated before a GPU update to avoid excess
interpolation diffusion in the longest modes. The three-second mode is the
reference timestep. Actual wall-clock time depends on GPU performance.

During each year, GPU textures accumulate:

- coldest, warmest, and mean temperature;
- mean annual, driest, and wettest precipitation;
- warm-season and cold-season precipitation shares; and
- mean temperature and precipitation for twelve equal-length model months.

Click the map to inspect any cell. The selected-point panel reads all twelve
monthly bins and the classified climate-zone color directly from the GPU. It
displays monthly temperature and precipitation charts, exact values,
local-hemisphere season names, coordinates, a Köppen-like type, and an annual
summary. The arrow keys move a focused map selection; hold Shift for larger
steps. The first pattern fills progressively during the first automatic climate
year and remains available while subsequent years refine the climatology.

At the end of the year these values are classified into a Köppen-like map.
The implementation includes tropical rainforest, monsoon, and savanna zones;
hot and cold desert/steppe zones; temperate and continental zones with
seasonal rainfall; and tundra/ice-cap zones. It follows Köppen-style thresholds
but remains an approximation because the point panel's months are equal-length
model bins, while classification uses sampled annual statistics rather than
observed calendar-month normals. The atmosphere is not vertically resolved.
The map uses the exact 30-class RGB palette published by Beck et al. (2023).
Annual-mean temperature provides a proxy for the monthly warm-season count used
to separate the `b` and `c` thermal subclasses.

Monsoon classification also records a seasonal potential based on summer
continental heating, transported relative humidity, convergence, and
equatorward ocean access reinforced by a strong poleward plateau. Separate
cool-winter and warm monsoon thresholds prevent the subtropical desert belt
from overriding windward East Asian climates without granting the same
exception to warm desert interiors.

Humid lowland marine monsoons retain a rainfall floor without requiring nearby
high relief, and the temperate monsoon taper reaches into the mid-latitudes.
Both remain gated by transported relative humidity, recent marine provenance,
seasonal land heating, and simulated flow, improving East Asian rainfall
without a fixed China or east-coast mask.

## Run locally

Browser security rules require ES modules to be served over HTTP:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>.

The control panel separates heightmap and preset selection under **World** from
all numeric and seasonal model parameters under **Simulation**. The tabs also
support Left/Right arrow, Home, and End keyboard navigation.

The simulation defaults to 1366 × 683 pixels. Override its internal rendering
resolution with URL parameters, for example:

```text
http://localhost:8000/?width=1024&height=512
```

## Deploy to GitHub Pages

The Pages workflow validates the JavaScript and builds a static artifact for
every pull request targeting `main`. Pushes to `main` and manual workflow runs
also deploy that artifact to GitHub Pages.

In the repository settings, select **GitHub Actions** as the source under
**Pages**. The deployment does not require a package install or build tool.

## Structure

- `index.html` contains semantic page markup and controls.
- `styles.css` contains layout and responsive presentation.
- `js/app.js` contains WebGL resources, simulation passes, and interactions.
- `js/shaders.js` contains the named GLSL programs.
- `assets/` contains local heightmaps and color lookup textures.
