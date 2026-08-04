export const shaders = {
  fullscreenVertex: `#version 300 es
    layout(location = 0) in vec3 position;
    out vec2 textureCoordinate;

    void main() {
      textureCoordinate = position.xy * 0.5 + 0.5;
      gl_Position = vec4(position, 1.0);
    }
  `,

  oceanFragment: `#version 300 es
    precision highp float;

    uniform sampler2D heightmap;
    uniform sampler2D atmosphericWind;
    uniform sampler2D precipitationMap;
    uniform sampler2D previousCurrent;
    uniform sampler2D previousTemperature;
    uniform sampler2D previousSalinity;
    uniform sampler2D previousDeepState;
    uniform sampler2D previousOverturning;
    uniform float waterLevel;
    uniform float rotationSpeed;
    uniform float solarIrradiance;
    uniform float solarDeclination;
    uniform float oceanCirculation;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 nextCurrent;
    layout(location = 1) out vec4 nextTemperature;
    layout(location = 2) out vec4 nextSalinity;

    float getLatitude(vec2 uv) {
      return (2.0 * uv.y - 1.0) * 90.0;
    }

    float isOcean(vec2 uv) {
      return texture(heightmap, uv).r < waterLevel ? 1.0 : 0.0;
    }

    float getEquilibriumTemperature(vec2 uv) {
      float latitude = getLatitude(uv);
      float solarFactor = clamp(cos(radians(latitude - solarDeclination)), 0.4, 1.0);
      float temperature = 273.15 + mix(-45.0, 30.0, solarFactor) - 3.0;
      float seasonality = sin(radians(latitude)) * sin(radians(solarDeclination));
      temperature += seasonality * 5.0;
      return max(temperature * solarIrradiance / 1361.0, 271.0);
    }

    float readTemperature(vec2 uv) {
      float temperature = texture(previousTemperature, uv).r;
      return temperature > 100.0 ? temperature : getEquilibriumTemperature(uv);
    }

    float readSalinity(vec2 uv) {
      float salinity = texture(previousSalinity, uv).r;
      return salinity > 1.0 ? salinity : 35.0;
    }

    float getDensityAnomaly(vec2 uv) {
      float temperature = readTemperature(uv);
      float salinity = readSalinity(uv);
      return 0.75 * (salinity - 35.0) - 0.20 * (temperature - 288.0);
    }

    void main() {
      float ocean = isOcean(textureCoordinate);
      float equilibriumTemperature = getEquilibriumTemperature(textureCoordinate);
      if (ocean < 0.5) {
        nextCurrent = vec4(0.0);
        nextTemperature = vec4(equilibriumTemperature);
        nextSalinity = vec4(35.0);
        return;
      }

      vec2 texel = 1.0 / vec2(textureSize(previousCurrent, 0));
      float latitude = getLatitude(textureCoordinate);
      float cosineLatitude = max(cos(radians(latitude)), 0.15);
      vec2 oldCurrent = texture(previousCurrent, textureCoordinate).rg;
      vec2 transportScale = vec2(1.0 / cosineLatitude, 2.0) * 0.00025;
      vec2 backtracedCoordinate = textureCoordinate - oldCurrent * transportScale;
      if (isOcean(backtracedCoordinate) < 0.5) backtracedCoordinate = textureCoordinate;

      vec2 current = texture(previousCurrent, backtracedCoordinate).rg;
      float temperature = readTemperature(backtracedCoordinate);
      float salinity = readSalinity(backtracedCoordinate);
      vec4 deepState = texture(previousDeepState, textureCoordinate);
      float deepTemperature = deepState.b > 100.0 ? deepState.b : 277.0;
      float deepSalinity = deepState.a > 1.0 ? deepState.a : 34.7;
      float upwelling = 0.4 * max(-texture(previousOverturning, textureCoordinate).r, 0.0);
      temperature = mix(temperature, deepTemperature, upwelling);
      salinity = mix(salinity, deepSalinity, upwelling);

      float temperatureNeighbors = 0.25 * (
        readTemperature(textureCoordinate - vec2(texel.x, 0.0))
        + readTemperature(textureCoordinate + vec2(texel.x, 0.0))
        + readTemperature(textureCoordinate - vec2(0.0, texel.y))
        + readTemperature(textureCoordinate + vec2(0.0, texel.y))
      );
      float salinityNeighbors = 0.25 * (
        readSalinity(textureCoordinate - vec2(texel.x, 0.0))
        + readSalinity(textureCoordinate + vec2(texel.x, 0.0))
        + readSalinity(textureCoordinate - vec2(0.0, texel.y))
        + readSalinity(textureCoordinate + vec2(0.0, texel.y))
      );
      temperature = mix(temperature, temperatureNeighbors, 0.04);
      salinity = mix(salinity, salinityNeighbors, 0.04);

      vec2 wind = texture(atmosphericWind, textureCoordinate).rg;
      vec2 windDrivenTarget = wind * 0.025;
      current *= 0.992;
      current += oceanCirculation * 0.018 * (windDrivenTarget - current);

      float rotationRatio = rotationSpeed / 460.0;
      float coriolis = 0.010 * rotationRatio * sin(radians(latitude));
      current += coriolis * vec2(current.y, -current.x);

      float densityLeft = getDensityAnomaly(textureCoordinate - vec2(texel.x, 0.0));
      float densityRight = getDensityAnomaly(textureCoordinate + vec2(texel.x, 0.0));
      float densityDown = getDensityAnomaly(textureCoordinate - vec2(0.0, texel.y));
      float densityUp = getDensityAnomaly(textureCoordinate + vec2(0.0, texel.y));
      vec2 densityGradient = vec2(
        (densityRight - densityLeft) / cosineLatitude,
        densityUp - densityDown
      );
      current -= oceanCirculation * 0.012 * densityGradient;

      float oceanLeft = isOcean(textureCoordinate - vec2(texel.x, 0.0));
      float oceanRight = isOcean(textureCoordinate + vec2(texel.x, 0.0));
      float oceanDown = isOcean(textureCoordinate - vec2(0.0, texel.y));
      float oceanUp = isOcean(textureCoordinate + vec2(0.0, texel.y));
      vec2 coastNormal = vec2(oceanRight - oceanLeft, oceanUp - oceanDown);
      if (length(coastNormal) > 0.0) {
        coastNormal = normalize(coastNormal);
        current -= min(dot(current, coastNormal), 0.0) * coastNormal;
      }

      float currentSpeed = length(current);
      if (currentSpeed > 3.0) current *= 3.0 / currentSpeed;

      temperature = mix(temperature, equilibriumTemperature, 0.004);
      float precipitation = texture(precipitationMap, textureCoordinate).g;
      float evaporation = clamp(
        (temperature - 273.15) / 30.0,
        0.0,
        1.5
      ) * (1.0 + 0.03 * length(wind));
      salinity += 0.0012 * evaporation - 0.0008 * clamp(precipitation / 200.0, 0.0, 2.0);
      salinity = clamp(mix(salinity, 35.0, 0.0005), 30.0, 40.0);

      nextCurrent = vec4(current, 0.0, 0.0);
      nextTemperature = vec4(temperature);
      nextSalinity = vec4(salinity);
    }
  `,

  deepOceanFragment: `#version 300 es
    precision highp float;

    uniform sampler2D heightmap;
    uniform sampler2D surfaceCurrent;
    uniform sampler2D surfaceTemperature;
    uniform sampler2D surfaceSalinity;
    uniform sampler2D previousDeepState;
    uniform float waterLevel;
    uniform float rotationSpeed;
    uniform float deepOceanCirculation;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 nextDeepState;
    layout(location = 1) out vec4 nextOverturning;

    float isOcean(vec2 uv) {
      return texture(heightmap, uv).r < waterLevel ? 1.0 : 0.0;
    }

    vec4 readDeepState(vec2 uv) {
      vec4 state = texture(previousDeepState, uv);
      if (state.b < 100.0) return vec4(0.0, 0.0, 277.0, 34.7);
      return state;
    }

    float getDensity(float temperature, float salinity) {
      return 1027.0 - 0.20 * (temperature - 283.0) + 0.75 * (salinity - 35.0);
    }

    float getDeepDensity(vec2 uv) {
      vec4 state = readDeepState(uv);
      return getDensity(state.b, state.a);
    }

    void main() {
      if (isOcean(textureCoordinate) < 0.5) {
        nextDeepState = vec4(0.0, 0.0, 277.0, 34.7);
        nextOverturning = vec4(0.0);
        return;
      }

      vec2 texel = 1.0 / vec2(textureSize(previousDeepState, 0));
      float latitude = (2.0 * textureCoordinate.y - 1.0) * 90.0;
      float cosineLatitude = max(cos(radians(latitude)), 0.15);
      vec4 oldState = readDeepState(textureCoordinate);
      vec2 transportScale = vec2(1.0 / cosineLatitude, 2.0) * 0.00008;
      vec2 backtracedCoordinate = textureCoordinate - oldState.rg * transportScale;
      if (isOcean(backtracedCoordinate) < 0.5) backtracedCoordinate = textureCoordinate;

      vec4 state = readDeepState(backtracedCoordinate);
      vec2 current = state.rg;
      float temperature = state.b;
      float salinity = state.a;

      vec4 stateLeft = readDeepState(textureCoordinate - vec2(texel.x, 0.0));
      vec4 stateRight = readDeepState(textureCoordinate + vec2(texel.x, 0.0));
      vec4 stateDown = readDeepState(textureCoordinate - vec2(0.0, texel.y));
      vec4 stateUp = readDeepState(textureCoordinate + vec2(0.0, texel.y));
      temperature = mix(
        temperature,
        0.25 * (stateLeft.b + stateRight.b + stateDown.b + stateUp.b),
        0.015
      );
      salinity = mix(
        salinity,
        0.25 * (stateLeft.a + stateRight.a + stateDown.a + stateUp.a),
        0.015
      );

      vec2 surfaceVelocity = texture(surfaceCurrent, textureCoordinate).rg;
      current *= 0.996;
      current += deepOceanCirculation * 0.004 * (-0.20 * surfaceVelocity - current);

      float densityLeft = getDeepDensity(textureCoordinate - vec2(texel.x, 0.0));
      float densityRight = getDeepDensity(textureCoordinate + vec2(texel.x, 0.0));
      float densityDown = getDeepDensity(textureCoordinate - vec2(0.0, texel.y));
      float densityUp = getDeepDensity(textureCoordinate + vec2(0.0, texel.y));
      vec2 densityGradient = vec2(
        (densityRight - densityLeft) / cosineLatitude,
        densityUp - densityDown
      );
      current -= deepOceanCirculation * 0.003 * densityGradient;

      float rotationRatio = rotationSpeed / 460.0;
      float coriolis = 0.004 * rotationRatio * sin(radians(latitude));
      current += coriolis * vec2(current.y, -current.x);

      float oceanLeft = isOcean(textureCoordinate - vec2(texel.x, 0.0));
      float oceanRight = isOcean(textureCoordinate + vec2(texel.x, 0.0));
      float oceanDown = isOcean(textureCoordinate - vec2(0.0, texel.y));
      float oceanUp = isOcean(textureCoordinate + vec2(0.0, texel.y));
      vec2 coastNormal = vec2(oceanRight - oceanLeft, oceanUp - oceanDown);
      if (length(coastNormal) > 0.0) {
        coastNormal = normalize(coastNormal);
        current -= min(dot(current, coastNormal), 0.0) * coastNormal;
      }

      float currentSpeed = length(current);
      if (currentSpeed > 0.5) current *= 0.5 / currentSpeed;

      float surfaceTemp = texture(surfaceTemperature, textureCoordinate).r;
      float surfaceSalt = texture(surfaceSalinity, textureCoordinate).r;
      float surfaceDensity = getDensity(surfaceTemp, surfaceSalt);
      float deepDensity = getDensity(temperature, salinity);
      float densityContrast = surfaceDensity - deepDensity;
      float absoluteLatitude = abs(latitude);
      float sinkingWeight = smoothstep(40.0, 70.0, absoluteLatitude);
      float upwellingWeight = 1.0 - smoothstep(10.0, 35.0, absoluteLatitude);
      float sinking = 0.006 * sinkingWeight * max(densityContrast, 0.0);
      float upwelling = 0.003 * upwellingWeight * max(-densityContrast, 0.0);
      float overturning = deepOceanCirculation * clamp(sinking - upwelling, -0.015, 0.025);

      if (overturning > 0.0) {
        temperature = mix(temperature, surfaceTemp, overturning);
        salinity = mix(salinity, surfaceSalt, overturning);
      }
      temperature = mix(temperature, 277.0, 0.0002);
      salinity = clamp(mix(salinity, 34.7, 0.0002), 30.0, 40.0);

      nextDeepState = vec4(current, temperature, salinity);
      nextOverturning = vec4(overturning, 0.0, 0.0, 0.0);
    }
  `,

  advectionFragment: `#version 300 es
    precision highp float;

    const float PI = 3.14159265358979;

    uniform sampler2D heightmap;
    uniform sampler2D previousWaterVapor;
    uniform sampler2D previousWind;
    uniform sampler2D previousPressure;
    uniform sampler2D seaSurfaceTemperature;
    uniform float waterLevel;
    uniform float rotationSpeed;
    uniform float globalCirculation;
    uniform float solarIrradiance;
    uniform float solarDeclination;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 nextWaterVapor;
    layout(location = 1) out vec4 nextWind;
    layout(location = 2) out vec4 temperatureOutput;
    layout(location = 3) out vec4 nextPressure;

    float getLatitude(vec2 uv) {
      return (2.0 * uv.y - 1.0) * 90.0;
    }

    float getElevation(float height) {
      return max(height - waterLevel, 0.0) / max(1.0 - waterLevel, 0.0001);
    }

    float getSurfaceTemperature(vec2 uv) {
      float latitude = getLatitude(uv);
      float height = texture(heightmap, uv).r;
      float elevation = getElevation(height);
      float oceanTemperature = texture(seaSurfaceTemperature, uv).r;
      if (height < waterLevel && oceanTemperature > 100.0) return oceanTemperature;
      float solarFactor = max(cos(radians(latitude - solarDeclination)), 0.0);
      float latitudeBlend = height < waterLevel
        ? clamp(solarFactor, 0.4, 1.0)
        : clamp(solarFactor, 0.2, 1.0);

      float temperature = 273.15 + mix(-45.0, 30.0, latitudeBlend);
      // Most of the heightmap's land range represents low terrain. Applying
      // the lapse rate nonlinearly reserves strong cooling for mountains.
      temperature -= height < waterLevel ? 3.0 : pow(elevation, 3.0) * 45.0;

      // Land has less thermal inertia than water, creating the seasonal
      // pressure contrast that reverses monsoon flow.
      float seasonality = sin(radians(latitude)) * sin(radians(solarDeclination));
      temperature += seasonality * (height < waterLevel ? 5.0 : 20.0);
      return max(temperature * solarIrradiance / 1361.0, 1.0);
    }

    float getEquilibriumPressure(vec2 uv) {
      float latitude = getLatitude(uv);
      float height = texture(heightmap, uv).r;
      float elevation = getElevation(height);
      float seasonality = sin(radians(latitude)) * sin(radians(solarDeclination));
      float seasonalAnomaly = seasonality * (height < waterLevel ? 5.0 : 20.0);

      // Alternating radiative pressure belts produce Hadley, Ferrel, and
      // polar cells. Local seasonal heating then bends those cells around
      // continents instead of prescribing the final wind direction.
      float pressureBelts = -0.08 * cos(radians(latitude * 6.0));
      float thermalLow = -0.04 * seasonalAnomaly;
      float terrainHigh = 0.04 * elevation;
      return 1.0 + pressureBelts + thermalLow + terrainHigh;
    }

    vec2 getGlobalWind(float latitude) {
      float shiftedLatitude = latitude - 0.35 * solarDeclination;
      float absoluteLatitude = abs(shiftedLatitude);
      float hemisphere = shiftedLatitude >= 0.0 ? 1.0 : -1.0;

      float tradeWeight = 1.0 - smoothstep(25.0, 35.0, absoluteLatitude);
      float westerlyWeight = smoothstep(25.0, 35.0, absoluteLatitude)
        * (1.0 - smoothstep(55.0, 65.0, absoluteLatitude));
      float polarWeight = smoothstep(55.0, 65.0, absoluteLatitude);

      float zonalWind = -22.0 * tradeWeight
        + 26.0 * westerlyWeight
        - 12.0 * polarWeight;
      float meridionalWind = -4.0 * hemisphere * tradeWeight
        + 2.0 * hemisphere * westerlyWeight
        - 2.0 * hemisphere * polarWeight;

      float rotationRatio = rotationSpeed / 460.0;
      float rotationScale = sign(rotationRatio) * min(sqrt(abs(rotationRatio)), 1.5);
      float thermalScale = clamp(sqrt(max(solarIrradiance / 1361.0, 0.0)), 0.25, 2.0);
      return vec2(zonalWind, meridionalWind) * rotationScale * thermalScale;
    }

    void main() {
      vec2 texel = 1.0 / vec2(textureSize(previousPressure, 0));
      float latitude = getLatitude(textureCoordinate);
      float cosineLatitude = max(cos(radians(latitude)), 0.15);
      float height = texture(heightmap, textureCoordinate).r;
      float elevation = getElevation(height);

      vec2 oldWind = texture(previousWind, textureCoordinate).rg;
      vec2 transportScale = vec2(1.0 / cosineLatitude, 2.0) * 0.00002;
      vec2 backtracedCoordinate = textureCoordinate - oldWind * transportScale;
      vec2 wind = texture(previousWind, backtracedCoordinate).rg;
      float pressure = texture(previousPressure, textureCoordinate).r;

      float pressureLeft = texture(previousPressure, textureCoordinate - vec2(texel.x, 0.0)).r;
      float pressureRight = texture(previousPressure, textureCoordinate + vec2(texel.x, 0.0)).r;
      float pressureDown = texture(previousPressure, textureCoordinate - vec2(0.0, texel.y)).r;
      float pressureUp = texture(previousPressure, textureCoordinate + vec2(0.0, texel.y)).r;
      vec2 pressureGradient = vec2(
        (pressureRight - pressureLeft) / cosineLatitude,
        pressureUp - pressureDown
      );

      vec2 windLeft = texture(previousWind, textureCoordinate - vec2(texel.x, 0.0)).rg;
      vec2 windRight = texture(previousWind, textureCoordinate + vec2(texel.x, 0.0)).rg;
      vec2 windDown = texture(previousWind, textureCoordinate - vec2(0.0, texel.y)).rg;
      vec2 windUp = texture(previousWind, textureCoordinate + vec2(0.0, texel.y)).rg;
      float divergence = (windRight.x - windLeft.x) / cosineLatitude
        + windUp.y - windDown.y;

      float rotationRatio = rotationSpeed / 460.0;
      float coriolis = 0.012 * rotationRatio * sin(radians(latitude));
      vec2 coriolisAcceleration = coriolis * vec2(wind.y, -wind.x);
      vec2 pressureAcceleration = -35.0 * pressureGradient;
      float drag = mix(0.985, 0.960, smoothstep(waterLevel, 1.0, height));
      wind = wind * drag + pressureAcceleration + coriolisAcceleration;

      // Large-scale circulation is a weak relaxation target, not a fixed
      // velocity. Thermal pressure gradients can still create monsoons and
      // deflect the latitude bands around continents.
      vec2 globalWind = getGlobalWind(latitude);
      float circulationCoupling = globalCirculation
        * mix(0.018, 0.008, smoothstep(waterLevel, 1.0, height));
      wind += circulationCoupling * (globalWind - wind);

      float windSpeed = length(wind);
      if (windSpeed > 70.0) wind *= 70.0 / windSpeed;

      float pressureLaplacian = pressureLeft + pressureRight
        + pressureDown + pressureUp - 4.0 * pressure;
      float equilibriumPressure = getEquilibriumPressure(textureCoordinate);
      pressure += 0.02 * (equilibriumPressure - pressure)
        - 0.00002 * divergence
        + 0.20 * pressureLaplacian;
      pressure = clamp(pressure, 0.65, 1.35);

      vec2 moistureCoordinate = textureCoordinate - wind * transportScale;
      float waterVapor = texture(previousWaterVapor, moistureCoordinate).r;
      float neighboringWaterVapor = 0.25 * (
        texture(previousWaterVapor, moistureCoordinate - vec2(texel.x, 0.0)).r
        + texture(previousWaterVapor, moistureCoordinate + vec2(texel.x, 0.0)).r
        + texture(previousWaterVapor, moistureCoordinate - vec2(0.0, texel.y)).r
        + texture(previousWaterVapor, moistureCoordinate + vec2(0.0, texel.y)).r
      );
      // Small-scale atmospheric turbulence moves humidity across adjacent
      // streamlines instead of confining it to a single wind trajectory.
      waterVapor = mix(waterVapor, neighboringWaterVapor, 0.15);
      float temperature = getSurfaceTemperature(textureCoordinate);
      windSpeed = length(wind);

      float orographicLift = 0.0;
      float condensedWater = 0.0;
      if (height < waterLevel) {
        float evaporationCoefficient = 25.0 + 19.0 * windSpeed;
        float humidity = waterVapor * (
          18.0 + pow(1.0 - cos(radians(max(abs(latitude) - 9.0, 0.0))), 0.4) * 81.0
        );
        float saturationPressure = exp(
          77.3450 + 0.0057 * temperature - 7235.0 / temperature
        ) / pow(temperature, 8.2);
        float vaporPressure = saturationPressure * humidity;
        float atmosphericPressure = 101325.0;
        float humidityRatio = vaporPressure / (atmosphericPressure - vaporPressure);
        float saturatedHumidityRatio = saturationPressure / (
          atmosphericPressure - saturationPressure
        );
        float evaporationRate = evaporationCoefficient * (
          saturatedHumidityRatio - humidityRatio
        );
        waterVapor += 0.0000015 * evaporationRate * max(windSpeed, 0.5);
      } else {
        float heightLeft = texture(heightmap, textureCoordinate - vec2(texel.x, 0.0)).r;
        float heightRight = texture(heightmap, textureCoordinate + vec2(texel.x, 0.0)).r;
        float heightDown = texture(heightmap, textureCoordinate - vec2(0.0, texel.y)).r;
        float heightUp = texture(heightmap, textureCoordinate + vec2(0.0, texel.y)).r;
        vec2 terrainGradient = vec2(
          (heightRight - heightLeft) / cosineLatitude,
          heightUp - heightDown
        );
        float slope = length(terrainGradient);
        float upslope = max(
          dot(normalize(wind + vec2(0.0001)), normalize(terrainGradient + vec2(0.0001))),
          0.0
        ) * smoothstep(0.01, 0.15, slope);
        orographicLift = upslope;

        // Rainout is a fraction of available humidity. Low terrain therefore
        // passes most moisture inland, while windward mountain slopes can
        // still produce strong rain shadows.
        float condensation = 0.0002 + 0.0008 * elevation + 0.06 * upslope;
        float waterBeforeCondensation = waterVapor;
        waterVapor *= 1.0 - clamp(condensation, 0.0, 0.15);
        condensedWater = max(waterBeforeCondensation - waterVapor, 0.0);
      }

      waterVapor = max(waterVapor, 0.0001);

      // Column humidity is not rainfall. Rising equatorial and subpolar air
      // rains efficiently, while descending subtropical air can stay humid
      // without creating a wet surface climate.
      float circulationLatitude = abs(latitude - 0.35 * solarDeclination);
      float equatorialAscent = 1.0 - smoothstep(12.0, 25.0, circulationLatitude);
      float subpolarAscent = 1.0 - smoothstep(
        8.0,
        18.0,
        abs(circulationLatitude - 60.0)
      );
      float subtropicalSubsidence = 1.0 - smoothstep(
        7.0,
        18.0,
        abs(circulationLatitude - 30.0)
      );
      float convergenceRain = clamp(-divergence * 0.015, 0.0, 0.4);
      float seasonalLandHeating = smoothstep(
        0.02,
        0.16,
        max(sin(radians(latitude)) * sin(radians(solarDeclination)), 0.0)
      ) * step(waterLevel, height);
      float equatorwardOffset = latitude >= 0.0 ? -0.08 : 0.08;
      vec2 equatorwardCoordinate = textureCoordinate + vec2(0.0, equatorwardOffset);
      float equatorwardOcean = max(
        texture(heightmap, equatorwardCoordinate).r < waterLevel ? 1.0 : 0.0,
        max(
          texture(heightmap, equatorwardCoordinate - vec2(0.03, 0.0)).r < waterLevel ? 1.0 : 0.0,
          texture(heightmap, equatorwardCoordinate + vec2(0.03, 0.0)).r < waterLevel ? 1.0 : 0.0
        )
      );
      float zonalOcean = max(
        texture(heightmap, textureCoordinate - vec2(0.03, 0.0)).r < waterLevel ? 1.0 : 0.0,
        texture(heightmap, textureCoordinate + vec2(0.03, 0.0)).r < waterLevel ? 1.0 : 0.0
      );
      float polewardOffset = latitude >= 0.0 ? 0.08 : -0.08;
      float polewardHeight = texture(
        heightmap,
        textureCoordinate + vec2(0.0, polewardOffset)
      ).r;
      float polewardRelief = smoothstep(0.02, 0.18, polewardHeight - height);
      float monsoonLatitude = 1.0 - smoothstep(26.0, 34.0, abs(latitude));
      float monsoonAscent = seasonalLandHeating
        * monsoonLatitude
        * max(equatorwardOcean, 0.5 * zonalOcean);
      float monsoonOrography = max(orographicLift, polewardRelief);
      float rainfallEfficiency = clamp(
        0.35
          + 0.90 * equatorialAscent
          + 0.45 * subpolarAscent
          - 0.32 * subtropicalSubsidence
          + convergenceRain
          + 0.80 * orographicLift
          + 0.20 * monsoonAscent,
        0.03,
        1.60
      );
      float annualPrecipitation = waterVapor * 14000.0 * rainfallEfficiency
        + condensedWater * (40000.0 + 120000.0 * monsoonAscent * monsoonOrography)
        + 500.0 * monsoonAscent * (0.10 + 0.90 * monsoonOrography);

      nextWaterVapor = vec4(waterVapor, annualPrecipitation, 0.0, 0.0);
      nextWind = vec4(wind, 0.0, 0.0);
      temperatureOutput = vec4(temperature);
      nextPressure = vec4(pressure, 0.0, 0.0, 0.0);
    }
  `,

  biomeFragment: `#version 300 es
    precision mediump float;

    uniform sampler2D heightmap;
    uniform sampler2D waterVaporMap;
    uniform sampler2D temperatureMap;
    uniform sampler2D biomeLookup;
    uniform float waterLevel;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 outputColor;

    void main() {
      float height = texture(heightmap, textureCoordinate).r;
      if (height < waterLevel) {
        outputColor = vec4(0.3, 0.4, 0.7, 1.0);
        return;
      }

      float precipitation = texture(waterVaporMap, textureCoordinate).g;
      float celsius = texture(temperatureMap, textureCoordinate).r - 273.15;

      // Normalize to the axes of the source terrestrial-biome chart.
      vec2 lookupCoordinate = vec2(
        (celsius + 11.288) / (32.433 + 11.288),
        precipitation / 465.537
      );
      outputColor = texture(biomeLookup, lookupCoordinate);
    }
  `,

  climateStatsFragment: `#version 300 es
    precision highp float;

    uniform sampler2D temperatureMap;
    uniform sampler2D waterVaporMap;
    uniform sampler2D previousStatsA;
    uniform sampler2D previousStatsB;
    uniform sampler2D heightmap;
    uniform float sampleCount;
    uniform float solarDeclination;
    uniform float waterLevel;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 nextStatsA;
    layout(location = 1) out vec4 nextStatsB;

    void main() {
      float temperature = texture(temperatureMap, textureCoordinate).r - 273.15;
      float precipitation = texture(waterVaporMap, textureCoordinate).g;
      float latitude = (2.0 * textureCoordinate.y - 1.0) * 90.0;
      bool warmSeason = latitude == 0.0
        ? solarDeclination >= 0.0
        : latitude * solarDeclination >= 0.0;
      float height = texture(heightmap, textureCoordinate).r;
      float seasonalLandHeating = smoothstep(
        0.02,
        0.16,
        max(sin(radians(latitude)) * sin(radians(solarDeclination)), 0.0)
      ) * step(waterLevel, height);
      float equatorwardOffset = latitude >= 0.0 ? -0.08 : 0.08;
      vec2 equatorwardCoordinate = textureCoordinate + vec2(0.0, equatorwardOffset);
      float equatorwardOcean = max(
        texture(heightmap, equatorwardCoordinate).r < waterLevel ? 1.0 : 0.0,
        max(
          texture(heightmap, equatorwardCoordinate - vec2(0.03, 0.0)).r < waterLevel ? 1.0 : 0.0,
          texture(heightmap, equatorwardCoordinate + vec2(0.03, 0.0)).r < waterLevel ? 1.0 : 0.0
        )
      );
      float eastwardOcean = texture(
        heightmap,
        textureCoordinate + vec2(0.03, 0.0)
      ).r < waterLevel ? 1.0 : 0.0;
      float polewardOffset = latitude >= 0.0 ? 0.08 : -0.08;
      float polewardHeight = texture(
        heightmap,
        textureCoordinate + vec2(0.0, polewardOffset)
      ).r;
      float polewardRelief = smoothstep(0.02, 0.18, polewardHeight - height);
      float monsoonLatitude = 1.0 - smoothstep(26.0, 34.0, abs(latitude));
      float monsoonPotential = seasonalLandHeating
        * monsoonLatitude
        * max(
          equatorwardOcean * (0.35 + 0.65 * polewardRelief),
          0.8 * eastwardOcean
        );

      if (sampleCount < 0.5) {
        nextStatsA = vec4(temperature, temperature, temperature, precipitation);
        nextStatsB = vec4(
          precipitation,
          precipitation,
          warmSeason ? precipitation : 0.0,
          monsoonPotential
        );
        return;
      }

      vec4 statsA = texture(previousStatsA, textureCoordinate);
      vec4 statsB = texture(previousStatsB, textureCoordinate);
      float sampleWeight = 1.0 / (sampleCount + 1.0);

      nextStatsA = vec4(
        min(statsA.r, temperature),
        max(statsA.g, temperature),
        mix(statsA.b, temperature, sampleWeight),
        mix(statsA.a, precipitation, sampleWeight)
      );
      nextStatsB = vec4(
        min(statsB.r, precipitation),
        max(statsB.g, precipitation),
        mix(statsB.b, warmSeason ? precipitation : 0.0, sampleWeight),
        max(statsB.a, monsoonPotential)
      );
    }
  `,

  climateZoneFragment: `#version 300 es
    precision highp float;

    uniform sampler2D heightmap;
    uniform sampler2D climateStatsA;
    uniform sampler2D climateStatsB;
    uniform float waterLevel;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 outputColor;

    void main() {
      if (texture(heightmap, textureCoordinate).r < waterLevel) {
        outputColor = vec4(0.3, 0.4, 0.7, 1.0);
        return;
      }

      vec4 statsA = texture(climateStatsA, textureCoordinate);
      vec4 statsB = texture(climateStatsB, textureCoordinate);
      float coldestTemperature = statsA.r;
      float warmestTemperature = statsA.g;
      float meanTemperature = statsA.b;
      float annualPrecipitationCm = statsA.a;
      float driestMonthCm = statsB.r / 12.0;
      float wettestMonthCm = statsB.g / 12.0;
      float warmSeasonFraction = annualPrecipitationCm > 0.0
        ? statsB.b / annualPrecipitationCm
        : 0.5;
      float monsoonPotential = statsB.a;
      bool monsoonRegime = monsoonPotential > 0.15
        && warmSeasonFraction > 0.70
        && annualPrecipitationCm >= 25.0
        && wettestMonthCm >= max(15.0, 3.0 * driestMonthCm)
        && (meanTemperature < 20.0 || annualPrecipitationCm >= 80.0);

      // Köppen's aridity threshold is expressed in annual millimeters.
      float seasonalAdjustment = warmSeasonFraction > 0.7
        ? 280.0
        : (warmSeasonFraction >= 0.3 ? 140.0 : 0.0);
      float temperatureRangeAdjustment = 10.0 * max(
        warmestTemperature - meanTemperature,
        0.0
      );
      float aridityThreshold = max(
        20.0 * meanTemperature + seasonalAdjustment + temperatureRangeAdjustment,
        0.0
      );
      float annualPrecipitationMm = annualPrecipitationCm * 10.0;

      if (warmestTemperature < 10.0) {
        outputColor = warmestTemperature < 0.0
          ? vec4(0.85, 0.90, 0.91, 1.0)
          : vec4(0.51, 0.61, 0.66, 1.0);
      } else if (annualPrecipitationMm < aridityThreshold && !monsoonRegime) {
        bool desert = annualPrecipitationMm < 0.5 * aridityThreshold;
        bool hot = meanTemperature >= 18.0;
        if (desert) {
          outputColor = hot
            ? vec4(0.77, 0.36, 0.18, 1.0)
            : vec4(0.67, 0.43, 0.25, 1.0);
        } else {
          outputColor = hot
            ? vec4(0.74, 0.57, 0.22, 1.0)
            : vec4(0.62, 0.55, 0.30, 1.0);
        }
      } else if (coldestTemperature >= 18.0) {
        float monsoonLimitCm = max(10.0 - annualPrecipitationCm / 25.0, 0.0);
        if (driestMonthCm >= 6.0) {
          outputColor = vec4(0.03, 0.37, 0.24, 1.0); // Af
        } else if (driestMonthCm >= monsoonLimitCm) {
          outputColor = vec4(0.03, 0.51, 0.42, 1.0); // Am
        } else {
          outputColor = vec4(0.47, 0.65, 0.25, 1.0); // Aw/As
        }
      } else if (coldestTemperature > 0.0) {
        bool seasonallyDry = warmSeasonFraction < 0.3 || warmSeasonFraction > 0.7;
        outputColor = seasonallyDry
          ? vec4(0.61, 0.33, 0.40, 1.0)
          : vec4(0.26, 0.55, 0.45, 1.0);
      } else {
        float coldSeverity = clamp((-coldestTemperature) / 45.0, 0.0, 1.0);
        outputColor = mix(
          vec4(0.29, 0.43, 0.62, 1.0),
          vec4(0.20, 0.30, 0.52, 1.0),
          coldSeverity
        );
      }
    }
  `,

  renderFragment: `#version 300 es
    precision mediump float;

    uniform sampler2D heightmap;
    uniform sampler2D waterVaporMap;
    uniform sampler2D temperatureMap;
    uniform sampler2D biomeMap;
    uniform sampler2D windMap;
    uniform sampler2D waterVaporColors;
    uniform sampler2D temperatureColors;
    uniform sampler2D pressureMap;
    uniform sampler2D climateZoneMap;
    uniform sampler2D oceanCurrentMap;
    uniform sampler2D deepOceanState;
    uniform float waterLevel;
    uniform int viewMode;
    uniform bool grayscale;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 outputColor;

    void main() {
      if (viewMode == 0) {
        float height = texture(heightmap, textureCoordinate).r;
        outputColor = vec4(vec3(height), 1.0);
        if (!grayscale && height < waterLevel) {
          outputColor.rg = vec2(0.0);
        }
      } else if (viewMode == 1) {
        float waterVapor = texture(waterVaporMap, textureCoordinate).r / 0.06;
        outputColor = grayscale
          ? vec4(vec3(waterVapor), 1.0)
          : texture(waterVaporColors, vec2(waterVapor, 0.5));
      } else if (viewMode == 2) {
        float celsius = texture(temperatureMap, textureCoordinate).r - 273.15;
        float normalizedTemperature = (celsius + 50.0) / 80.0;
        outputColor = grayscale
          ? vec4(vec3(normalizedTemperature), 1.0)
          : texture(temperatureColors, vec2(normalizedTemperature, 0.5));
      } else if (viewMode == 3) {
        outputColor = texture(biomeMap, textureCoordinate);
      } else if (viewMode == 4) {
        vec2 wind = texture(windMap, textureCoordinate).rg;
        outputColor = vec4(0.5 * clamp(wind * 0.025, -1.0, 1.0) + 0.5, 0.0, 1.0);
      } else if (viewMode == 5) {
        float pressure = texture(pressureMap, textureCoordinate).r;
        float normalizedPressure = clamp(0.5 + (pressure - 1.0) * 4.0, 0.0, 1.0);
        outputColor = grayscale
          ? vec4(vec3(normalizedPressure), 1.0)
          : vec4(normalizedPressure, 0.2, 1.0 - normalizedPressure, 1.0);
      } else if (viewMode == 6) {
        outputColor = texture(climateZoneMap, textureCoordinate);
      } else if (viewMode == 7) {
        float height = texture(heightmap, textureCoordinate).r;
        if (height >= waterLevel) {
          outputColor = vec4(0.10, 0.08, 0.05, 1.0);
        } else {
          vec2 current = texture(oceanCurrentMap, textureCoordinate).rg;
          outputColor = vec4(0.5 * clamp(current * 0.8, -1.0, 1.0) + 0.5, 0.2, 1.0);
        }
      } else {
        float height = texture(heightmap, textureCoordinate).r;
        if (height >= waterLevel) {
          outputColor = vec4(0.10, 0.08, 0.05, 1.0);
        } else {
          vec2 current = texture(deepOceanState, textureCoordinate).rg;
          outputColor = vec4(0.5 * clamp(current * 2.5, -1.0, 1.0) + 0.5, 0.1, 1.0);
        }
      }
    }
  `,

  lineVertex: `#version 300 es
    uniform vec2 offset;
    layout(location = 0) in vec3 position;

    void main() {
      gl_Position = vec4(position.xy + offset, position.z, 1.0);
    }
  `,

  windVertex: `#version 300 es
    uniform sampler2D windMap;
    uniform float arrowScale;
    layout(location = 0) in vec3 position;

    void main() {
      vec2 textureCoordinate = position.xy * 0.5 + 0.5;
      vec2 wind = texture(windMap, textureCoordinate).rg;
      float strength = length(wind);
      wind = strength > 0.0 ? wind / strength : vec2(0.0);

      vec2 resolution = vec2(textureSize(windMap, 0));
      float aspectRatio = resolution.x / resolution.y;
      vec2 adjustedWind = vec2(wind.x, wind.y / aspectRatio);
      vec2 adjustedNormal = vec2(-adjustedWind.y, adjustedWind.x);
      vec2 normal = vec2(adjustedNormal.x, adjustedNormal.y * aspectRatio);

      vec2 arrowPoint;
      if (position.z == 0.0) arrowPoint = vec2(0.0);
      else if (position.z == 1.0 || position.z == 2.0 || position.z == 4.0) {
        arrowPoint = vec2(1.0, 0.0);
      } else if (position.z == 3.0) arrowPoint = vec2(0.8, -0.2);
      else arrowPoint = vec2(0.8, 0.2);

      arrowPoint *= strength * arrowScale;
      vec2 displacement = arrowPoint.x * wind + arrowPoint.y * normal;
      gl_Position = vec4(position.xy + displacement, 0.0, 1.0);
    }
  `,

  solidFragment: `#version 300 es
    precision mediump float;

    uniform vec4 color;
    layout(location = 0) out vec4 outputColor;

    void main() {
      outputColor = color;
    }
  `,
};
