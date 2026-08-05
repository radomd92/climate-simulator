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
    uniform float simulationTimeStep;

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
      float solarFactor = clamp(cos(radians(latitude)), 0.4, 1.0);
      float temperature = 273.15 + mix(-45.0, 30.0, solarFactor) - 3.0;
      float seasonality = sin(radians(latitude)) * sin(radians(solarDeclination));
      temperature += seasonality * 12.0;
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

    float scaledFraction(float fraction) {
      return 1.0 - pow(1.0 - clamp(fraction, 0.0, 0.999999), simulationTimeStep);
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
      vec2 transportScale = vec2(1.0 / cosineLatitude, 2.0)
        * 0.00025
        * simulationTimeStep;
      vec2 backtracedCoordinate = textureCoordinate - oldCurrent * transportScale;
      if (isOcean(backtracedCoordinate) < 0.5) backtracedCoordinate = textureCoordinate;

      vec2 current = texture(previousCurrent, backtracedCoordinate).rg;
      float temperature = readTemperature(backtracedCoordinate);
      float salinity = readSalinity(backtracedCoordinate);
      vec4 deepState = texture(previousDeepState, textureCoordinate);
      float deepTemperature = deepState.b > 100.0 ? deepState.b : 277.0;
      float deepSalinity = deepState.a > 1.0 ? deepState.a : 34.7;
      // Broad tropical upwelling entrains only a small fraction of deep water
      // into the mixed layer; stronger cooling is handled at eastern coasts.
      float upwelling = 0.04 * max(-texture(previousOverturning, textureCoordinate).r, 0.0);
      float upwellingFraction = scaledFraction(upwelling);
      temperature = mix(temperature, deepTemperature, upwellingFraction);
      salinity = mix(salinity, deepSalinity, upwellingFraction);

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
      temperature = mix(
        temperature,
        temperatureNeighbors,
        0.04 * simulationTimeStep
      );
      salinity = mix(salinity, salinityNeighbors, 0.04 * simulationTimeStep);

      vec2 wind = texture(atmosphericWind, textureCoordinate).rg;
      float rotationRatio = rotationSpeed / 460.0;
      float rotationDirection = sign(rotationRatio);
      float hemisphere = latitude >= 0.0 ? 1.0 : -1.0;
      vec2 ekmanDirection = rotationDirection * hemisphere * vec2(wind.y, -wind.x);
      vec2 windDrivenTarget = wind * 0.022
        + ekmanDirection * 0.010 * min(sqrt(abs(rotationRatio)), 1.5);
      current *= pow(0.992, simulationTimeStep);
      current += simulationTimeStep
        * oceanCirculation
        * 0.022
        * (windDrivenTarget - current);

      float coriolis = 0.020 * rotationRatio * sin(radians(latitude));
      current += simulationTimeStep * coriolis * vec2(current.y, -current.x);

      float densityLeft = getDensityAnomaly(textureCoordinate - vec2(texel.x, 0.0));
      float densityRight = getDensityAnomaly(textureCoordinate + vec2(texel.x, 0.0));
      float densityDown = getDensityAnomaly(textureCoordinate - vec2(0.0, texel.y));
      float densityUp = getDensityAnomaly(textureCoordinate + vec2(0.0, texel.y));
      vec2 densityGradient = vec2(
        (densityRight - densityLeft) / cosineLatitude,
        densityUp - densityDown
      );
      current -= simulationTimeStep * oceanCirculation * 0.012 * densityGradient;

      float oceanLeft = isOcean(textureCoordinate - vec2(texel.x, 0.0));
      float oceanRight = isOcean(textureCoordinate + vec2(texel.x, 0.0));
      float oceanDown = isOcean(textureCoordinate - vec2(0.0, texel.y));
      float oceanUp = isOcean(textureCoordinate + vec2(0.0, texel.y));
      float oceanLeftWide = isOcean(textureCoordinate - vec2(3.0 * texel.x, 0.0));
      float oceanRightWide = isOcean(textureCoordinate + vec2(3.0 * texel.x, 0.0));
      float oceanDownWide = isOcean(textureCoordinate - vec2(0.0, 3.0 * texel.y));
      float oceanUpWide = isOcean(textureCoordinate + vec2(0.0, 3.0 * texel.y));
      vec2 coastGradient = vec2(oceanRight - oceanLeft, oceanUp - oceanDown)
        + 0.5 * vec2(oceanRightWide - oceanLeftWide, oceanUpWide - oceanDownWide);
      float coastStrength = clamp(length(coastGradient), 0.0, 1.0);
      vec2 coastNormal = coastStrength > 0.0 ? normalize(coastGradient) : vec2(0.0);
      if (coastStrength > 0.0) {
        current -= min(dot(current, coastNormal), 0.0) * coastNormal;
      }

      // Beta-plane boundary currents: poleward and fast on western ocean
      // boundaries (Gulf Stream/Kuroshio), equatorward and slower on eastern
      // ocean boundaries (California/Canary/Humboldt/Benguela).
      float boundaryLatitude = smoothstep(8.0, 20.0, abs(latitude))
        * (1.0 - smoothstep(50.0, 62.0, abs(latitude)));
      float westernBoundary = max(coastNormal.x, 0.0) * coastStrength;
      float easternBoundary = max(-coastNormal.x, 0.0) * coastStrength;
      vec2 polewardDirection = vec2(0.0, hemisphere * rotationDirection);
      vec2 boundaryTarget = polewardDirection * (
        2.00 * westernBoundary - 0.70 * easternBoundary
      );
      float boundaryRelaxation = boundaryLatitude * (
        0.060 * westernBoundary + 0.030 * easternBoundary
      );
      current += scaledFraction(oceanCirculation * boundaryRelaxation)
        * (boundaryTarget - current);

      vec2 warmSourceCoordinate = textureCoordinate - vec2(0.0, 0.08 * hemisphere);
      float warmSourceTemperature = max(
        readTemperature(warmSourceCoordinate),
        max(
          getEquilibriumTemperature(warmSourceCoordinate),
          equilibriumTemperature + 4.0 * boundaryLatitude
        )
      );
      float warmBoundaryFraction = scaledFraction(clamp(
        0.25 * oceanCirculation * westernBoundary * boundaryLatitude,
        0.0,
        0.25
      ));
      temperature = mix(
        temperature,
        max(temperature, warmSourceTemperature),
        warmBoundaryFraction
      );

      vec2 equatorwardDirection = -polewardDirection;
      float favorableUpwellingWind = max(
        dot(normalize(wind + vec2(0.0001)), equatorwardDirection),
        0.0
      );
      float coastalUpwelling = oceanCirculation
        * abs(rotationDirection)
        * easternBoundary
        * boundaryLatitude
        * favorableUpwellingWind;
      temperature = mix(
        temperature,
        deepTemperature,
        scaledFraction(clamp(0.025 * coastalUpwelling, 0.0, 0.05))
      );
      salinity = mix(
        salinity,
        deepSalinity,
        scaledFraction(clamp(0.012 * coastalUpwelling, 0.0, 0.025))
      );

      float currentSpeed = length(current);
      if (currentSpeed > 3.0) current *= 3.0 / currentSpeed;

      temperature = mix(
        temperature,
        equilibriumTemperature,
        scaledFraction(0.004)
      );
      float precipitation = texture(precipitationMap, textureCoordinate).g;
      float evaporation = clamp(
        (temperature - 273.15) / 30.0,
        0.0,
        1.5
      ) * (1.0 + 0.03 * length(wind));
      salinity += simulationTimeStep * (
        0.0012 * evaporation
        - 0.0008 * clamp(precipitation / 200.0, 0.0, 2.0)
      );
      salinity = clamp(
        mix(salinity, 35.0, scaledFraction(0.0005)),
        30.0,
        40.0
      );

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
    uniform float simulationTimeStep;

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

    float scaledFraction(float fraction) {
      return 1.0 - pow(1.0 - clamp(fraction, 0.0, 0.999999), simulationTimeStep);
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
      vec2 transportScale = vec2(1.0 / cosineLatitude, 2.0)
        * 0.00008
        * simulationTimeStep;
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
        0.015 * simulationTimeStep
      );
      salinity = mix(
        salinity,
        0.25 * (stateLeft.a + stateRight.a + stateDown.a + stateUp.a),
        0.015 * simulationTimeStep
      );

      vec2 surfaceVelocity = texture(surfaceCurrent, textureCoordinate).rg;
      current *= pow(0.996, simulationTimeStep);
      current += scaledFraction(deepOceanCirculation * 0.004)
        * (-0.20 * surfaceVelocity - current);

      float densityLeft = getDeepDensity(textureCoordinate - vec2(texel.x, 0.0));
      float densityRight = getDeepDensity(textureCoordinate + vec2(texel.x, 0.0));
      float densityDown = getDeepDensity(textureCoordinate - vec2(0.0, texel.y));
      float densityUp = getDeepDensity(textureCoordinate + vec2(0.0, texel.y));
      vec2 densityGradient = vec2(
        (densityRight - densityLeft) / cosineLatitude,
        densityUp - densityDown
      );
      current -= simulationTimeStep
        * deepOceanCirculation
        * 0.003
        * densityGradient;

      float rotationRatio = rotationSpeed / 460.0;
      float coriolis = 0.004 * rotationRatio * sin(radians(latitude));
      current += simulationTimeStep * coriolis * vec2(current.y, -current.x);

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
        float exchangeFraction = scaledFraction(overturning);
        temperature = mix(temperature, surfaceTemp, exchangeFraction);
        salinity = mix(salinity, surfaceSalt, exchangeFraction);
      }
      temperature = mix(temperature, 277.0, scaledFraction(0.0002));
      salinity = clamp(
        mix(salinity, 34.7, scaledFraction(0.0002)),
        30.0,
        40.0
      );

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
    uniform sampler2D pressureForcingMap;
    uniform float waterLevel;
    uniform float rotationSpeed;
    uniform float globalCirculation;
    uniform float solarIrradiance;
    uniform float solarDeclination;
    uniform float simulationTimeStep;

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

    float getOceanWeight(vec2 uv) {
      float height = texture(heightmap, uv).r;
      return 1.0 - smoothstep(waterLevel - 0.025, waterLevel + 0.025, height);
    }

    float getRegionalOnshoreFlow(vec2 uv, vec2 wind, float latitude) {
      float cosineLatitude = max(cos(radians(latitude)), 0.15);
      float zonalOffset = 0.04 / cosineLatitude;
      float meridionalOffset = 0.08;
      float windSpeed = length(wind);
      vec2 windDirection = wind / max(windSpeed, 0.001);
      float oceanWest = getOceanWeight(uv - vec2(zonalOffset, 0.0));
      float oceanEast = getOceanWeight(uv + vec2(zonalOffset, 0.0));
      float oceanSouth = getOceanWeight(uv - vec2(0.0, meridionalOffset));
      float oceanNorth = getOceanWeight(uv + vec2(0.0, meridionalOffset));
      float onshoreFlux = max(
        max(
          oceanWest * max(windDirection.x, 0.0),
          oceanEast * max(-windDirection.x, 0.0)
        ),
        max(
          oceanSouth * max(windDirection.y, 0.0),
          oceanNorth * max(-windDirection.y, 0.0)
        )
      );
      float windSupport = smoothstep(2.0, 10.0, windSpeed);
      return windSupport * smoothstep(0.08, 0.55, onshoreFlux);
    }

    float getOceanEquilibriumTemperature(float latitude) {
      float solarFactor = clamp(cos(radians(latitude)), 0.4, 1.0);
      float temperature = 273.15 + mix(-45.0, 30.0, solarFactor) - 3.0;
      float seasonality = sin(radians(latitude)) * sin(radians(solarDeclination));
      temperature += seasonality * 12.0;
      return max(temperature * solarIrradiance / 1361.0, 271.0);
    }

    float getAnnualOceanEquilibriumTemperature(float latitude) {
      float solarFactor = clamp(cos(radians(latitude)), 0.4, 1.0);
      float temperature = 273.15 + mix(-45.0, 30.0, solarFactor) - 3.0;
      return max(temperature * solarIrradiance / 1361.0, 271.0);
    }

    float scaledFraction(float fraction) {
      return 1.0 - pow(1.0 - clamp(fraction, 0.0, 0.999999), simulationTimeStep);
    }

    float getSurfaceTemperature(vec2 uv) {
      float latitude = getLatitude(uv);
      float height = texture(heightmap, uv).r;
      float elevation = getElevation(height);
      float oceanTemperature = texture(seaSurfaceTemperature, uv).r;
      if (height < waterLevel) {
        return oceanTemperature > 100.0
          ? oceanTemperature
          : getOceanEquilibriumTemperature(latitude);
      }
      float solarFactor = max(cos(radians(latitude)), 0.0);
      float latitudeBlend = clamp(solarFactor, 0.2, 1.0);

      float temperature = 273.15 + mix(-45.0, 30.0, latitudeBlend);
      // Most of the heightmap's land range represents low terrain. Applying
      // the lapse rate nonlinearly reserves strong cooling for mountains.
      temperature -= pow(elevation, 1.7) * 70.0;

      // Land has less thermal inertia than water, creating the seasonal
      // pressure contrast that reverses monsoon flow.
      float seasonality = sin(radians(latitude)) * sin(radians(solarDeclination));
      temperature += seasonality * 50.0;
      return max(temperature * solarIrradiance / 1361.0, 1.0);
    }

    float getCustomPressureOffset(vec2 uv) {
      // The CPU-rasterized field supports an unrestricted number of editable
      // systems while retaining smooth sampling and dateline wrapping.
      return clamp(texture(pressureForcingMap, uv).r, -0.25, 0.25);
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
      float circulationLatitude = latitude - 0.50 * solarDeclination;
      float pressureBelts = -0.08 * cos(radians(circulationLatitude * 6.0));
      float thermalLow = -0.04 * seasonalAnomaly;
      float terrainHigh = 0.04 * elevation;
      float customPressure = getCustomPressureOffset(uv);
      return 1.0 + pressureBelts + thermalLow + terrainHigh + customPressure;
    }

    vec2 getGlobalWind(float latitude) {
      float shiftedLatitude = latitude - 0.50 * solarDeclination;
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
      float circulationLatitude = abs(latitude - 0.50 * solarDeclination);
      float cellLatitude = abs(latitude - 0.15 * solarDeclination);
      float cosineLatitude = max(cos(radians(latitude)), 0.15);
      float height = texture(heightmap, textureCoordinate).r;
      float elevation = getElevation(height);
      float heightLeft = texture(heightmap, textureCoordinate - vec2(texel.x, 0.0)).r;
      float heightRight = texture(heightmap, textureCoordinate + vec2(texel.x, 0.0)).r;
      float heightDown = texture(heightmap, textureCoordinate - vec2(0.0, texel.y)).r;
      float heightUp = texture(heightmap, textureCoordinate + vec2(0.0, texel.y)).r;
      vec2 terrainGradient = vec2(
        (heightRight - heightLeft) / cosineLatitude,
        heightUp - heightDown
      );
      float terrainSlope = length(terrainGradient);

      vec2 oldWind = texture(previousWind, textureCoordinate).rg;
      vec2 transportScale = vec2(1.0 / cosineLatitude, 2.0)
        * 0.00002
        * simulationTimeStep;
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
      wind = wind * pow(drag, simulationTimeStep)
        + simulationTimeStep * (pressureAcceleration + coriolisAcceleration);

      // Compact pressure systems reach a rotating, approximately geostrophic
      // flow faster than this coarse grid can resolve from Coriolis alone.
      // Relax only the contour-parallel component so surface inflow/outflow
      // from the radial pressure force remains present.
      float pressureGradientStrength = length(pressureGradient);
      vec2 counterClockwisePressureTangent = vec2(
        -pressureGradient.y,
        pressureGradient.x
      ) / max(pressureGradientStrength, 0.00001);
      float rotationMagnitude = min(sqrt(abs(rotationRatio)), 1.5);
      float hemisphereRotation = sign(rotationRatio)
        * latitude / sqrt(latitude * latitude + 64.0);
      float pressureCirculationSpeed = min(
        50.0,
        6500.0 * pressureGradientStrength * rotationMagnitude
      );
      float pressureCirculationTarget = hemisphereRotation
        * pressureCirculationSpeed;
      float currentPressureCirculation = dot(
        wind,
        counterClockwisePressureTangent
      );
      float pressureCirculationCoupling = 0.04
        * smoothstep(0.05, 0.30, rotationMagnitude)
        * smoothstep(0.0002, 0.0030, pressureGradientStrength);
      wind += scaledFraction(pressureCirculationCoupling)
        * (pressureCirculationTarget - currentPressureCirculation)
        * counterClockwisePressureTangent;

      // Large-scale circulation is a weak relaxation target, not a fixed
      // velocity. Thermal pressure gradients can still create monsoons and
      // deflect the latitude bands around continents.
      vec2 globalWind = getGlobalWind(latitude);
      float circulationCoupling = globalCirculation
        * mix(0.018, 0.008, smoothstep(waterLevel, 1.0, height));
      wind += scaledFraction(circulationCoupling) * (globalWind - wind);

      if (height >= waterLevel && terrainSlope > 0.0) {
        vec2 terrainNormal = terrainGradient / terrainSlope;
        float uphillWind = max(dot(wind, terrainNormal), 0.0);
        float mountainBlocking = smoothstep(0.01, 0.15, terrainSlope)
          * smoothstep(0.05, 0.30, elevation);
        // Strong mountain faces retain 45% of the uphill component. Pressure
        // gradients route the blocked 55% along lower surrounding terrain.
        wind -= scaledFraction(0.55 * mountainBlocking)
          * uphillWind
          * terrainNormal;
      }

      float windSpeed = length(wind);
      if (windSpeed > 70.0) wind *= 70.0 / windSpeed;

      float pressureLaplacian = pressureLeft + pressureRight
        + pressureDown + pressureUp - 4.0 * pressure;
      float equilibriumPressure = getEquilibriumPressure(textureCoordinate);
      pressure += scaledFraction(0.02) * (equilibriumPressure - pressure)
        + simulationTimeStep * (
          -0.00002 * divergence
          + 0.20 * pressureLaplacian
        );
      pressure = clamp(pressure, 0.65, 1.35);

      vec2 moistureCoordinate = textureCoordinate - wind * transportScale;
      vec4 transportedMoisture = texture(previousWaterVapor, moistureCoordinate);
      vec4 moistureLeft = texture(
        previousWaterVapor,
        moistureCoordinate - vec2(texel.x, 0.0)
      );
      vec4 moistureRight = texture(
        previousWaterVapor,
        moistureCoordinate + vec2(texel.x, 0.0)
      );
      vec4 moistureDown = texture(
        previousWaterVapor,
        moistureCoordinate - vec2(0.0, texel.y)
      );
      vec4 moistureUp = texture(
        previousWaterVapor,
        moistureCoordinate + vec2(0.0, texel.y)
      );
      vec4 neighboringMoisture = 0.25 * (
        moistureLeft + moistureRight + moistureDown + moistureUp
      );
      float waterVapor = transportedMoisture.r;
      // Small-scale atmospheric turbulence moves humidity across adjacent
      // streamlines instead of confining it to a single wind trajectory.
      waterVapor = mix(
        waterVapor,
        neighboringMoisture.r,
        0.15 * simulationTimeStep
      );
      float marineStability = mix(
        transportedMoisture.b,
        neighboringMoisture.b,
        0.20 * simulationTimeStep
      );
      float transportedPrecipitation = mix(
        transportedMoisture.g,
        neighboringMoisture.g,
        0.50 * simulationTimeStep
      );
      float marineMoisture = mix(
        transportedMoisture.a,
        neighboringMoisture.a,
        0.15 * simulationTimeStep
      );
      float temperature = getSurfaceTemperature(textureCoordinate);
      windSpeed = length(wind);
      float humidityScale = 18.0 + pow(
        1.0 - cos(radians(max(circulationLatitude - 9.0, 0.0))),
        0.4
      ) * 81.0;
      float relativeHumidity = clamp(waterVapor * humidityScale, 0.0, 1.0);

      float orographicLift = 0.0;
      float condensedWater = 0.0;
      if (height < waterLevel) {
        float rawEvaporationWindFactor = (25.0 + 19.0 * windSpeed)
          * max(windSpeed, 0.5);
        // Strong manually forced pressure systems should enhance evaporation,
        // but not with an effectively quadratic and unbounded wind response.
        float excessEvaporationWind = max(
          rawEvaporationWindFactor - 2150.0,
          0.0
        );
        float evaporationWindFactor = min(rawEvaporationWindFactor, 2150.0)
          + 3850.0 * (
            1.0 - exp(-excessEvaporationWind / 3850.0)
          );
        float saturationPressure = exp(
          77.3450 + 0.0057 * temperature - 7235.0 / temperature
        ) / pow(temperature, 8.2);
        float vaporPressure = saturationPressure * relativeHumidity;
        float atmosphericPressure = 101325.0;
        float humidityRatio = vaporPressure / (atmosphericPressure - vaporPressure);
        float saturatedHumidityRatio = saturationPressure / (
          atmosphericPressure - saturationPressure
        );
        float evaporationRate = evaporationWindFactor * (
          saturatedHumidityRatio - humidityRatio
        );
        waterVapor += simulationTimeStep
          * 0.0000015
          * evaporationRate;
        float seasonalOceanEquilibrium = getOceanEquilibriumTemperature(latitude);
        float annualOceanEquilibrium = getAnnualOceanEquilibriumTemperature(latitude);
        float inversionReference = mix(
          seasonalOceanEquilibrium,
          min(seasonalOceanEquilibrium, annualOceanEquilibrium),
          0.75
        );
        float coldSstAnomaly = max(inversionReference - temperature, 0.0);
        marineStability = mix(
          marineStability,
          clamp(coldSstAnomaly / 10.0, 0.0, 1.0),
          scaledFraction(0.12)
        );
        marineMoisture = mix(marineMoisture, 1.0, scaledFraction(0.08));
      } else {
        float upslope = max(
          dot(normalize(wind + vec2(0.0001)), normalize(terrainGradient + vec2(0.0001))),
          0.0
        ) * smoothstep(0.01, 0.15, terrainSlope);
        orographicLift = upslope;

        // Rainout is a fraction of available humidity. Low terrain therefore
        // passes most moisture inland, while windward mountain slopes can
        // still produce strong rain shadows.
        float condensation = 0.0002 + 0.0008 * elevation + 0.06 * upslope;
        float waterBeforeCondensation = waterVapor;
        float condensationFraction = clamp(condensation, 0.0, 0.15);
        waterVapor *= pow(1.0 - condensationFraction, simulationTimeStep);
        condensedWater = max(waterBeforeCondensation - waterVapor, 0.0)
          / max(simulationTimeStep, 0.000001);
        float daytimeHeating = clamp((temperature - 285.0) / 20.0, 0.0, 1.0);
        marineStability *= pow(
          mix(0.985, 0.960, daytimeHeating),
          simulationTimeStep
        );
        marineMoisture *= pow(
          mix(0.997, 0.990, daytimeHeating),
          simulationTimeStep
        );
      }

      waterVapor = max(waterVapor, 0.0001);

      // Column humidity is not rainfall. Rising equatorial and subpolar air
      // rains efficiently, while descending subtropical air can stay humid
      // without creating a wet surface climate.
      float equatorialAscent = 1.0 - smoothstep(6.0, 16.0, circulationLatitude);
      float subpolarAscent = 1.0 - smoothstep(
        8.0,
        18.0,
        abs(cellLatitude - 60.0)
      );
      float subtropicalSubsidence = 1.0 - smoothstep(
        7.0,
        18.0,
        abs(cellLatitude - 30.0)
      );
      float convergenceRain = clamp(-divergence * 0.015, 0.0, 0.4);
      if (height >= waterLevel) {
        float convergenceSupport = smoothstep(0.0, 0.015, convergenceRain);
        float dryLandLatitude = smoothstep(8.0, 16.0, abs(latitude))
          * (1.0 - smoothstep(24.0, 30.0, abs(latitude)));
        equatorialAscent *= mix(
          1.0,
          mix(0.12, 1.0, convergenceSupport),
          dryLandLatitude
        );
      }
      float seasonalLandHeating = smoothstep(
        0.02,
        0.16,
        max(sin(radians(latitude)) * sin(radians(solarDeclination)), 0.0)
      ) * step(waterLevel, height);
      float equatorwardOffset = latitude >= 0.0 ? -0.08 : 0.08;
      vec2 equatorwardCoordinate = textureCoordinate + vec2(0.0, equatorwardOffset);
      float equatorwardOcean = 0.50 * getOceanWeight(equatorwardCoordinate)
        + 0.25 * getOceanWeight(equatorwardCoordinate - vec2(0.03, 0.0))
        + 0.25 * getOceanWeight(equatorwardCoordinate + vec2(0.03, 0.0));
      float polewardOffset = latitude >= 0.0 ? 0.08 : -0.08;
      float polewardHeight = texture(
        heightmap,
        textureCoordinate + vec2(0.0, polewardOffset)
      ).r;
      float polewardMidpointHeight = texture(
        heightmap,
        textureCoordinate + vec2(0.0, 0.5 * polewardOffset)
      ).r;
      float polewardRelief = smoothstep(0.02, 0.18, polewardHeight - height);
      float polewardLandConnection = smoothstep(
        waterLevel - 0.015,
        waterLevel + 0.015,
        polewardMidpointHeight
      );
      float plateauMonsoon = smoothstep(
        0.08,
        0.14,
        polewardHeight - height
      ) * polewardLandConnection;
      float marineHumidity = relativeHumidity * marineMoisture;
      float regionalOnshoreFlow = getRegionalOnshoreFlow(
        textureCoordinate,
        wind,
        latitude
      );
      float tropicalHumidOnshoreFlow = smoothstep(0.16, 0.36, marineHumidity)
        * regionalOnshoreFlow;
      float temperateHumidOnshoreFlow = smoothstep(0.14, 0.36, marineHumidity)
        * smoothstep(24.0, 32.0, abs(latitude))
        * regionalOnshoreFlow;
      float deepMarineMonsoon = smoothstep(0.28, 0.42, marineHumidity)
        * regionalOnshoreFlow;
      float humidOnshoreFlow = max(
        tropicalHumidOnshoreFlow,
        temperateHumidOnshoreFlow
      );
      float monsoonLatitude = 1.0 - smoothstep(28.0, 44.0, abs(latitude));
      float plateauMonsoonAccess = equatorwardOcean
        * plateauMonsoon
        * regionalOnshoreFlow;
      float monsoonOceanAccess = max(
        humidOnshoreFlow,
        plateauMonsoonAccess
      );
      float reinforcedMonsoonAccess = max(
        temperateHumidOnshoreFlow,
        plateauMonsoonAccess
      );
      float monsoonAscent = seasonalLandHeating
        * monsoonLatitude
        * monsoonOceanAccess;
      float reinforcedMonsoonAscent = seasonalLandHeating
        * monsoonLatitude
        * reinforcedMonsoonAccess;
      float temperateMonsoonAscent = seasonalLandHeating
        * monsoonLatitude
        * temperateHumidOnshoreFlow
        * smoothstep(26.0, 32.0, abs(latitude));
      float deepMarineMonsoonAscent = seasonalLandHeating
        * monsoonLatitude
        * deepMarineMonsoon;
      float plateauMonsoonAscent = seasonalLandHeating
        * monsoonLatitude
        * plateauMonsoonAccess;
      float monsoonFlowSupport = 1.0 - smoothstep(0.0, 0.10, divergence);
      monsoonAscent *= mix(0.15, 1.0, monsoonFlowSupport);
      reinforcedMonsoonAscent *= mix(0.15, 1.0, monsoonFlowSupport);
      temperateMonsoonAscent *= mix(0.15, 1.0, monsoonFlowSupport);
      deepMarineMonsoonAscent *= mix(0.15, 1.0, monsoonFlowSupport);
      plateauMonsoonAscent *= mix(0.15, 1.0, monsoonFlowSupport);
      float monsoonOrography = max(orographicLift, polewardRelief);
      float rainfallEfficiency = clamp(
        0.35
          + 0.90 * equatorialAscent
          + 0.45 * subpolarAscent
          - 0.32 * subtropicalSubsidence
          + convergenceRain
          + 0.80 * orographicLift
          + 1.20 * monsoonAscent
          + 0.60 * reinforcedMonsoonAscent,
        0.03,
        1.60
      );
      float convectivePrecipitation = waterVapor * 14000.0 * rainfallEfficiency;
      if (height >= waterLevel) {
        float humiditySupport = smoothstep(0.10, 0.28, relativeHumidity);
        float dryLandLatitude = smoothstep(8.0, 16.0, abs(latitude))
          * (1.0 - smoothstep(24.0, 30.0, abs(latitude)));
        convectivePrecipitation *= mix(
          1.0,
          mix(0.10, 1.0, humiditySupport),
          dryLandLatitude
        );
      }
      float inversionStrength = marineStability / (marineStability + 0.12);
      convectivePrecipitation *= mix(1.0, 0.15, inversionStrength);
      float subtropicalInversion = inversionStrength * smoothstep(
        6.0,
        18.0,
        abs(latitude)
      );
      float terrainPrecipitation = condensedWater
        * 40000.0
        * mix(1.0, 0.10, subtropicalInversion);
      float monsoonInversionFactor = mix(1.0, 0.10, inversionStrength);
      float monsoonTerrainPrecipitation = condensedWater
        * 120000.0
        * monsoonAscent
        * monsoonOrography
        * monsoonInversionFactor;
      float marineMonsoonTerrainFactor = 0.60 + 0.40 * monsoonOrography;
      float plateauMonsoonPrecipitation = 950.0
        * plateauMonsoonAscent
        * (0.30 + 0.70 * monsoonOrography)
        * monsoonInversionFactor;
      float temperateMonsoonPrecipitation = 950.0
        * temperateMonsoonAscent
        * marineMonsoonTerrainFactor
        * monsoonInversionFactor;
      float deepMarineMonsoonPrecipitation = 900.0
        * deepMarineMonsoonAscent
        * marineMonsoonTerrainFactor
        * monsoonInversionFactor;
      // These describe overlapping interpretations of the same moist inflow,
      // so share one capped budget rather than adding three rainfall floors.
      float monsoonConvectivePrecipitation = min(
        950.0,
        max(
          plateauMonsoonPrecipitation,
          max(
            temperateMonsoonPrecipitation,
            deepMarineMonsoonPrecipitation
          )
        )
      );
      float annualPrecipitation = convectivePrecipitation
        + terrainPrecipitation
        + monsoonTerrainPrecipitation
        + monsoonConvectivePrecipitation;
      annualPrecipitation = mix(
        annualPrecipitation,
        transportedPrecipitation,
        pow(0.20, simulationTimeStep)
      );

      nextWaterVapor = vec4(
        waterVapor,
        annualPrecipitation,
        marineStability,
        marineMoisture
      );
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
        outputColor = vec4(0.04, 0.20, 0.30, 1.0);
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
    uniform sampler2D windMap;
    uniform float sampleCount;
    uniform float solarDeclination;
    uniform float waterLevel;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 nextStatsA;
    layout(location = 1) out vec4 nextStatsB;

    float getOceanWeight(vec2 uv) {
      float height = texture(heightmap, uv).r;
      return 1.0 - smoothstep(waterLevel - 0.025, waterLevel + 0.025, height);
    }

    float getRegionalOnshoreFlow(vec2 uv, vec2 wind, float latitude) {
      float cosineLatitude = max(cos(radians(latitude)), 0.15);
      float zonalOffset = 0.04 / cosineLatitude;
      float meridionalOffset = 0.08;
      float windSpeed = length(wind);
      vec2 windDirection = wind / max(windSpeed, 0.001);
      float oceanWest = getOceanWeight(uv - vec2(zonalOffset, 0.0));
      float oceanEast = getOceanWeight(uv + vec2(zonalOffset, 0.0));
      float oceanSouth = getOceanWeight(uv - vec2(0.0, meridionalOffset));
      float oceanNorth = getOceanWeight(uv + vec2(0.0, meridionalOffset));
      float onshoreFlux = max(
        max(
          oceanWest * max(windDirection.x, 0.0),
          oceanEast * max(-windDirection.x, 0.0)
        ),
        max(
          oceanSouth * max(windDirection.y, 0.0),
          oceanNorth * max(-windDirection.y, 0.0)
        )
      );
      float windSupport = smoothstep(2.0, 10.0, windSpeed);
      return windSupport * smoothstep(0.08, 0.55, onshoreFlux);
    }

    void main() {
      float temperature = texture(temperatureMap, textureCoordinate).r - 273.15;
      float waterVapor = texture(waterVaporMap, textureCoordinate).r;
      float marineMoisture = texture(waterVaporMap, textureCoordinate).a;
      float precipitation = texture(waterVaporMap, textureCoordinate).g;
      float latitude = (2.0 * textureCoordinate.y - 1.0) * 90.0;
      float circulationLatitude = abs(latitude - 0.50 * solarDeclination);
      float humidityScale = 18.0 + pow(
        1.0 - cos(radians(max(circulationLatitude - 9.0, 0.0))),
        0.4
      ) * 81.0;
      float relativeHumidity = clamp(waterVapor * humidityScale, 0.0, 1.0);
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
      float equatorwardOcean = 0.50 * getOceanWeight(equatorwardCoordinate)
        + 0.25 * getOceanWeight(equatorwardCoordinate - vec2(0.03, 0.0))
        + 0.25 * getOceanWeight(equatorwardCoordinate + vec2(0.03, 0.0));
      float polewardOffset = latitude >= 0.0 ? 0.08 : -0.08;
      float polewardHeight = texture(
        heightmap,
        textureCoordinate + vec2(0.0, polewardOffset)
      ).r;
      float polewardMidpointHeight = texture(
        heightmap,
        textureCoordinate + vec2(0.0, 0.5 * polewardOffset)
      ).r;
      float polewardRelief = smoothstep(0.02, 0.18, polewardHeight - height);
      float polewardLandConnection = smoothstep(
        waterLevel - 0.015,
        waterLevel + 0.015,
        polewardMidpointHeight
      );
      float plateauMonsoon = smoothstep(
        0.08,
        0.14,
        polewardHeight - height
      ) * polewardLandConnection;
      float marineHumidity = relativeHumidity * marineMoisture;
      vec2 wind = texture(windMap, textureCoordinate).rg;
      float regionalOnshoreFlow = getRegionalOnshoreFlow(
        textureCoordinate,
        wind,
        latitude
      );
      float tropicalHumidOnshoreFlow = smoothstep(0.16, 0.36, marineHumidity)
        * regionalOnshoreFlow;
      float temperateHumidOnshoreFlow = smoothstep(0.14, 0.36, marineHumidity)
        * smoothstep(24.0, 32.0, abs(latitude))
        * regionalOnshoreFlow;
      float humidOnshoreFlow = max(
        tropicalHumidOnshoreFlow,
        temperateHumidOnshoreFlow
      );
      float monsoonLatitude = 1.0 - smoothstep(28.0, 44.0, abs(latitude));
      float monsoonPotential = seasonalLandHeating
        * monsoonLatitude
        * max(
          equatorwardOcean * plateauMonsoon * regionalOnshoreFlow,
          humidOnshoreFlow
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

  monthlyClimateFragment: `#version 300 es
    precision highp float;

    uniform sampler2D temperatureMap;
    uniform sampler2D waterVaporMap;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 monthlyTemperature;
    layout(location = 1) out vec4 monthlyPrecipitation;

    void main() {
      float temperature = texture(temperatureMap, textureCoordinate).r - 273.15;
      float precipitation = max(
        texture(waterVaporMap, textureCoordinate).g / 12.0,
        0.0
      );
      monthlyTemperature = vec4(temperature);
      monthlyPrecipitation = vec4(precipitation);
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

    vec4 koppenColor(float red, float green, float blue) {
      return vec4(vec3(red, green, blue) / 255.0, 1.0);
    }

    void main() {
      if (texture(heightmap, textureCoordinate).r < waterLevel) {
        outputColor = vec4(0.04, 0.20, 0.30, 1.0);
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
      bool coolWinterMonsoon = coldestTemperature < 10.0
        && meanTemperature < 20.0
        && annualPrecipitationCm >= 50.0
        && wettestMonthCm >= 10.0;
      bool warmMonsoon = annualPrecipitationCm >= 80.0
        && wettestMonthCm >= 15.0;
      bool monsoonRegime = monsoonPotential > 0.30
        && warmSeasonFraction > 0.70
        && wettestMonthCm >= 3.0 * driestMonthCm
        && (coolWinterMonsoon || warmMonsoon);

      // Köppen's aridity threshold is expressed in annual millimeters.
      float seasonalAdjustment = warmSeasonFraction > 0.7
        ? 280.0
        : (warmSeasonFraction >= 0.3 ? 140.0 : 0.0);
      float aridityThreshold = max(
        20.0 * meanTemperature + seasonalAdjustment,
        0.0
      );
      float annualPrecipitationMm = annualPrecipitationCm * 10.0;

      if (warmestTemperature < 10.0) {
        outputColor = warmestTemperature < 0.0
          ? koppenColor(102.0, 102.0, 102.0) // EF
          : koppenColor(178.0, 178.0, 178.0); // ET
      } else if (annualPrecipitationMm < aridityThreshold && !monsoonRegime) {
        bool desert = annualPrecipitationMm < 0.5 * aridityThreshold;
        bool hot = meanTemperature >= 18.0;
        if (desert) {
          outputColor = hot
            ? koppenColor(255.0, 0.0, 0.0) // BWh
            : koppenColor(255.0, 150.0, 150.0); // BWk
        } else {
          outputColor = hot
            ? koppenColor(245.0, 165.0, 0.0) // BSh
            : koppenColor(255.0, 220.0, 100.0); // BSk
        }
      } else if (coldestTemperature >= 18.0) {
        float monsoonLimitCm = max(10.0 - annualPrecipitationCm / 25.0, 0.0);
        if (driestMonthCm >= 6.0) {
          outputColor = koppenColor(0.0, 0.0, 255.0); // Af
        } else if (driestMonthCm >= monsoonLimitCm) {
          outputColor = koppenColor(0.0, 120.0, 255.0); // Am
        } else {
          outputColor = koppenColor(70.0, 170.0, 250.0); // Aw/As
        }
      } else if (coldestTemperature > 0.0) {
        bool drySummer = warmSeasonFraction < 0.3;
        bool dryWinter = warmSeasonFraction > 0.7;
        int summerSubtype = warmestTemperature >= 22.0
          ? 0
          : (meanTemperature < 8.0 ? 2 : 1);

        if (drySummer) {
          if (summerSubtype == 0) outputColor = koppenColor(255.0, 255.0, 0.0); // Csa
          else if (summerSubtype == 1) outputColor = koppenColor(200.0, 200.0, 0.0); // Csb
          else outputColor = koppenColor(150.0, 150.0, 0.0); // Csc
        } else if (dryWinter) {
          if (summerSubtype == 0) outputColor = koppenColor(150.0, 255.0, 150.0); // Cwa
          else if (summerSubtype == 1) outputColor = koppenColor(100.0, 200.0, 100.0); // Cwb
          else outputColor = koppenColor(50.0, 150.0, 50.0); // Cwc
        } else {
          if (summerSubtype == 0) outputColor = koppenColor(200.0, 255.0, 80.0); // Cfa
          else if (summerSubtype == 1) outputColor = koppenColor(100.0, 255.0, 80.0); // Cfb
          else outputColor = koppenColor(50.0, 200.0, 0.0); // Cfc
        }
      } else {
        bool drySummer = warmSeasonFraction < 0.3;
        bool dryWinter = warmSeasonFraction > 0.7;
        int summerSubtype = warmestTemperature >= 22.0
          ? 0
          : (coldestTemperature <= -38.0 ? 3 : (meanTemperature < 3.0 ? 2 : 1));

        if (drySummer) {
          if (summerSubtype == 0) outputColor = koppenColor(255.0, 0.0, 255.0); // Dsa
          else if (summerSubtype == 1) outputColor = koppenColor(200.0, 0.0, 200.0); // Dsb
          else if (summerSubtype == 2) outputColor = koppenColor(150.0, 50.0, 150.0); // Dsc
          else outputColor = koppenColor(150.0, 100.0, 150.0); // Dsd
        } else if (dryWinter) {
          if (summerSubtype == 0) outputColor = koppenColor(170.0, 175.0, 255.0); // Dwa
          else if (summerSubtype == 1) outputColor = koppenColor(90.0, 120.0, 220.0); // Dwb
          else if (summerSubtype == 2) outputColor = koppenColor(75.0, 80.0, 180.0); // Dwc
          else outputColor = koppenColor(50.0, 0.0, 135.0); // Dwd
        } else {
          if (summerSubtype == 0) outputColor = koppenColor(0.0, 255.0, 255.0); // Dfa
          else if (summerSubtype == 1) outputColor = koppenColor(55.0, 200.0, 255.0); // Dfb
          else if (summerSubtype == 2) outputColor = koppenColor(0.0, 125.0, 125.0); // Dfc
          else outputColor = koppenColor(0.0, 70.0, 95.0); // Dfd
        }
      }
    }
  `,

  renderFragment: `#version 300 es
    precision mediump float;

    const float TEMPERATURE_SCALE_MIN = -80.0;
    const float TEMPERATURE_SCALE_MAX = 50.0;

    uniform sampler2D heightmap;
    uniform sampler2D waterVaporMap;
    uniform sampler2D temperatureMap;
    uniform sampler2D biomeMap;
    uniform sampler2D windMap;
    uniform sampler2D waterVaporColors;
    uniform sampler2D pressureMap;
    uniform sampler2D climateZoneMap;
    uniform sampler2D oceanCurrentMap;
    uniform sampler2D deepOceanState;
    uniform sampler2D monthlyClimate0;
    uniform sampler2D monthlyClimate1;
    uniform sampler2D monthlyClimate2;
    uniform float waterLevel;
    uniform int climatologyMonthsAvailable;
    uniform int viewMode;
    uniform bool grayscale;

    in vec2 textureCoordinate;
    layout(location = 0) out vec4 outputColor;

    void getMonthlyClimatology(
      vec2 uv,
      out vec4 januaryThroughApril,
      out vec4 mayThroughAugust,
      out vec4 septemberThroughDecember
    ) {
      januaryThroughApril = texture(monthlyClimate0, uv);
      mayThroughAugust = texture(monthlyClimate1, uv);
      septemberThroughDecember = texture(monthlyClimate2, uv);
    }

    float getAnnualPrecipitation(vec2 uv) {
      vec4 januaryThroughApril;
      vec4 mayThroughAugust;
      vec4 septemberThroughDecember;
      getMonthlyClimatology(
        uv,
        januaryThroughApril,
        mayThroughAugust,
        septemberThroughDecember
      );
      return dot(
        januaryThroughApril + mayThroughAugust + septemberThroughDecember,
        vec4(1.0)
      );
    }

    float minimumComponent(vec4 values) {
      return min(min(values.x, values.y), min(values.z, values.w));
    }

    float maximumComponent(vec4 values) {
      return max(max(values.x, values.y), max(values.z, values.w));
    }

    void getTemperatureClimatology(
      vec2 uv,
      out float annualMean,
      out float coldestMonthlyMean,
      out float warmestMonthlyMean
    ) {
      vec4 januaryThroughApril;
      vec4 mayThroughAugust;
      vec4 septemberThroughDecember;
      getMonthlyClimatology(
        uv,
        januaryThroughApril,
        mayThroughAugust,
        septemberThroughDecember
      );
      annualMean = dot(
        januaryThroughApril + mayThroughAugust + septemberThroughDecember,
        vec4(1.0)
      ) / 12.0;
      coldestMonthlyMean = min(
        minimumComponent(januaryThroughApril),
        min(
          minimumComponent(mayThroughAugust),
          minimumComponent(septemberThroughDecember)
        )
      );
      warmestMonthlyMean = max(
        maximumComponent(januaryThroughApril),
        max(
          maximumComponent(mayThroughAugust),
          maximumComponent(septemberThroughDecember)
        )
      );
    }

    float normalizeTemperature(float celsius) {
      return clamp(
        (celsius - TEMPERATURE_SCALE_MIN)
          / (TEMPERATURE_SCALE_MAX - TEMPERATURE_SCALE_MIN),
        0.0,
        1.0
      );
    }

    vec3 temperatureRgb(float red, float green, float blue) {
      return vec3(red, green, blue) / 255.0;
    }

    vec3 getTemperatureColor(float celsius) {
      vec3 violet = temperatureRgb(75.0, 44.0, 130.0);
      vec3 blue = temperatureRgb(36.0, 88.0, 166.0);
      vec3 cyanBlue = temperatureRgb(31.0, 155.0, 193.0);
      vec3 cyan = temperatureRgb(114.0, 216.0, 209.0);
      vec3 green = temperatureRgb(60.0, 166.0, 90.0);
      vec3 yellow = temperatureRgb(242.0, 211.0, 79.0);
      vec3 orange = temperatureRgb(242.0, 140.0, 40.0);
      vec3 redOrange = temperatureRgb(232.0, 77.0, 47.0);
      vec3 red = temperatureRgb(159.0, 31.0, 36.0);

      if (celsius < -50.0) {
        return mix(violet, blue, clamp((celsius + 80.0) / 30.0, 0.0, 1.0));
      }
      if (celsius < -25.0) {
        return mix(blue, cyanBlue, (celsius + 50.0) / 25.0);
      }
      if (celsius < -5.0) {
        return mix(cyanBlue, cyan, (celsius + 25.0) / 20.0);
      }
      if (celsius < 0.0) {
        return mix(cyan, green, (celsius + 5.0) / 5.0);
      }
      if (celsius < 10.0) {
        return mix(green, yellow, celsius / 10.0);
      }
      if (celsius < 25.0) {
        return mix(yellow, orange, (celsius - 10.0) / 15.0);
      }
      if (celsius < 40.0) {
        return mix(orange, redOrange, (celsius - 25.0) / 15.0);
      }
      return mix(redOrange, red, clamp((celsius - 40.0) / 10.0, 0.0, 1.0));
    }

    vec3 getPrecipitationColor(float normalizedPrecipitation) {
      float value = clamp(normalizedPrecipitation, 0.0, 1.0);
      if (value < 0.12) {
        return mix(vec3(0.42, 0.25, 0.16), vec3(0.76, 0.54, 0.24), value / 0.12);
      }
      if (value < 0.28) {
        return mix(vec3(0.76, 0.54, 0.24), vec3(0.47, 0.68, 0.33), (value - 0.12) / 0.16);
      }
      if (value < 0.55) {
        return mix(vec3(0.47, 0.68, 0.33), vec3(0.18, 0.53, 0.39), (value - 0.28) / 0.27);
      }
      if (value < 0.80) {
        return mix(vec3(0.18, 0.53, 0.39), vec3(0.14, 0.43, 0.57), (value - 0.55) / 0.25);
      }
      return mix(vec3(0.14, 0.43, 0.57), vec3(0.35, 0.27, 0.61), (value - 0.80) / 0.20);
    }

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
        float normalizedTemperature = normalizeTemperature(celsius);
        outputColor = grayscale
          ? vec4(vec3(normalizedTemperature), 1.0)
          : vec4(getTemperatureColor(celsius), 1.0);
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
      } else if (viewMode == 8) {
        float height = texture(heightmap, textureCoordinate).r;
        if (height >= waterLevel) {
          outputColor = vec4(0.10, 0.08, 0.05, 1.0);
        } else {
          vec2 current = texture(deepOceanState, textureCoordinate).rg;
          outputColor = vec4(0.5 * clamp(current * 2.5, -1.0, 1.0) + 0.5, 0.1, 1.0);
        }
      } else if (viewMode == 9) {
        float height = texture(heightmap, textureCoordinate).r;
        if (height < waterLevel) {
          outputColor = vec4(0.04, 0.20, 0.30, 1.0);
        } else {
          float precipitation = texture(waterVaporMap, textureCoordinate).g;
          float normalizedPrecipitation = precipitation / 300.0;
          outputColor = grayscale
            ? vec4(vec3(clamp(normalizedPrecipitation, 0.0, 1.0)), 1.0)
            : vec4(getPrecipitationColor(normalizedPrecipitation), 1.0);
        }
      } else if (viewMode == 10) {
        float height = texture(heightmap, textureCoordinate).r;
        if (height < waterLevel) {
          outputColor = vec4(0.04, 0.20, 0.30, 1.0);
        } else {
          float annualPrecipitation = getAnnualPrecipitation(textureCoordinate);
          float normalizedPrecipitation = annualPrecipitation / 300.0;
          outputColor = grayscale
            ? vec4(vec3(clamp(normalizedPrecipitation, 0.0, 1.0)), 1.0)
            : vec4(getPrecipitationColor(normalizedPrecipitation), 1.0);
        }
      } else if (climatologyMonthsAvailable < 12) {
        outputColor = vec4(0.15, 0.18, 0.17, 1.0);
      } else {
        float annualMean;
        float coldestMonthlyMean;
        float warmestMonthlyMean;
        getTemperatureClimatology(
          textureCoordinate,
          annualMean,
          coldestMonthlyMean,
          warmestMonthlyMean
        );
        float celsius;
        if (viewMode == 11) {
          celsius = annualMean;
        } else if (viewMode == 12) {
          celsius = coldestMonthlyMean;
        } else {
          celsius = warmestMonthlyMean;
        }
        float normalizedTemperature = normalizeTemperature(celsius);
        outputColor = grayscale
          ? vec4(vec3(normalizedTemperature), 1.0)
          : vec4(getTemperatureColor(celsius), 1.0);
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
