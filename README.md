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
the source direction reverses with the circulation.

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
avoiding a hard rainfall threshold between neighboring coastal cells.
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

The precipitation display maps the model's annualized surface precipitation
from `0` to `300+ cm/year`. It combines atmospheric humidity with ascent,
subsidence, convergence, monsoon convection, terrain condensation, and cold
coastal upwelling effects; it is distinct from the atmospheric Water vapor
display.

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
The fast setting evaluates one year in roughly three seconds after warm-up;
the detailed setting uses twice as many fluid passes and seasonal samples.

During each year, GPU textures accumulate:

- coldest, warmest, and mean temperature;
- mean annual, driest, and wettest precipitation;
- warm-season and cold-season precipitation shares; and
- mean temperature and precipitation for Mar-May, Jun-Aug, Sep-Nov, and
  Dec-Feb.

Click the map to inspect any cell. The selected-point panel reads these four
seasonal bins directly from the GPU and displays temperature and precipitation
charts, exact values, local-hemisphere season names, coordinates, and an annual
summary. The arrow keys move a focused map selection; hold Shift for larger
steps. The first pattern fills progressively during the first automatic climate
year and remains available while subsequent years refine the climatology.

At the end of the year these values are classified into a Köppen-like map.
The implementation includes tropical rainforest, monsoon, and savanna zones;
hot and cold desert/steppe zones; temperate and continental zones with
seasonal rainfall; and tundra/ice-cap zones. It follows Köppen-style thresholds
but remains an approximation because the simulator does not model twelve
discrete observed months or a vertically resolved atmosphere.

Monsoon classification also records a seasonal potential based on summer
continental heating, transported relative humidity, convergence, and
equatorward ocean access reinforced by a strong poleward plateau. Separate
cool-winter and warm monsoon thresholds prevent the subtropical desert belt
from overriding windward East Asian climates without granting the same
exception to warm desert interiors.

## Run locally

Browser security rules require ES modules to be served over HTTP:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>.

The simulation defaults to 1366 × 683 pixels. Override its internal rendering
resolution with URL parameters, for example:

```text
http://localhost:8000/?width=1024&height=512
```

## Structure

- `index.html` contains semantic page markup and controls.
- `styles.css` contains layout and responsive presentation.
- `js/app.js` contains WebGL resources, simulation passes, and interactions.
- `js/shaders.js` contains the named GLSL programs.
- `assets/` contains local heightmaps and color lookup textures.
