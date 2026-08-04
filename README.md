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
- applies surface drag and fractional terrain-slope precipitation.

Solar declination controls seasonal heating. Positive values heat northern
continents more strongly and negative values heat southern continents,
producing seasonal monsoon reversal through land-ocean pressure differences.
The pressure display mode can be used to inspect the fluid solver directly.

Global circulation is a weak velocity tendency rather than a fixed wind map.
The pressure solver can therefore bend the latitude bands around continents
and reverse local flow during monsoons. The circulation-strength control scales
this tendency from disabled (`0`) to twice Earth-like (`2`), and retrograde
rotation reverses all zonal bands.

## Ocean model

The ocean has coupled surface and deep layers. The surface is driven by
atmospheric wind stress, Coriolis deflection, coastline constraints, and
temperature/salinity density gradients. Evaporation raises salinity,
precipitation freshens it, and local radiative forcing slowly restores
sea-surface temperature.

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
- warm-season and cold-season precipitation shares.

At the end of the year these values are classified into a Köppen-like map.
The implementation includes tropical rainforest, monsoon, and savanna zones;
hot and cold desert/steppe zones; temperate and continental zones with
seasonal rainfall; and tundra/ice-cap zones. It follows Köppen-style thresholds
but remains an approximation because the simulator does not model twelve
discrete observed months or a vertically resolved atmosphere.

Monsoon classification also records a seasonal geographic potential based on
summer continental heating, diagonal/equatorward ocean access, eastern-ocean
access, and poleward relief. This prevents the subtropical desert belt from
overriding windward Asian monsoon climates while retaining dry continental and
rain-shadow cells.

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
