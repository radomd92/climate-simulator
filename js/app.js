import { shaders } from "./shaders.js";

const ASSETS = {
  earthHeightmap: "assets/earth-heightmap.png",
  cassiniHeightmap: "assets/earth-cassini-heightmap.png",
  biomeMap: "assets/biome-map.png",
  softBiomeMap: "assets/biome-map-soft.png",
  waterVaporGradient: "assets/water-vapor-gradient.png",
  temperatureGradient: "assets/temperature-gradient.png",
};

const VIEW_NAMES = [
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
];
const DEFAULT_WIDTH = 1366;
const DEFAULT_HEIGHT = 683;
const WARMUP_PASS_COUNT = 600;
const WARMUP_BATCH_SIZE = 24;
const STEADY_BATCH_SIZE = 1;
const AUTO_SEASON_BATCH_SIZE = 16;
const UPDATE_INTERVAL_MS = 50;
const SEASON_PERIODS = ["Mar-May", "Jun-Aug", "Sep-Nov", "Dec-Feb"];
const NORTHERN_SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
const SOUTHERN_SEASONS = ["Autumn", "Winter", "Spring", "Summer"];

class ShaderProgram {
  constructor(gl, vertexSource, fragmentSource, name) {
    this.gl = gl;
    this.program = gl.createProgram();

    const vertexShader = this.compile(gl.VERTEX_SHADER, vertexSource, `${name} vertex`);
    const fragmentShader = this.compile(gl.FRAGMENT_SHADER, fragmentSource, `${name} fragment`);

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`${name} program failed to link:\n${gl.getProgramInfoLog(this.program)}`);
    }

    this.uniforms = new Map();
    const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < uniformCount; index += 1) {
      const uniform = gl.getActiveUniform(this.program, index);
      this.uniforms.set(uniform.name, gl.getUniformLocation(this.program, uniform.name));
    }
  }

  compile(type, source, name) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`${name} shader failed to compile:\n${message}`);
    }

    return shader;
  }

  use() {
    this.gl.useProgram(this.program);
  }

  setInteger(name, value) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform1i(location, value);
    }
  }

  setFloat(name, value) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform1f(location, value);
    }
  }

  setVector2(name, [x, y]) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform2f(location, x, y);
    }
  }

  setVector4(name, [x, y, z, w]) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform4f(location, x, y, z, w);
    }
  }

  setTexture(name, unit, texture) {
    texture.bind(unit);
    this.setInteger(name, unit);
  }
}

class Mesh {
  constructor(gl, vertices, primitive) {
    this.gl = gl;
    this.primitive = primitive;
    this.vertexCount = vertices.length / 3;
    this.vertexArray = gl.createVertexArray();
    this.buffer = gl.createBuffer();

    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw() {
    this.gl.bindVertexArray(this.vertexArray);
    this.gl.drawArrays(this.primitive, 0, this.vertexCount);
  }
}

class Texture2D {
  constructor(gl) {
    this.gl = gl;
    this.texture = gl.createTexture();
  }

  static load(gl, path, options = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => {
        const texture = new Texture2D(gl);
        texture.bind();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
        texture.setSampling(options);
        resolve(texture);
      });
      image.addEventListener("error", () => reject(new Error(`Unable to load image: ${path}`)));
      image.src = path;
    });
  }

  static allocate(gl, width, height, internalFormat, format, type) {
    const texture = new Texture2D(gl);
    texture.bind();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      format,
      type,
      null,
    );
    texture.setSampling();
    return texture;
  }

  bind(unit = null) {
    if (unit !== null) {
      this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
  }

  setSampling({ linear = false, repeatX = false } = {}) {
    this.bind();
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  destroy() {
    this.gl.deleteTexture(this.texture);
  }
}

class Framebuffer {
  constructor(gl) {
    this.gl = gl;
    this.framebuffer = gl.createFramebuffer();
  }

  attachColor(texture, index) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0 + index,
      this.gl.TEXTURE_2D,
      texture.texture,
      0,
    );
  }

  validate(name) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`${name} framebuffer is incomplete (WebGL status ${status}).`);
    }
  }

  use(colorAttachments) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.drawBuffers(colorAttachments.map((index) => this.gl.COLOR_ATTACHMENT0 + index));
  }
}

export class ClimateSimulator {
  constructor(documentRoot) {
    this.document = documentRoot;
    this.canvas = documentRoot.querySelector("#climate-canvas");
    this.status = documentRoot.querySelector("#loading-status");
    this.errorOutput = documentRoot.querySelector("#error-output");
    this.progress = documentRoot.querySelector("#simulation-progress");
    this.progressLabel = documentRoot.querySelector("#simulation-progress-label");
    this.controls = {
      heightmap: documentRoot.querySelector("#heightmap"),
      waterLevel: documentRoot.querySelector("#water-level"),
      rotationSpeed: documentRoot.querySelector("#rotation-speed"),
      rotationUnit: documentRoot.querySelector("#rotation-unit"),
      globalCirculation: documentRoot.querySelector("#global-circulation"),
      oceanCirculation: documentRoot.querySelector("#ocean-circulation"),
      deepOceanCirculation: documentRoot.querySelector("#deep-ocean-circulation"),
      insolation: documentRoot.querySelector("#insolation"),
      insolationUnit: documentRoot.querySelector("#insolation-unit"),
      solarDeclination: documentRoot.querySelector("#solar-declination"),
      autoSeasons: documentRoot.querySelector("#auto-seasons"),
      seasonSpeed: documentRoot.querySelector("#season-speed"),
      windArrows: documentRoot.querySelector("#show-wind-arrows"),
      mainGrid: documentRoot.querySelector("#show-main-grid"),
      subGrid: documentRoot.querySelector("#show-sub-grid"),
      grayscale: documentRoot.querySelector("#show-grayscale"),
      softenBiomes: documentRoot.querySelector("#soften-biomes"),
    };
    this.legends = [
      null,
      documentRoot.querySelector("#water-vapor-legend"),
      documentRoot.querySelector("#temperature-legend"),
      documentRoot.querySelector("#biome-legend"),
      null,
      null,
      documentRoot.querySelector("#climate-zone-legend"),
      null,
      null,
      documentRoot.querySelector("#precipitation-legend"),
    ];
    this.seasonPosition = documentRoot.querySelector("#season-position");
    this.climateZoneStatus = documentRoot.querySelector("#climate-zone-status");
    this.pointClimate = {
      marker: documentRoot.querySelector("#map-selection-marker"),
      clearButton: documentRoot.querySelector("#clear-map-selection"),
      empty: documentRoot.querySelector("#map-interaction-hint"),
      data: documentRoot.querySelector("#point-climate-data"),
      coordinates: documentRoot.querySelector("#point-climate-coordinates"),
      summary: documentRoot.querySelector("#point-climate-summary"),
      status: documentRoot.querySelector("#point-climate-status"),
      temperatureChart: documentRoot.querySelector("#point-temperature-chart"),
      precipitationChart: documentRoot.querySelector("#point-precipitation-chart"),
      values: documentRoot.querySelector("#point-climate-values"),
    };

    this.viewMode = 3;
    this.pingPongIndex = 0;
    this.climateStatsIndex = 0;
    this.climateSampleCount = 0;
    this.seasonalSampleCounts = [0, 0, 0, 0];
    this.seasonPasses = 0;
    this.automaticDeclination = 0;
    this.completedClimateYears = 0;
    this.ready = false;
    this.completedPasses = 0;
    this.uploadedHeightmap = null;
    this.selectedPoint = null;
    this.pointReadFramebuffer = null;
    this.rotationUnitFactor = Number(this.controls.rotationUnit.value);
    this.insolationUnitFactor = Number(this.controls.insolationUnit.value);

    this.configureCanvasSize();
    this.bindControls();
    this.updateSeasonControls();
  }

  configureCanvasSize() {
    const parameters = new URLSearchParams(window.location.search);
    const width = Number.parseInt(parameters.get("width"), 10);
    const height = Number.parseInt(parameters.get("height"), 10);
    this.canvas.width = Number.isInteger(width) && width > 0 ? width : DEFAULT_WIDTH;
    this.canvas.height = Number.isInteger(height) && height > 0 ? height : DEFAULT_HEIGHT;
    this.canvas.style.aspectRatio = `${this.canvas.width} / ${this.canvas.height}`;
  }

  bindControls() {
    this.controls.heightmap.addEventListener("change", () => this.loadUploadedHeightmap());

    [
      this.controls.waterLevel,
      this.controls.rotationSpeed,
      this.controls.globalCirculation,
      this.controls.oceanCirculation,
      this.controls.deepOceanCirculation,
      this.controls.insolation,
      this.controls.solarDeclination,
    ].forEach((input) => input.addEventListener("input", () => this.markSimulationUnsettled()));

    this.controls.autoSeasons.addEventListener("change", () => {
      this.updateSeasonControls();
      this.markSimulationUnsettled();
      this.updateSelectedPointClimate();
    });
    this.controls.seasonSpeed.addEventListener("change", () => {
      this.markSimulationUnsettled();
    });

    this.controls.rotationUnit.addEventListener("change", () => {
      this.rotationUnitFactor = this.convertDisplayedUnit(
        this.controls.rotationSpeed,
        this.rotationUnitFactor,
        Number(this.controls.rotationUnit.value),
      );
    });
    this.controls.insolationUnit.addEventListener("change", () => {
      this.insolationUnitFactor = this.convertDisplayedUnit(
        this.controls.insolation,
        this.insolationUnitFactor,
        Number(this.controls.insolationUnit.value),
      );
    });

    this.document.querySelectorAll('input[name="view-mode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) this.setViewMode(Number(radio.value));
      });
    });

    [
      this.controls.windArrows,
      this.controls.mainGrid,
      this.controls.subGrid,
      this.controls.grayscale,
      this.controls.softenBiomes,
    ].forEach((checkbox) => checkbox.addEventListener("change", () => this.render()));

    this.document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => this.applyPreset(button.dataset.preset));
    });
    this.document.querySelector("#download-map").addEventListener("click", () => {
      this.downloadCurrentMap();
    });
    this.canvas.addEventListener("click", (event) => this.selectMapPointFromEvent(event));
    this.canvas.addEventListener("keydown", (event) => this.handleMapSelectionKey(event));
    this.pointClimate.clearButton.addEventListener("click", () => this.clearMapSelection());
  }

  convertDisplayedUnit(input, oldFactor, newFactor) {
    const physicalValue = this.readNumber(input, 0) * oldFactor;
    input.value = this.formatNumber(physicalValue / newFactor);
    return newFactor;
  }

  async initialize() {
    try {
      const options = { alpha: false, preserveDrawingBuffer: true };
      this.gl = this.canvas.getContext("webgl2", options);
      if (!this.gl) {
        throw new Error("This simulator requires a browser with WebGL 2 support.");
      }
      if (!this.gl.getExtension("EXT_color_buffer_float")) {
        throw new Error("This device does not support floating-point WebGL render targets.");
      }
      if (!this.gl.getExtension("OES_texture_float_linear")) {
        throw new Error("This device does not support filtered floating-point WebGL textures.");
      }

      const maximumSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
      if (this.canvas.width > maximumSize || this.canvas.height > maximumSize) {
        throw new Error(`Requested resolution exceeds this device's ${maximumSize}px texture limit.`);
      }

      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

      this.createPrograms();
      this.createGeometry();
      await this.loadAssets();
      this.createSimulationTargets();
      this.pointReadFramebuffer = this.gl.createFramebuffer();
      this.clearSimulation();

      this.ready = true;
      this.step();
      this.status.hidden = true;
      this.timer = window.setInterval(() => this.step(), UPDATE_INTERVAL_MS);
    } catch (error) {
      this.reportError(error);
      this.status.textContent = "Simulation unavailable";
    }
  }

  createPrograms() {
    const gl = this.gl;
    this.programs = {
      ocean: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.oceanFragment,
        "ocean circulation",
      ),
      deepOcean: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.deepOceanFragment,
        "deep ocean circulation",
      ),
      advection: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.advectionFragment,
        "advection",
      ),
      biome: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.biomeFragment,
        "biome",
      ),
      climateStats: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.climateStatsFragment,
        "climate statistics",
      ),
      climateZone: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.climateZoneFragment,
        "climate zone",
      ),
      render: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.renderFragment,
        "render",
      ),
      line: new ShaderProgram(gl, shaders.lineVertex, shaders.solidFragment, "grid line"),
      wind: new ShaderProgram(gl, shaders.windVertex, shaders.solidFragment, "wind arrow"),
    };
  }

  createGeometry() {
    const gl = this.gl;
    this.meshes = {
      fullscreen: new Mesh(gl, [
        -1, -1, 0,
         1, -1, 0,
         1,  1, 0,
        -1, -1, 0,
         1,  1, 0,
        -1,  1, 0,
      ], gl.TRIANGLES),
      horizontalLine: new Mesh(gl, [-1, 0, 0, 1, 0, 0], gl.LINES),
      verticalLine: new Mesh(gl, [0, -1, 0, 0, 1, 0], gl.LINES),
      windArrows: new Mesh(gl, this.createWindArrowVertices(), gl.LINES),
    };
  }

  createWindArrowVertices() {
    const vertices = [];
    for (let latitude = -85; latitude < 90; latitude += 5) {
      for (let longitude = -175; longitude < 180; longitude += 5) {
        const x = this.longitudeToClipSpace(longitude);
        const y = this.latitudeToClipSpace(latitude);
        for (let point = 0; point < 6; point += 1) {
          vertices.push(x, y, point);
        }
      }
    }
    return vertices;
  }

  async loadAssets() {
    const linear = { linear: true };
    const wrapping = { linear: true, repeatX: true };
    const [earth, cassini, biome, softBiome, waterColors, temperatureColors] = await Promise.all([
      Texture2D.load(this.gl, ASSETS.earthHeightmap, wrapping),
      Texture2D.load(this.gl, ASSETS.cassiniHeightmap, wrapping),
      Texture2D.load(this.gl, ASSETS.biomeMap, linear),
      Texture2D.load(this.gl, ASSETS.softBiomeMap, linear),
      Texture2D.load(this.gl, ASSETS.waterVaporGradient, linear),
      Texture2D.load(this.gl, ASSETS.temperatureGradient, linear),
    ]);

    this.textures = {
      earth,
      cassini,
      heightmap: earth,
      biomeLookups: [biome, softBiome],
      waterColors,
      temperatureColors,
    };
  }

  createSimulationTargets() {
    const gl = this.gl;
    const { width, height } = this.canvas;
    const linearWrapping = { linear: true, repeatX: true };

    const waterVapor = [
      Texture2D.allocate(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    const wind = [
      Texture2D.allocate(gl, width, height, gl.RG32F, gl.RG, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.RG32F, gl.RG, gl.FLOAT),
    ];
    const pressure = [
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
    ];
    const oceanCurrent = [
      Texture2D.allocate(gl, width, height, gl.RG32F, gl.RG, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.RG32F, gl.RG, gl.FLOAT),
    ];
    const seaSurfaceTemperature = [
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
    ];
    const salinity = [
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
    ];
    const deepOceanState = [
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    ];
    const overturning = [
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
      Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT),
    ];
    const temperature = Texture2D.allocate(gl, width, height, gl.R32F, gl.RED, gl.FLOAT);
    const biomes = Texture2D.allocate(gl, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    const climateStatsA = [
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    ];
    const climateStatsB = [
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    ];
    const seasonalTemperature = [
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    ];
    const seasonalPrecipitation = [
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    ];
    const climateZones = Texture2D.allocate(
      gl,
      width,
      height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
    );

    [
      ...waterVapor,
      ...wind,
      ...pressure,
      ...oceanCurrent,
      ...seaSurfaceTemperature,
      ...salinity,
      ...deepOceanState,
      ...overturning,
      temperature,
    ].forEach((texture) => {
      texture.setSampling(linearWrapping);
    });
    biomes.setSampling(linearWrapping);
    [
      ...climateStatsA,
      ...climateStatsB,
      ...seasonalTemperature,
      ...seasonalPrecipitation,
      climateZones,
    ].forEach((texture) => {
      texture.setSampling({ repeatX: true });
    });

    const advection = [new Framebuffer(gl), new Framebuffer(gl)];
    advection.forEach((framebuffer, index) => {
      framebuffer.attachColor(waterVapor[index], 0);
      framebuffer.attachColor(wind[index], 1);
      framebuffer.attachColor(temperature, 2);
      framebuffer.attachColor(pressure[index], 3);
      framebuffer.validate(`Advection ${index}`);
    });

    const biome = new Framebuffer(gl);
    biome.attachColor(biomes, 0);
    biome.validate("Biome");

    const ocean = [new Framebuffer(gl), new Framebuffer(gl)];
    ocean.forEach((framebuffer, index) => {
      framebuffer.attachColor(oceanCurrent[index], 0);
      framebuffer.attachColor(seaSurfaceTemperature[index], 1);
      framebuffer.attachColor(salinity[index], 2);
      framebuffer.validate(`Ocean circulation ${index}`);
    });

    const deepOcean = [new Framebuffer(gl), new Framebuffer(gl)];
    deepOcean.forEach((framebuffer, index) => {
      framebuffer.attachColor(deepOceanState[index], 0);
      framebuffer.attachColor(overturning[index], 1);
      framebuffer.validate(`Deep ocean circulation ${index}`);
    });

    const climateStats = [new Framebuffer(gl), new Framebuffer(gl)];
    climateStats.forEach((framebuffer, index) => {
      framebuffer.attachColor(climateStatsA[index], 0);
      framebuffer.attachColor(climateStatsB[index], 1);
      framebuffer.attachColor(seasonalTemperature[index], 2);
      framebuffer.attachColor(seasonalPrecipitation[index], 3);
      framebuffer.validate(`Climate statistics ${index}`);
    });

    const climateZone = new Framebuffer(gl);
    climateZone.attachColor(climateZones, 0);
    climateZone.validate("Climate zone");

    this.simulation = {
      waterVapor,
      wind,
      pressure,
      oceanCurrent,
      seaSurfaceTemperature,
      salinity,
      deepOceanState,
      overturning,
      temperature,
      biomes,
      climateStatsA,
      climateStatsB,
      seasonalTemperature,
      seasonalPrecipitation,
      climateZones,
      advectionFramebuffers: advection,
      biomeFramebuffer: biome,
      oceanFramebuffers: ocean,
      deepOceanFramebuffers: deepOcean,
      climateStatsFramebuffers: climateStats,
      climateZoneFramebuffer: climateZone,
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  clearSimulation() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    this.simulation.advectionFramebuffers.forEach((framebuffer) => {
      framebuffer.use([0, 1, 2, 3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clearBufferfv(gl.COLOR, 3, new Float32Array([1, 0, 0, 0]));
    });
    this.simulation.oceanFramebuffers.forEach((framebuffer) => {
      framebuffer.use([0, 1, 2]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    this.simulation.deepOceanFramebuffers.forEach((framebuffer) => {
      framebuffer.use([0, 1]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    this.simulation.biomeFramebuffer.use([0]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pingPongIndex = 0;
    this.markSimulationUnsettled();
  }

  step() {
    if (!this.ready) return;

    const wasWarmingUp = this.completedPasses < WARMUP_PASS_COUNT;
    const remainingWarmupPasses = WARMUP_PASS_COUNT - this.completedPasses;
    const passCount = remainingWarmupPasses > 0
      ? Math.min(WARMUP_BATCH_SIZE, remainingWarmupPasses)
      : (this.controls.autoSeasons.checked ? AUTO_SEASON_BATCH_SIZE : STEADY_BATCH_SIZE);

    let completedSeason = false;
    for (let pass = 0; pass < passCount; pass += 1) {
      if (this.controls.autoSeasons.checked && !wasWarmingUp) {
        completedSeason ||= this.advanceSeason();
      }
      this.simulate();
    }
    this.completedPasses += passCount;

    if (wasWarmingUp && this.completedPasses >= WARMUP_PASS_COUNT) {
      this.resetSeasonCycle();
      this.clearClimateStatistics();
    } else if (this.controls.autoSeasons.checked && !wasWarmingUp) {
      this.updateClimateStatistics();
      if (completedSeason) {
        this.classifyClimateZones();
        this.completedClimateYears += 1;
        this.climateZoneStatus.textContent = `Classified from climate year ${this.completedClimateYears}`;
        this.clearClimateStatistics({ preserveSeasonalPatterns: true });
      }
    }

    this.updateSimulationProgress();
    this.updateSeasonControls();
    this.render();
  }

  markSimulationUnsettled() {
    this.completedPasses = 0;
    this.resetSeasonalClimate();
    this.updateSimulationProgress();
  }

  updateSimulationProgress() {
    const settledPasses = Math.min(this.completedPasses, WARMUP_PASS_COUNT);
    this.progress.value = settledPasses;
    this.progress.textContent = `${Math.round(settledPasses / WARMUP_PASS_COUNT * 100)}%`;
    this.progressLabel.textContent = settledPasses >= WARMUP_PASS_COUNT
      ? "Climate settled"
      : "Settling climate";
  }

  getSeasonPassesPerYear() {
    return this.readNumber(this.controls.seasonSpeed, 480);
  }

  advanceSeason() {
    const passesPerYear = this.getSeasonPassesPerYear();
    this.seasonPasses = (this.seasonPasses + 1) % passesPerYear;
    const phase = this.seasonPasses / passesPerYear;
    this.automaticDeclination = 23.5 * Math.sin(phase * Math.PI * 2);
    return this.seasonPasses === 0;
  }

  resetSeasonCycle() {
    this.seasonPasses = 0;
    this.automaticDeclination = 0;
    this.updateSeasonControls();
  }

  updateSeasonControls() {
    const automatic = this.controls.autoSeasons.checked;
    this.controls.solarDeclination.disabled = automatic;
    this.controls.seasonSpeed.disabled = !automatic;

    if (!automatic) {
      const declination = this.readNumber(this.controls.solarDeclination, 0);
      this.seasonPosition.textContent = `Manual season · ${declination.toFixed(1)}°`;
      return;
    }

    this.controls.solarDeclination.value = this.automaticDeclination.toFixed(1);
    const phase = this.seasonPasses / this.getSeasonPassesPerYear();
    let season;
    if (phase === 0) season = "March equinox";
    else if (phase < 0.25) season = "Northern spring";
    else if (phase === 0.25) season = "June solstice";
    else if (phase < 0.5) season = "Northern summer";
    else if (phase === 0.5) season = "September equinox";
    else if (phase < 0.75) season = "Northern autumn";
    else if (phase === 0.75) season = "December solstice";
    else season = "Northern winter";
    this.seasonPosition.textContent = `${season} · year ${this.completedClimateYears + 1}`;
  }

  resetSeasonalClimate() {
    this.completedClimateYears = 0;
    this.resetSeasonCycle();
    if (!this.simulation?.climateStatsFramebuffers) return;

    this.clearClimateStatistics();
    const gl = this.gl;
    this.simulation.climateZoneFramebuffer.use([0]);
    gl.clearColor(0.15, 0.18, 0.17, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.climateZoneStatus.textContent = this.controls.autoSeasons.checked
      ? "Collecting the first climate year…"
      : "Enable automatic seasons to classify a climate year";
  }

  clearClimateStatistics({ preserveSeasonalPatterns = false } = {}) {
    const gl = this.gl;
    this.simulation.climateStatsFramebuffers.forEach((framebuffer) => {
      framebuffer.use(preserveSeasonalPatterns ? [0, 1] : [0, 1, 2, 3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.climateStatsIndex = 0;
    this.climateSampleCount = 0;
    if (!preserveSeasonalPatterns) this.seasonalSampleCounts.fill(0);
    this.updateSelectedPointClimate();
  }

  updateClimateStatistics() {
    const sourceIndex = this.climateStatsIndex;
    const targetIndex = 1 - sourceIndex;
    const seasonIndex = this.getClimateSeasonIndex();
    this.simulation.climateStatsFramebuffers[targetIndex].use([0, 1, 2, 3]);

    const stats = this.programs.climateStats;
    stats.use();
    stats.setTexture("temperatureMap", 0, this.simulation.temperature);
    stats.setTexture("waterVaporMap", 1, this.simulation.waterVapor[1 - this.pingPongIndex]);
    stats.setTexture("previousStatsA", 2, this.simulation.climateStatsA[sourceIndex]);
    stats.setTexture("previousStatsB", 3, this.simulation.climateStatsB[sourceIndex]);
    stats.setTexture("heightmap", 4, this.textures.heightmap);
    stats.setTexture(
      "previousSeasonalTemperature",
      5,
      this.simulation.seasonalTemperature[sourceIndex],
    );
    stats.setTexture(
      "previousSeasonalPrecipitation",
      6,
      this.simulation.seasonalPrecipitation[sourceIndex],
    );
    stats.setFloat("sampleCount", this.climateSampleCount);
    stats.setFloat("seasonSampleCount", this.seasonalSampleCounts[seasonIndex]);
    stats.setInteger("seasonIndex", seasonIndex);
    stats.setFloat("solarDeclination", this.getSolarDeclination());
    stats.setFloat("waterLevel", this.getWaterLevel());
    this.meshes.fullscreen.draw();

    this.climateStatsIndex = targetIndex;
    this.climateSampleCount += 1;
    this.seasonalSampleCounts[seasonIndex] += 1;
    this.updateSelectedPointClimate();
  }

  getClimateSeasonIndex() {
    const phase = this.seasonPasses / this.getSeasonPassesPerYear();
    return Math.min(3, Math.floor(phase * 4));
  }

  selectMapPointFromEvent(event) {
    if (!this.ready) return;

    const bounds = this.canvas.getBoundingClientRect();
    const horizontalPosition = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    const verticalPosition = Math.min(
      1,
      Math.max(0, (event.clientY - bounds.top) / bounds.height),
    );
    this.selectMapPoint(horizontalPosition, verticalPosition);
  }

  selectMapPoint(horizontalPosition, verticalPosition) {
    horizontalPosition = Math.min(1, Math.max(0, horizontalPosition));
    verticalPosition = Math.min(1, Math.max(0, verticalPosition));
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.selectedPoint = {
      x: Math.min(width - 1, Math.floor(horizontalPosition * width)),
      y: Math.min(height - 1, Math.floor((1 - verticalPosition) * height)),
      longitude: horizontalPosition * 360 - 180,
      latitude: 90 - verticalPosition * 180,
      horizontalPosition,
      verticalPosition,
    };

    this.pointClimate.marker.style.left = `${horizontalPosition * 100}%`;
    this.pointClimate.marker.style.top = `${verticalPosition * 100}%`;
    this.pointClimate.marker.hidden = false;
    this.pointClimate.clearButton.hidden = false;
    this.pointClimate.empty.hidden = true;
    this.pointClimate.data.hidden = false;
    this.updateSelectedPointClimate();
  }

  handleMapSelectionKey(event) {
    const movement = event.shiftKey ? 0.05 : 0.01;
    const horizontalPosition = this.selectedPoint?.horizontalPosition ?? 0.5;
    const verticalPosition = this.selectedPoint?.verticalPosition ?? 0.5;
    let nextHorizontalPosition = horizontalPosition;
    let nextVerticalPosition = verticalPosition;

    if (event.key === "ArrowLeft") nextHorizontalPosition -= movement;
    else if (event.key === "ArrowRight") nextHorizontalPosition += movement;
    else if (event.key === "ArrowUp") nextVerticalPosition -= movement;
    else if (event.key === "ArrowDown") nextVerticalPosition += movement;
    else if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    this.selectMapPoint(nextHorizontalPosition, nextVerticalPosition);
  }

  clearMapSelection() {
    this.selectedPoint = null;
    this.pointClimate.marker.hidden = true;
    this.pointClimate.clearButton.hidden = true;
    this.pointClimate.data.hidden = true;
    this.pointClimate.empty.hidden = false;
  }

  updateSelectedPointClimate() {
    if (!this.ready || !this.selectedPoint || !this.pointReadFramebuffer) return;

    const { x, y, longitude, latitude } = this.selectedPoint;
    const temperatures = this.readTexturePixel(
      this.simulation.seasonalTemperature[this.climateStatsIndex],
      x,
      y,
    );
    const annualizedPrecipitation = this.readTexturePixel(
      this.simulation.seasonalPrecipitation[this.climateStatsIndex],
      x,
      y,
    );
    const available = this.seasonalSampleCounts.map((count) => count > 0);
    const precipitation = annualizedPrecipitation.map((value) => value / 4);
    const availableCount = available.filter(Boolean).length;

    this.pointClimate.coordinates.textContent = [
      this.formatMapCoordinate(latitude, "N", "S"),
      this.formatMapCoordinate(longitude, "E", "W"),
    ].join(" · ");

    if (!this.controls.autoSeasons.checked) {
      this.pointClimate.status.textContent = "Enable automatic seasons to collect a pattern.";
    } else if (availableCount < 4) {
      this.pointClimate.status.textContent = `Collecting seasonal pattern · ${availableCount} of 4 periods available`;
    } else {
      const sampleCount = this.seasonalSampleCounts.reduce((sum, count) => sum + count, 0);
      this.pointClimate.status.textContent = `Seasonal climatology · ${sampleCount} samples`;
    }

    if (availableCount === 4) {
      const annualMeanTemperature = temperatures.reduce((sum, value) => sum + value, 0) / 4;
      const annualPrecipitation = precipitation.reduce((sum, value) => sum + value, 0);
      this.pointClimate.summary.textContent = `${annualMeanTemperature.toFixed(1)} °C annual mean · ${annualPrecipitation.toFixed(1)} cm/year`;
    } else {
      this.pointClimate.summary.textContent = "Annual summary available after all four periods.";
    }

    this.renderPointClimateTable(temperatures, precipitation, available, latitude);
    this.renderTemperatureChart(temperatures, available);
    this.renderPrecipitationChart(precipitation, available);
  }

  readTexturePixel(texture, x, y) {
    const gl = this.gl;
    const values = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pointReadFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture.texture,
      0,
    );
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, values);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(values);
  }

  formatMapCoordinate(value, positiveSuffix, negativeSuffix) {
    const suffix = value < 0 ? negativeSuffix : positiveSuffix;
    return `${Math.abs(value).toFixed(1)}°${suffix}`;
  }

  renderPointClimateTable(temperatures, precipitation, available, latitude) {
    const localSeasons = latitude >= 0 ? NORTHERN_SEASONS : SOUTHERN_SEASONS;
    const rows = SEASON_PERIODS.map((period, index) => {
      const row = this.document.createElement("tr");
      const values = [
        period,
        localSeasons[index],
        available[index] ? `${temperatures[index].toFixed(1)} °C` : "Collecting",
        available[index] ? `${precipitation[index].toFixed(1)} cm` : "Collecting",
      ];
      values.forEach((value, cellIndex) => {
        const cell = this.document.createElement(cellIndex === 0 ? "th" : "td");
        if (cellIndex === 0) cell.scope = "row";
        cell.textContent = value;
        row.append(cell);
      });
      return row;
    });
    this.pointClimate.values.replaceChildren(...rows);
  }

  renderTemperatureChart(values, available) {
    const validValues = values.filter((value, index) => available[index]);
    let minimum = validValues.length ? Math.min(...validValues) : -5;
    let maximum = validValues.length ? Math.max(...validValues) : 5;
    minimum = Math.floor((minimum - 2) / 5) * 5;
    maximum = Math.ceil((maximum + 2) / 5) * 5;
    if (maximum - minimum < 10) {
      minimum -= 5;
      maximum += 5;
    }

    const chart = this.pointClimate.temperatureChart;
    const geometry = this.getPointChartGeometry();
    const yPosition = (value) => geometry.bottom
      - (value - minimum) / (maximum - minimum) * geometry.height;
    const content = this.renderPointChartGrid(minimum, maximum, geometry);
    const segments = [];
    let currentSegment = [];
    values.forEach((value, index) => {
      if (available[index]) {
        currentSegment.push(`${geometry.x[index]},${yPosition(value)}`);
      } else if (currentSegment.length) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    });
    if (currentSegment.length) segments.push(currentSegment);

    content.push(...segments
      .filter((segment) => segment.length > 1)
      .map((segment) => `<polyline class="point-chart-temperature-line" points="${segment.join(" ")}"></polyline>`));
    values.forEach((value, index) => {
      if (available[index]) {
        const y = yPosition(value);
        content.push(`<circle class="point-chart-temperature-point" cx="${geometry.x[index]}" cy="${y}" r="5"></circle>`);
        content.push(`<text class="point-chart-label" x="${geometry.x[index]}" y="${y - 10}" text-anchor="middle">${value.toFixed(1)}°</text>`);
      } else {
        content.push(this.renderMissingChartPoint(geometry.x[index], geometry));
      }
    });
    content.push(this.renderPointChartPeriodLabels(geometry));
    chart.innerHTML = content.join("");
    chart.setAttribute(
      "aria-label",
      `Seasonal mean temperature: ${this.formatChartAriaValues(values, available, "degrees Celsius")}`,
    );
  }

  renderPrecipitationChart(values, available) {
    const validValues = values.filter((value, index) => available[index]);
    const rawMaximum = validValues.length ? Math.max(...validValues) : 10;
    const maximum = Math.max(10, Math.ceil(rawMaximum / 10) * 10);
    const chart = this.pointClimate.precipitationChart;
    const geometry = this.getPointChartGeometry();
    const content = this.renderPointChartGrid(0, maximum, geometry);

    values.forEach((value, index) => {
      if (available[index]) {
        const barHeight = Math.max(1, value / maximum * geometry.height);
        const y = geometry.bottom - barHeight;
        content.push(`<rect class="point-chart-precipitation-bar" x="${geometry.x[index] - 23}" y="${y}" width="46" height="${barHeight}" rx="3"></rect>`);
        content.push(`<text class="point-chart-label" x="${geometry.x[index]}" y="${Math.max(14, y - 7)}" text-anchor="middle">${value.toFixed(1)}</text>`);
      } else {
        content.push(this.renderMissingChartPoint(geometry.x[index], geometry));
      }
    });
    content.push(this.renderPointChartPeriodLabels(geometry));
    chart.innerHTML = content.join("");
    chart.setAttribute(
      "aria-label",
      `Seasonal precipitation: ${this.formatChartAriaValues(values, available, "centimeters")}`,
    );
  }

  getPointChartGeometry() {
    const left = 48;
    const right = 390;
    const top = 18;
    const bottom = 150;
    return {
      left,
      right,
      top,
      bottom,
      height: bottom - top,
      x: SEASON_PERIODS.map((_, index) => left + (right - left) * index / 3),
    };
  }

  renderPointChartGrid(minimum, maximum, geometry) {
    const content = [];
    for (let index = 0; index <= 3; index += 1) {
      const y = geometry.top + geometry.height * index / 3;
      const value = maximum - (maximum - minimum) * index / 3;
      content.push(`<line class="point-chart-grid" x1="${geometry.left}" y1="${y}" x2="${geometry.right}" y2="${y}"></line>`);
      content.push(`<text class="point-chart-label" x="40" y="${y + 4}" text-anchor="end">${value.toFixed(0)}</text>`);
    }
    return content;
  }

  renderPointChartPeriodLabels(geometry) {
    const labels = ["MAM", "JJA", "SON", "DJF"];
    return labels.map((label, index) => `<text class="point-chart-label" x="${geometry.x[index]}" y="177" text-anchor="middle">${label}</text>`).join("");
  }

  renderMissingChartPoint(x, geometry) {
    return `<text class="point-chart-missing" x="${x}" y="${geometry.bottom - 8}" text-anchor="middle">…</text>`;
  }

  formatChartAriaValues(values, available, unit) {
    return SEASON_PERIODS.map((period, index) => available[index]
      ? `${period} ${values[index].toFixed(1)} ${unit}`
      : `${period} collecting`).join(", ");
  }

  classifyClimateZones() {
    if (this.climateSampleCount === 0) return;

    this.simulation.climateZoneFramebuffer.use([0]);
    const climateZone = this.programs.climateZone;
    climateZone.use();
    climateZone.setTexture("heightmap", 0, this.textures.heightmap);
    climateZone.setTexture("climateStatsA", 1, this.simulation.climateStatsA[this.climateStatsIndex]);
    climateZone.setTexture("climateStatsB", 2, this.simulation.climateStatsB[this.climateStatsIndex]);
    climateZone.setFloat("waterLevel", this.getWaterLevel());
    this.meshes.fullscreen.draw();
  }

  simulate() {
    const gl = this.gl;
    const targetIndex = this.pingPongIndex;
    const sourceIndex = 1 - targetIndex;
    const waterLevel = this.getWaterLevel();

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.simulation.oceanFramebuffers[targetIndex].use([0, 1, 2]);
    const ocean = this.programs.ocean;
    ocean.use();
    ocean.setTexture("heightmap", 0, this.textures.heightmap);
    ocean.setTexture("atmosphericWind", 1, this.simulation.wind[sourceIndex]);
    ocean.setTexture("precipitationMap", 2, this.simulation.waterVapor[sourceIndex]);
    ocean.setTexture("previousCurrent", 3, this.simulation.oceanCurrent[sourceIndex]);
    ocean.setTexture("previousTemperature", 4, this.simulation.seaSurfaceTemperature[sourceIndex]);
    ocean.setTexture("previousSalinity", 5, this.simulation.salinity[sourceIndex]);
    ocean.setTexture("previousDeepState", 6, this.simulation.deepOceanState[sourceIndex]);
    ocean.setTexture("previousOverturning", 7, this.simulation.overturning[sourceIndex]);
    ocean.setFloat("waterLevel", waterLevel);
    ocean.setFloat("rotationSpeed", this.getRotationSpeed());
    ocean.setFloat("solarIrradiance", this.getSolarIrradiance());
    ocean.setFloat("solarDeclination", this.getSolarDeclination());
    ocean.setFloat("oceanCirculation", this.getOceanCirculation());
    this.meshes.fullscreen.draw();

    this.simulation.deepOceanFramebuffers[targetIndex].use([0, 1]);
    const deepOcean = this.programs.deepOcean;
    deepOcean.use();
    deepOcean.setTexture("heightmap", 0, this.textures.heightmap);
    deepOcean.setTexture("surfaceCurrent", 1, this.simulation.oceanCurrent[targetIndex]);
    deepOcean.setTexture("surfaceTemperature", 2, this.simulation.seaSurfaceTemperature[targetIndex]);
    deepOcean.setTexture("surfaceSalinity", 3, this.simulation.salinity[targetIndex]);
    deepOcean.setTexture("previousDeepState", 4, this.simulation.deepOceanState[sourceIndex]);
    deepOcean.setFloat("waterLevel", waterLevel);
    deepOcean.setFloat("rotationSpeed", this.getRotationSpeed());
    deepOcean.setFloat("deepOceanCirculation", this.getDeepOceanCirculation());
    this.meshes.fullscreen.draw();

    this.simulation.advectionFramebuffers[targetIndex].use([0, 1, 2, 3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const advection = this.programs.advection;
    advection.use();
    advection.setTexture("heightmap", 0, this.textures.heightmap);
    advection.setTexture("previousWaterVapor", 1, this.simulation.waterVapor[sourceIndex]);
    advection.setTexture("previousWind", 2, this.simulation.wind[sourceIndex]);
    advection.setTexture("previousPressure", 3, this.simulation.pressure[sourceIndex]);
    advection.setTexture("seaSurfaceTemperature", 4, this.simulation.seaSurfaceTemperature[targetIndex]);
    advection.setFloat("waterLevel", waterLevel);
    advection.setFloat("rotationSpeed", this.getRotationSpeed());
    advection.setFloat("globalCirculation", this.getGlobalCirculation());
    advection.setFloat("solarIrradiance", this.getSolarIrradiance());
    advection.setFloat("solarDeclination", this.getSolarDeclination());
    this.meshes.fullscreen.draw();

    this.simulation.biomeFramebuffer.use([0]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const biome = this.programs.biome;
    biome.use();
    biome.setTexture("heightmap", 0, this.textures.heightmap);
    biome.setTexture("waterVaporMap", 1, this.simulation.waterVapor[targetIndex]);
    biome.setTexture("temperatureMap", 2, this.simulation.temperature);
    biome.setTexture(
      "biomeLookup",
      3,
      this.simulationUsesSoftBiomes()
        ? this.textures.biomeLookups[1]
        : this.textures.biomeLookups[0],
    );
    biome.setFloat("waterLevel", waterLevel);
    this.meshes.fullscreen.draw();

    this.pingPongIndex = sourceIndex;
  }

  render() {
    if (!this.ready) return;

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const render = this.programs.render;
    render.use();
    render.setTexture("heightmap", 0, this.textures.heightmap);
    render.setTexture("waterVaporMap", 1, this.simulation.waterVapor[1 - this.pingPongIndex]);
    render.setTexture("temperatureMap", 2, this.simulation.temperature);
    render.setTexture("biomeMap", 3, this.simulation.biomes);
    render.setTexture("windMap", 4, this.simulation.wind[1 - this.pingPongIndex]);
    render.setTexture("waterVaporColors", 5, this.textures.waterColors);
    render.setTexture("temperatureColors", 6, this.textures.temperatureColors);
    render.setTexture("pressureMap", 7, this.simulation.pressure[1 - this.pingPongIndex]);
    render.setTexture("climateZoneMap", 8, this.simulation.climateZones);
    render.setTexture("oceanCurrentMap", 9, this.simulation.oceanCurrent[1 - this.pingPongIndex]);
    render.setTexture("deepOceanState", 10, this.simulation.deepOceanState[1 - this.pingPongIndex]);
    render.setFloat("waterLevel", this.getWaterLevel());
    render.setInteger("viewMode", this.viewMode);
    render.setInteger("grayscale", Number(this.controls.grayscale.checked));
    this.meshes.fullscreen.draw();

    this.drawOverlays();
  }

  drawOverlays() {
    const gl = this.gl;
    gl.enable(gl.BLEND);

    if (this.controls.windArrows.checked) {
      const wind = this.programs.wind;
      wind.use();
      const drawingOceanCurrents = this.viewMode === 7;
      const drawingDeepCurrents = this.viewMode === 8;
      wind.setTexture(
        "windMap",
        0,
        drawingOceanCurrents
          ? this.simulation.oceanCurrent[1 - this.pingPongIndex]
          : (drawingDeepCurrents
            ? this.simulation.deepOceanState[1 - this.pingPongIndex]
            : this.simulation.wind[1 - this.pingPongIndex]),
      );
      wind.setFloat(
        "arrowScale",
        drawingOceanCurrents ? 0.02 : (drawingDeepCurrents ? 0.06 : 0.0005),
      );
      wind.setVector4("color", [1, 1, 1, 0.8]);
      this.meshes.windArrows.draw();
    }

    const lines = this.programs.line;
    lines.use();

    if (this.controls.mainGrid.checked) {
      lines.setVector4("color", [0, 0, 0, 1]);
      this.drawVerticalLine(lines, 0);
      [-23.5, 0, 23.5].forEach((latitude) => this.drawHorizontalLine(lines, latitude));
    }

    if (this.controls.subGrid.checked) {
      lines.setVector4("color", [0, 0, 0, 0.2]);
      if (!this.controls.mainGrid.checked) {
        this.drawHorizontalLine(lines, 0);
        this.drawVerticalLine(lines, 0);
      }
      for (let latitude = 10; latitude <= 80; latitude += 10) {
        this.drawHorizontalLine(lines, -latitude);
        this.drawHorizontalLine(lines, latitude);
      }
      for (let longitude = 10; longitude <= 170; longitude += 10) {
        this.drawVerticalLine(lines, -longitude);
        this.drawVerticalLine(lines, longitude);
      }
    }

    gl.disable(gl.BLEND);
  }

  drawHorizontalLine(program, latitude) {
    program.setVector2("offset", [0, this.latitudeToClipSpace(latitude)]);
    this.meshes.horizontalLine.draw();
  }

  drawVerticalLine(program, longitude) {
    program.setVector2("offset", [this.longitudeToClipSpace(longitude), 0]);
    this.meshes.verticalLine.draw();
  }

  latitudeToClipSpace(latitude) {
    return latitude / 90;
  }

  longitudeToClipSpace(longitude) {
    return longitude / 180;
  }

  getWaterLevel() {
    return Math.min(1, Math.max(0, this.readNumber(this.controls.waterLevel, 0.5)));
  }

  getRotationSpeed() {
    return this.readNumber(this.controls.rotationSpeed, 460) * this.rotationUnitFactor;
  }

  getGlobalCirculation() {
    return Math.min(2, Math.max(0, this.readNumber(this.controls.globalCirculation, 1)));
  }

  getOceanCirculation() {
    return Math.min(2, Math.max(0, this.readNumber(this.controls.oceanCirculation, 1)));
  }

  getDeepOceanCirculation() {
    return Math.min(2, Math.max(0, this.readNumber(this.controls.deepOceanCirculation, 1)));
  }

  getSolarIrradiance() {
    return Math.max(0, this.readNumber(this.controls.insolation, 1361)) * this.insolationUnitFactor;
  }

  getSolarDeclination() {
    if (this.controls.autoSeasons.checked) return this.automaticDeclination;
    return Math.min(23.5, Math.max(-23.5, this.readNumber(this.controls.solarDeclination, 0)));
  }

  simulationUsesSoftBiomes() {
    return this.controls.softenBiomes.checked;
  }

  readNumber(input, fallback) {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  formatNumber(value) {
    return Number.parseFloat(value.toPrecision(9)).toString();
  }

  setPhysicalInput(input, physicalValue, unitFactor) {
    input.value = this.formatNumber(physicalValue / unitFactor);
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.legends.forEach((legend, index) => {
      if (legend) legend.hidden = index !== viewMode;
    });
    this.render();
  }

  applyPreset(name) {
    if (!this.ready) return;

    const cassini = name === "cassini";
    this.textures.heightmap = cassini ? this.textures.cassini : this.textures.earth;
    this.controls.waterLevel.value = cassini ? "0.48" : "0.5";
    this.setPhysicalInput(
      this.controls.rotationSpeed,
      name === "retrograde" ? -460 : 460,
      this.rotationUnitFactor,
    );
    this.controls.globalCirculation.value = "1";
    this.controls.oceanCirculation.value = "1";
    this.controls.deepOceanCirculation.value = "1";
    this.setPhysicalInput(this.controls.insolation, 1361, this.insolationUnitFactor);
    this.controls.solarDeclination.value = "0";
    this.controls.heightmap.value = "";
    this.clearSimulation();
    this.step();
  }

  async loadUploadedHeightmap() {
    const [file] = this.controls.heightmap.files;
    if (!file || !this.gl) return;

    const objectUrl = URL.createObjectURL(file);
    this.status.hidden = false;
    this.status.textContent = "Loading heightmap…";

    try {
      const texture = await Texture2D.load(this.gl, objectUrl, { linear: true, repeatX: true });
      this.uploadedHeightmap?.destroy();
      this.uploadedHeightmap = texture;
      this.textures.heightmap = texture;
      this.clearSimulation();
      this.step();
    } catch (error) {
      this.reportError(error);
    } finally {
      URL.revokeObjectURL(objectUrl);
      this.status.hidden = true;
    }
  }

  downloadCurrentMap() {
    if (!this.ready) return;
    this.render();

    const anchor = document.createElement("a");
    anchor.download = `${VIEW_NAMES[this.viewMode]}.png`;
    anchor.href = this.canvas.toDataURL("image/png");
    anchor.click();
  }

  reportError(error) {
    console.error(error);
    this.errorOutput.hidden = false;
    this.errorOutput.textContent = error instanceof Error ? error.message : String(error);
  }
}

export const simulator = new ClimateSimulator(document);
simulator.initialize();
