import {
  MAX_PRESSURE_AREA_INTENSITY,
  MIN_PRESSURE_AREA_INTENSITY,
  PRESSURE_AREA_RADIUS_DEGREES,
  PRESSURE_AREA_STRENGTH,
  PRESSURE_FIELD_HEIGHT,
  PRESSURE_FIELD_WIDTH,
  PRESSURE_MAP_FORMAT,
  PRESSURE_MAP_VERSION,
} from "./simulation-config.js";

export function serializePressureMap(pressureAreas) {
  return {
    format: PRESSURE_MAP_FORMAT,
    version: PRESSURE_MAP_VERSION,
    pressureAreas: pressureAreas.map((area) => ({
      type: area.type,
      latitude: Number((90 - area.verticalPosition * 180).toFixed(6)),
      longitude: Number((area.horizontalPosition * 360 - 180).toFixed(6)),
      intensity: area.intensity,
    })),
  };
}

export function deserializePressureMap(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The pressure map must be a JSON object.");
  }
  if (data.format !== PRESSURE_MAP_FORMAT) {
    throw new Error("This is not a Climate Simulator pressure map.");
  }
  if (data.version !== PRESSURE_MAP_VERSION) {
    throw new Error(`Unsupported pressure map version: ${String(data.version)}.`);
  }
  if (!Array.isArray(data.pressureAreas)) {
    throw new Error("The pressure map must contain a pressureAreas array.");
  }

  return data.pressureAreas.map((sourceArea, index) => {
    const areaNumber = index + 1;
    if (!sourceArea || typeof sourceArea !== "object" || Array.isArray(sourceArea)) {
      throw new Error(`Pressure area ${areaNumber} must be an object.`);
    }
    if (sourceArea.type !== "high" && sourceArea.type !== "low") {
      throw new Error(`Pressure area ${areaNumber} type must be "high" or "low".`);
    }

    const { latitude, longitude, intensity } = sourceArea;
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error(`Pressure area ${areaNumber} latitude must be between -90 and 90.`);
    }
    if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(`Pressure area ${areaNumber} longitude must be between -180 and 180.`);
    }
    if (
      typeof intensity !== "number"
      || !Number.isFinite(intensity)
      || intensity < MIN_PRESSURE_AREA_INTENSITY
      || intensity > MAX_PRESSURE_AREA_INTENSITY
    ) {
      throw new Error(
        `Pressure area ${areaNumber} intensity must be between ${MIN_PRESSURE_AREA_INTENSITY} and ${MAX_PRESSURE_AREA_INTENSITY}.`,
      );
    }

    return {
      id: areaNumber,
      type: sourceArea.type,
      horizontalPosition: (longitude + 180) / 360,
      verticalPosition: (90 - latitude) / 180,
      intensity,
    };
  });
}

export function rasterizePressureAreas(pressureAreas, target = null) {
  const values = target ?? new Float32Array(PRESSURE_FIELD_WIDTH * PRESSURE_FIELD_HEIGHT);
  values.fill(0);

  for (const area of pressureAreas) {
    const centerLatitude = 90 - area.verticalPosition * 180;
    const centerTextureY = 1 - area.verticalPosition;
    const radiusY = PRESSURE_AREA_RADIUS_DEGREES / 180;
    const minimumY = Math.max(
      0,
      Math.floor((centerTextureY - radiusY) * PRESSURE_FIELD_HEIGHT),
    );
    const maximumY = Math.min(
      PRESSURE_FIELD_HEIGHT - 1,
      Math.ceil((centerTextureY + radiusY) * PRESSURE_FIELD_HEIGHT),
    );
    const signedStrength = (area.type === "high" ? 1 : -1)
      * PRESSURE_AREA_STRENGTH
      * area.intensity;

    for (let y = minimumY; y <= maximumY; y += 1) {
      const textureY = (y + 0.5) / PRESSURE_FIELD_HEIGHT;
      const latitude = (2 * textureY - 1) * 90;
      const latitudeDistance = Math.abs(latitude - centerLatitude);
      if (latitudeDistance >= PRESSURE_AREA_RADIUS_DEGREES) continue;

      const meanLatitude = 0.5 * (latitude + centerLatitude);
      const longitudeScale = Math.max(Math.cos(meanLatitude * Math.PI / 180), 0.15);
      const maximumLongitudeDegrees = Math.sqrt(
        PRESSURE_AREA_RADIUS_DEGREES ** 2 - latitudeDistance ** 2,
      );
      const radiusX = maximumLongitudeDegrees / (360 * longitudeScale);
      const centerX = area.horizontalPosition * PRESSURE_FIELD_WIDTH - 0.5;
      const minimumX = Math.floor(centerX - radiusX * PRESSURE_FIELD_WIDTH);
      const maximumX = Math.ceil(centerX + radiusX * PRESSURE_FIELD_WIDTH);

      for (let rawX = minimumX; rawX <= maximumX; rawX += 1) {
        const x = ((rawX % PRESSURE_FIELD_WIDTH) + PRESSURE_FIELD_WIDTH)
          % PRESSURE_FIELD_WIDTH;
        const textureX = (x + 0.5) / PRESSURE_FIELD_WIDTH;
        let longitudeDistance = Math.abs(textureX - area.horizontalPosition);
        longitudeDistance = Math.min(longitudeDistance, 1 - longitudeDistance);
        const longitudeDegrees = longitudeDistance * 360 * longitudeScale;
        const distanceDegrees = Math.hypot(longitudeDegrees, latitudeDistance);
        if (distanceDegrees >= PRESSURE_AREA_RADIUS_DEGREES) continue;

        const smoothstepPosition = Math.min(1, Math.max(
          0,
          (distanceDegrees - 0.45 * PRESSURE_AREA_RADIUS_DEGREES)
            / (0.55 * PRESSURE_AREA_RADIUS_DEGREES),
        ));
        const smoothstepValue = smoothstepPosition
          * smoothstepPosition
          * (3 - 2 * smoothstepPosition);
        const influence = 1 - smoothstepValue;
        values[y * PRESSURE_FIELD_WIDTH + x] += signedStrength * influence * influence;
      }
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.min(0.25, Math.max(-0.25, values[index]));
  }
  return values;
}
