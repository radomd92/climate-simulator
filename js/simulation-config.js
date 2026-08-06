export const ASSETS = {
  earthHeightmap: "assets/earth-heightmap.png",
  cassiniHeightmap: "assets/earth-cassini-heightmap.png",
  biomeMap: "assets/biome-map.png",
  softBiomeMap: "assets/biome-map-soft.png",
  waterVaporGradient: "assets/water-vapor-gradient.png",
};

export const VIEW_NAMES = [
  "heightmap",
  "water-vapor",
  "temperature",
  "biomes",
  "wind",
  "pressure",
  "climate-zones",
  "ocean-currents",
  "deep-ocean-currents",
  "precipitation",
  "annual-precipitation",
  "annual-mean-temperature",
  "coldest-month-temperature",
  "warmest-month-temperature",
  "ice-caps",
  "permafrost",
  "annual-mean-sea-surface-temperature",
];
export const PRESSURE_AREA_STRENGTH = 0.16;
export const PRESSURE_AREA_RADIUS_DEGREES = 24;
export const PRESSURE_FIELD_WIDTH = 512;
export const PRESSURE_FIELD_HEIGHT = 256;
export const MIN_PRESSURE_AREA_INTENSITY = 0.1;
export const MAX_PRESSURE_AREA_INTENSITY = 3;
export const PRESSURE_MAP_FORMAT = "climate-simulator-pressure-map";
export const PRESSURE_MAP_VERSION = 1;
export const DEFAULT_WIDTH = 1366;
export const DEFAULT_HEIGHT = 683;
export const WARMUP_PASS_COUNT = 600;
export const WARMUP_BATCH_SIZE = 24;
export const STEADY_BATCH_SIZE = 1;
export const AUTO_SEASON_BATCH_SIZE = 16;
export const UPDATE_INTERVAL_MS = 50;
export const REFERENCE_SEASON_PASSES_PER_YEAR = 480;
export const MIN_SEASONAL_SIMULATION_TIME_STEP = 0.25;
export const SEASON_PASSES_PER_YEAR = [480, 960, 1920, 3200, 6400, 9600, 19200];
