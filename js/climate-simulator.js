import { shaders } from "./shaders.js";
import {
  ASSETS,
  AUTO_SEASON_BATCH_SIZE,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_PRESSURE_AREA_INTENSITY,
  MIN_PRESSURE_AREA_INTENSITY,
  MIN_SEASONAL_SIMULATION_TIME_STEP,
  PRESSURE_FIELD_HEIGHT,
  PRESSURE_FIELD_WIDTH,
  REFERENCE_SEASON_PASSES_PER_YEAR,
  SEASON_PASSES_PER_YEAR,
  STEADY_BATCH_SIZE,
  UPDATE_INTERVAL_MS,
  VIEW_NAMES,
  WARMUP_BATCH_SIZE,
  WARMUP_PASS_COUNT,
} from "./simulation-config.js";
import { KOPPEN_CLASS_BY_COLOR } from "./climate-catalog.js";
import { Framebuffer, Mesh, ShaderProgram, Texture2D } from "./webgl.js";
import { MapMagnifier } from "./map-magnifier.js";
import {
  deserializePressureMap,
  rasterizePressureAreas,
  serializePressureMap,
} from "./pressure-map.js";
import { PointClimatePanel } from "./point-climate-panel.js";

export class ClimateSimulator {
  constructor(documentRoot) {
    this.document = documentRoot;
    this.canvas = documentRoot.querySelector("#climate-canvas");
    this.magnifier = new MapMagnifier(
      this.canvas,
      documentRoot.querySelector("#map-magnifier"),
      documentRoot.querySelector("#toggle-map-magnifier"),
    );
    this.status = documentRoot.querySelector("#loading-status");
    this.errorOutput = documentRoot.querySelector("#error-output");
    this.progress = documentRoot.querySelector("#simulation-progress");
    this.progressLabel = documentRoot.querySelector("#simulation-progress-label");
    this.controlTabs = Array.from(documentRoot.querySelectorAll("[data-control-tab]"));
    this.pressureAreaControls = {
      addButtons: Array.from(documentRoot.querySelectorAll("[data-pressure-area-type]")),
      removeButton: documentRoot.querySelector("#remove-pressure-area"),
      intensityInput: documentRoot.querySelector("#pressure-area-intensity"),
      importButton: documentRoot.querySelector("#import-pressure-map"),
      exportButton: documentRoot.querySelector("#export-pressure-map"),
      fileInput: documentRoot.querySelector("#pressure-map-file"),
      status: documentRoot.querySelector("#pressure-area-status"),
      markers: documentRoot.querySelector("#pressure-area-markers"),
    };
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
      documentRoot.querySelector("#annual-precipitation-legend"),
      documentRoot.querySelector("#annual-mean-temperature-legend"),
      documentRoot.querySelector("#coldest-month-temperature-legend"),
      documentRoot.querySelector("#warmest-month-temperature-legend"),
    ];
    this.temperatureClimatologyStatuses = Array.from(
      documentRoot.querySelectorAll("[data-temperature-climatology-status]"),
    );
    this.seasonPosition = documentRoot.querySelector("#season-position");
    this.climateZoneStatus = documentRoot.querySelector("#climate-zone-status");
    this.annualPrecipitationStatus = documentRoot.querySelector(
      "#annual-precipitation-status",
    );
    this.pointClimate = new PointClimatePanel(documentRoot);

    this.viewMode = 3;
    this.pingPongIndex = 0;
    this.climateStatsIndex = 0;
    this.climateSampleCount = 0;
    this.monthlySampleCounts = Array(12).fill(0);
    this.seasonPasses = 0;
    this.seasonalSimulationAccumulator = 0;
    this.automaticDeclination = 0;
    this.completedClimateYears = 0;
    this.ready = false;
    this.completedPasses = 0;
    this.uploadedHeightmap = null;
    this.selectedPoint = null;
    this.pointReadFramebuffer = null;
    this.lastPointClimateUpdateTime = 0;
    this.pressureAreas = [];
    this.nextPressureAreaId = 1;
    this.selectedPressureAreaId = null;
    this.pendingPressureAreaType = null;
    this.pressureForcingValues = null;
    this.rotationUnitFactor = Number(this.controls.rotationUnit.value);
    this.insolationUnitFactor = Number(this.controls.insolationUnit.value);

    this.configureCanvasSize();
    this.bindControls();
    this.renderPressureAreas();
    this.updateSeasonControls();
    this.updateAnnualPrecipitationStatus();
    this.updateTemperatureClimatologyStatus();
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
    this.controlTabs.forEach((tab, index) => {
      tab.addEventListener("click", () => this.setControlTab(tab));
      tab.addEventListener("keydown", (event) => this.handleControlTabKey(event, index));
    });
    this.pressureAreaControls.addButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.beginPressureAreaPlacement(button.dataset.pressureAreaType);
      });
    });
    this.pressureAreaControls.removeButton.addEventListener("click", () => {
      this.removeSelectedPressureArea();
    });
    this.pressureAreaControls.intensityInput.addEventListener("input", () => {
      this.updateSelectedPressureAreaIntensity();
    });
    this.pressureAreaControls.intensityInput.addEventListener("change", () => {
      this.updateSelectedPressureAreaIntensity({ normalizeInput: true });
    });
    this.pressureAreaControls.importButton.addEventListener("click", () => {
      this.pressureAreaControls.fileInput.click();
    });
    this.pressureAreaControls.exportButton.addEventListener("click", () => {
      this.exportPressureMap();
    });
    this.pressureAreaControls.fileInput.addEventListener("change", () => {
      this.importPressureMapFile();
    });
    this.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.pendingPressureAreaType) {
        this.pendingPressureAreaType = null;
        this.renderPressureAreas();
      }
      if (this.magnifier.enabled) this.magnifier.setEnabled(false);
    });

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

  setControlTab(selectedTab, focus = false) {
    this.controlTabs.forEach((tab) => {
      const selected = tab === selectedTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = this.document.getElementById(tab.getAttribute("aria-controls"));
      panel.hidden = !selected;
    });
    if (focus) selectedTab.focus();
  }

  handleControlTabKey(event, currentIndex) {
    let nextIndex;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + this.controlTabs.length) % this.controlTabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % this.controlTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = this.controlTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.setControlTab(this.controlTabs[nextIndex], true);
  }

  beginPressureAreaPlacement(type) {
    this.pendingPressureAreaType = this.pendingPressureAreaType === type ? null : type;
    this.renderPressureAreas();
    if (this.pendingPressureAreaType) this.canvas.focus();
  }

  addPressureArea(type, horizontalPosition, verticalPosition) {
    const area = {
      id: this.nextPressureAreaId,
      type,
      horizontalPosition: Math.min(1, Math.max(0, horizontalPosition)),
      verticalPosition: Math.min(1, Math.max(0, verticalPosition)),
      intensity: 1,
    };
    this.nextPressureAreaId += 1;
    this.pressureAreas.push(area);
    this.pendingPressureAreaType = null;
    this.selectedPressureAreaId = area.id;
    this.renderPressureAreas(area.id);
    this.updatePressureForcingTexture();
    this.markSimulationUnsettled();
  }

  removeSelectedPressureArea() {
    if (this.selectedPressureAreaId === null) return;
    this.pressureAreas = this.pressureAreas.filter(
      (area) => area.id !== this.selectedPressureAreaId,
    );
    this.selectedPressureAreaId = null;
    this.renderPressureAreas();
    this.updatePressureForcingTexture();
    this.markSimulationUnsettled();
  }

  renderPressureAreas(focusId = null) {
    const markers = this.pressureAreas.map((area) => {
      const marker = this.document.createElement("button");
      marker.type = "button";
      marker.className = `pressure-area-marker pressure-area-marker-${area.type}`;
      marker.dataset.pressureAreaId = String(area.id);
      marker.style.left = `${area.horizontalPosition * 100}%`;
      marker.style.top = `${area.verticalPosition * 100}%`;
      marker.textContent = area.type === "high" ? "H" : "L";
      marker.title = `${this.getPressureAreaLabel(area)}. Drag or use arrow keys to move; Delete removes.`;
      marker.setAttribute("aria-label", marker.title);
      marker.addEventListener("click", () => {
        this.selectedPressureAreaId = area.id;
        this.syncPressureAreaControls();
      });
      marker.addEventListener("pointerdown", (event) => {
        this.startPressureAreaDrag(event, area.id);
      });
      marker.addEventListener("keydown", (event) => {
        this.handlePressureAreaKey(event, area.id);
      });
      return marker;
    });
    this.pressureAreaControls.markers.replaceChildren(...markers);
    this.syncPressureAreaControls();

    if (focusId !== null) {
      this.pressureAreaControls.markers
        .querySelector(`[data-pressure-area-id="${focusId}"]`)
        ?.focus();
    }
  }

  syncPressureAreaControls() {
    this.pressureAreaControls.markers
      .querySelectorAll("[data-pressure-area-id]")
      .forEach((marker) => {
        const selected = Number(marker.dataset.pressureAreaId)
          === this.selectedPressureAreaId;
        marker.classList.toggle("selected", selected);
        marker.setAttribute("aria-pressed", String(selected));
      });
    this.pressureAreaControls.addButtons.forEach((button) => {
      const active = button.dataset.pressureAreaType === this.pendingPressureAreaType;
      button.setAttribute("aria-pressed", String(active));
    });
    const selectedArea = this.pressureAreas.find(
      (area) => area.id === this.selectedPressureAreaId,
    );
    this.pressureAreaControls.removeButton.disabled = !selectedArea;
    this.pressureAreaControls.intensityInput.disabled = !selectedArea;
    this.pressureAreaControls.exportButton.disabled =
      this.pressureAreas.length === 0;
    if (selectedArea) {
      this.pressureAreaControls.intensityInput.value =
        this.formatNumber(selectedArea.intensity);
    }
    this.canvas.classList.toggle(
      "placing-pressure-area",
      this.pendingPressureAreaType !== null,
    );
    this.updatePressureAreaStatus();
  }

  updatePressureAreaStatus() {
    if (this.pendingPressureAreaType) {
      const name = this.pendingPressureAreaType === "high" ? "high" : "low";
      this.pressureAreaControls.status.textContent =
        `Click the map to place a ${name}-pressure area. Press Escape to cancel.`;
      return;
    }

    const selected = this.pressureAreas.find(
      (area) => area.id === this.selectedPressureAreaId,
    );
    if (selected) {
      this.pressureAreaControls.status.textContent =
        `${this.getPressureAreaLabel(selected)} selected. Drag its marker or use arrow keys to move it.`;
    } else if (this.pressureAreas.length === 0) {
      this.pressureAreaControls.status.textContent = "No custom pressure areas.";
    } else {
      const noun = this.pressureAreas.length === 1 ? "area" : "areas";
      this.pressureAreaControls.status.textContent =
        `${this.pressureAreas.length} pressure ${noun}. Select a marker to move or remove it.`;
    }
  }

  getPressureAreaLabel(area) {
    const latitude = 90 - area.verticalPosition * 180;
    const longitude = area.horizontalPosition * 360 - 180;
    return [
      area.type === "high" ? "High pressure" : "Low pressure",
      `${this.formatNumber(area.intensity)}× intensity`,
      this.formatMapCoordinate(latitude, "N", "S"),
      this.formatMapCoordinate(longitude, "E", "W"),
    ].join(" · ");
  }

  startPressureAreaDrag(event, id) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    const marker = event.currentTarget;
    this.selectedPressureAreaId = id;
    this.syncPressureAreaControls();
    marker.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const position = this.getMapPositionFromClient(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      this.setPressureAreaPosition(
        id,
        position.horizontalPosition,
        position.verticalPosition,
      );
      marker.style.left = `${position.horizontalPosition * 100}%`;
      marker.style.top = `${position.verticalPosition * 100}%`;
      this.updatePressureAreaStatus();
    };
    const end = (endEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      marker.removeEventListener("pointermove", move);
      marker.removeEventListener("pointerup", end);
      marker.removeEventListener("pointercancel", end);
      this.renderPressureAreas(id);
      this.updatePressureForcingTexture();
      this.markSimulationUnsettled();
    };
    marker.addEventListener("pointermove", move);
    marker.addEventListener("pointerup", end);
    marker.addEventListener("pointercancel", end);
  }

  handlePressureAreaKey(event, id) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.selectedPressureAreaId = id;
      this.removeSelectedPressureArea();
      return;
    }

    const area = this.pressureAreas.find((candidate) => candidate.id === id);
    if (!area) return;
    const movement = event.shiftKey ? 0.05 : 0.01;
    let horizontalPosition = area.horizontalPosition;
    let verticalPosition = area.verticalPosition;
    if (event.key === "ArrowLeft") horizontalPosition -= movement;
    else if (event.key === "ArrowRight") horizontalPosition += movement;
    else if (event.key === "ArrowUp") verticalPosition -= movement;
    else if (event.key === "ArrowDown") verticalPosition += movement;
    else return;

    event.preventDefault();
    event.stopPropagation();
    horizontalPosition = ((horizontalPosition % 1) + 1) % 1;
    verticalPosition = Math.min(1, Math.max(0, verticalPosition));
    this.setPressureAreaPosition(id, horizontalPosition, verticalPosition);
    this.selectedPressureAreaId = id;
    this.renderPressureAreas(id);
    this.updatePressureForcingTexture();
    this.markSimulationUnsettled();
  }

  setPressureAreaPosition(id, horizontalPosition, verticalPosition) {
    const area = this.pressureAreas.find((candidate) => candidate.id === id);
    if (!area) return;
    area.horizontalPosition = horizontalPosition;
    area.verticalPosition = verticalPosition;
  }

  getMapPositionFromClient(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      horizontalPosition: Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)),
      verticalPosition: Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height)),
    };
  }

  applyPressureMap(pressureAreas) {
    this.pressureAreas = pressureAreas;
    this.nextPressureAreaId = pressureAreas.length + 1;
    this.selectedPressureAreaId = null;
    this.pendingPressureAreaType = null;
    this.renderPressureAreas();
    this.updatePressureForcingTexture();
    this.markSimulationUnsettled();
  }

  async importPressureMapFile() {
    const [file] = this.pressureAreaControls.fileInput.files;
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());
      const pressureAreas = deserializePressureMap(data);
      this.applyPressureMap(pressureAreas);
      const noun = pressureAreas.length === 1 ? "area" : "areas";
      this.pressureAreaControls.status.textContent =
        `Imported ${pressureAreas.length} pressure ${noun}.`;
    } catch (error) {
      this.pressureAreaControls.status.textContent =
        `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.pressureAreaControls.fileInput.value = "";
    }
  }

  exportPressureMap() {
    const contents = `${JSON.stringify(serializePressureMap(this.pressureAreas), null, 2)}\n`;
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement("a");
    anchor.download = "climate-pressure-map.json";
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);

    const noun = this.pressureAreas.length === 1 ? "area" : "areas";
    this.pressureAreaControls.status.textContent =
      `Exported ${this.pressureAreas.length} pressure ${noun}.`;
  }

  updateSelectedPressureAreaIntensity({ normalizeInput = false } = {}) {
    const area = this.pressureAreas.find(
      (candidate) => candidate.id === this.selectedPressureAreaId,
    );
    if (!area) return;

    const parsedIntensity = Number.parseFloat(
      this.pressureAreaControls.intensityInput.value,
    );
    if (!Number.isFinite(parsedIntensity)) return;

    area.intensity = Math.min(
      MAX_PRESSURE_AREA_INTENSITY,
      Math.max(MIN_PRESSURE_AREA_INTENSITY, parsedIntensity),
    );
    if (normalizeInput) {
      this.pressureAreaControls.intensityInput.value =
        this.formatNumber(area.intensity);
    }
    const marker = this.pressureAreaControls.markers.querySelector(
      `[data-pressure-area-id="${area.id}"]`,
    );
    if (marker) {
      marker.title = `${this.getPressureAreaLabel(area)}. Drag or use arrow keys to move; Delete removes.`;
      marker.setAttribute("aria-label", marker.title);
    }
    this.updatePressureAreaStatus();
    this.updatePressureForcingTexture();
    this.markSimulationUnsettled();
  }

  updatePressureForcingTexture() {
    if (!this.simulation?.pressureForcing || !this.gl) return;

    this.pressureForcingValues = rasterizePressureAreas(
      this.pressureAreas,
      this.pressureForcingValues,
    );
    this.simulation.pressureForcing.uploadData(
      PRESSURE_FIELD_WIDTH,
      PRESSURE_FIELD_HEIGHT,
      this.gl.RED,
      this.gl.FLOAT,
      this.pressureForcingValues,
    );
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
      this.magnifier.setReady(true);
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
      monthlyClimate: new ShaderProgram(
        gl,
        shaders.fullscreenVertex,
        shaders.monthlyClimateFragment,
        "monthly climate",
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
    const [earth, cassini, biome, softBiome, waterColors] = await Promise.all([
      Texture2D.load(this.gl, ASSETS.earthHeightmap, wrapping),
      Texture2D.load(this.gl, ASSETS.cassiniHeightmap, wrapping),
      Texture2D.load(this.gl, ASSETS.biomeMap, linear),
      Texture2D.load(this.gl, ASSETS.softBiomeMap, linear),
      Texture2D.load(this.gl, ASSETS.waterVaporGradient, linear),
    ]);

    this.textures = {
      earth,
      cassini,
      heightmap: earth,
      biomeLookups: [biome, softBiome],
      waterColors,
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
    const pressureForcing = Texture2D.allocate(
      gl,
      PRESSURE_FIELD_WIDTH,
      PRESSURE_FIELD_HEIGHT,
      gl.R32F,
      gl.RED,
      gl.FLOAT,
    );
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
    // Each RGBA texture packs four consecutive months, January through December.
    const monthlyTemperature = Array.from({ length: 3 }, () => (
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    ));
    const monthlyPrecipitation = Array.from({ length: 3 }, () => (
      Texture2D.allocate(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    ));
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
    pressureForcing.setSampling(linearWrapping);
    [
      ...climateStatsA,
      ...climateStatsB,
      ...monthlyTemperature,
      ...monthlyPrecipitation,
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
      framebuffer.validate(`Climate statistics ${index}`);
    });

    const monthlyClimate = new Framebuffer(gl);
    monthlyClimate.attachColor(monthlyTemperature[0], 0);
    monthlyClimate.attachColor(monthlyPrecipitation[0], 1);
    monthlyClimate.validate("Monthly climate");

    const climateZone = new Framebuffer(gl);
    climateZone.attachColor(climateZones, 0);
    climateZone.validate("Climate zone");

    this.simulation = {
      waterVapor,
      wind,
      pressure,
      pressureForcing,
      oceanCurrent,
      seaSurfaceTemperature,
      salinity,
      deepOceanState,
      overturning,
      temperature,
      biomes,
      climateStatsA,
      climateStatsB,
      monthlyTemperature,
      monthlyPrecipitation,
      climateZones,
      advectionFramebuffers: advection,
      biomeFramebuffer: biome,
      oceanFramebuffers: ocean,
      deepOceanFramebuffers: deepOcean,
      climateStatsFramebuffers: climateStats,
      monthlyClimateFramebuffer: monthlyClimate,
      climateZoneFramebuffer: climateZone,
    };
    this.pressureForcingValues = new Float32Array(
      PRESSURE_FIELD_WIDTH * PRESSURE_FIELD_HEIGHT,
    );
    this.updatePressureForcingTexture();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  clearSimulation() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    this.simulation.advectionFramebuffers.forEach((framebuffer) => {
      framebuffer.use([0, 1, 2, 3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0]));
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
    const simulationTimeStep = wasWarmingUp || !this.controls.autoSeasons.checked
      ? 1
      : REFERENCE_SEASON_PASSES_PER_YEAR / this.getSeasonPassesPerYear();

    let completedYear = false;
    for (let pass = 0; pass < passCount; pass += 1) {
      if (this.controls.autoSeasons.checked && !wasWarmingUp) {
        const wrappedYear = this.advanceSeason();
        completedYear ||= wrappedYear;
        // Very small seasonal ticks are grouped to limit repeated interpolation
        // while preserving the same total modeled time per year.
        this.seasonalSimulationAccumulator += simulationTimeStep;
        if (
          this.seasonalSimulationAccumulator
          + Number.EPSILON
          >= MIN_SEASONAL_SIMULATION_TIME_STEP
        ) {
          this.simulate(this.seasonalSimulationAccumulator);
          this.seasonalSimulationAccumulator = 0;
        }
      } else {
        this.simulate(1);
      }
    }
    this.completedPasses += passCount;

    if (wasWarmingUp && this.completedPasses >= WARMUP_PASS_COUNT) {
      this.resetSeasonCycle();
      this.clearClimateStatistics();
    } else if (this.controls.autoSeasons.checked && !wasWarmingUp) {
      this.updateClimateStatistics();
      if (completedYear) {
        this.classifyClimateZones();
        this.completedClimateYears += 1;
        this.climateZoneStatus.textContent = `Classified from climate year ${this.completedClimateYears}`;
        this.clearClimateStatistics({ preserveMonthlyPatterns: true });
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
    const passes = Math.round(this.readNumber(
      this.controls.seasonSpeed,
      REFERENCE_SEASON_PASSES_PER_YEAR,
    ));
    return SEASON_PASSES_PER_YEAR.includes(passes)
      ? passes
      : REFERENCE_SEASON_PASSES_PER_YEAR;
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
    this.seasonalSimulationAccumulator = 0;
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

  updateAnnualPrecipitationStatus() {
    const availableMonths = this.monthlySampleCounts.filter(
      (count) => count > 0,
    ).length;
    if (!this.controls.autoSeasons.checked) {
      this.annualPrecipitationStatus.textContent =
        "Enable automatic seasons to collect a modeled annual total.";
    } else if (availableMonths < 12) {
      this.annualPrecipitationStatus.textContent =
        `Collecting annual map · ${availableMonths} of 12 months available.`;
    } else {
      const yearNoun = this.completedClimateYears === 1 ? "year" : "years";
      this.annualPrecipitationStatus.textContent = this.completedClimateYears > 0
        ? `Modeled annual total · climatology from ${this.completedClimateYears} completed ${yearNoun}.`
        : "Modeled annual total · all 12 months available.";
    }
  }

  updateTemperatureClimatologyStatus() {
    const availableMonths = this.monthlySampleCounts.filter(
      (count) => count > 0,
    ).length;
    let message;
    if (!this.controls.autoSeasons.checked) {
      message =
        "Enable automatic seasons to collect temperature climatology.";
    } else if (availableMonths < 12) {
      message =
        `Collecting temperature climatology · ${availableMonths} of 12 months available.`;
    } else {
      const yearNoun = this.completedClimateYears === 1 ? "year" : "years";
      message = this.completedClimateYears > 0
        ? `Monthly temperature climatology from ${this.completedClimateYears} completed ${yearNoun}.`
        : "Monthly temperature climatology · all 12 months available.";
    }
    this.temperatureClimatologyStatuses.forEach((status) => {
      status.textContent = message;
    });
  }

  resetSeasonalClimate() {
    this.completedClimateYears = 0;
    this.resetSeasonCycle();
    this.updateAnnualPrecipitationStatus();
    this.updateTemperatureClimatologyStatus();
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

  clearClimateStatistics({ preserveMonthlyPatterns = false } = {}) {
    const gl = this.gl;
    this.simulation.climateStatsFramebuffers.forEach((framebuffer) => {
      framebuffer.use([0, 1]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    if (!preserveMonthlyPatterns) {
      gl.colorMask(true, true, true, true);
      this.simulation.monthlyTemperature.forEach((temperature, index) => {
        const framebuffer = this.simulation.monthlyClimateFramebuffer;
        framebuffer.attachColor(temperature, 0);
        framebuffer.attachColor(this.simulation.monthlyPrecipitation[index], 1);
        framebuffer.use([0, 1]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      });
      this.monthlySampleCounts.fill(0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.climateStatsIndex = 0;
    this.climateSampleCount = 0;
    this.updateAnnualPrecipitationStatus();
    this.updateTemperatureClimatologyStatus();
    this.updateSelectedPointClimate(true);
  }

  updateClimateStatistics() {
    const sourceIndex = this.climateStatsIndex;
    const targetIndex = 1 - sourceIndex;
    const monthIndex = this.getClimateMonthIndex();
    this.simulation.climateStatsFramebuffers[targetIndex].use([0, 1]);

    const stats = this.programs.climateStats;
    stats.use();
    stats.setTexture("temperatureMap", 0, this.simulation.temperature);
    stats.setTexture("waterVaporMap", 1, this.simulation.waterVapor[1 - this.pingPongIndex]);
    stats.setTexture("previousStatsA", 2, this.simulation.climateStatsA[sourceIndex]);
    stats.setTexture("previousStatsB", 3, this.simulation.climateStatsB[sourceIndex]);
    stats.setTexture("heightmap", 4, this.textures.heightmap);
    stats.setTexture("windMap", 5, this.simulation.wind[1 - this.pingPongIndex]);
    stats.setFloat("sampleCount", this.climateSampleCount);
    stats.setFloat("solarDeclination", this.getSolarDeclination());
    stats.setFloat("waterLevel", this.getWaterLevel());
    this.meshes.fullscreen.draw();

    const monthlyTextureIndex = Math.floor(monthIndex / 4);
    const monthlyChannelIndex = monthIndex % 4;
    const monthlyFramebuffer = this.simulation.monthlyClimateFramebuffer;
    monthlyFramebuffer.attachColor(
      this.simulation.monthlyTemperature[monthlyTextureIndex],
      0,
    );
    monthlyFramebuffer.attachColor(
      this.simulation.monthlyPrecipitation[monthlyTextureIndex],
      1,
    );
    monthlyFramebuffer.use([0, 1]);

    const channelMask = [false, false, false, false];
    channelMask[monthlyChannelIndex] = true;
    const monthlyWeight = 1 / (this.monthlySampleCounts[monthIndex] + 1);
    const gl = this.gl;
    // Blending one channel in place computes its running mean without six
    // additional ping-pong textures.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendColor(0, 0, 0, monthlyWeight);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    gl.colorMask(...channelMask);

    const monthlyClimate = this.programs.monthlyClimate;
    monthlyClimate.use();
    monthlyClimate.setTexture("temperatureMap", 0, this.simulation.temperature);
    monthlyClimate.setTexture(
      "waterVaporMap",
      1,
      this.simulation.waterVapor[1 - this.pingPongIndex],
    );
    this.meshes.fullscreen.draw();

    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.BLEND);

    this.climateStatsIndex = targetIndex;
    this.climateSampleCount += 1;
    this.monthlySampleCounts[monthIndex] += 1;
    this.updateAnnualPrecipitationStatus();
    this.updateTemperatureClimatologyStatus();
    this.updateSelectedPointClimate();
  }

  getClimateMonthIndex() {
    const phase = this.seasonPasses / this.getSeasonPassesPerYear();
    const phaseMonth = Math.min(11, Math.floor(phase * 12));
    // The simulated year starts at the March equinox; the UI stays Jan-Dec.
    return (phaseMonth + 2) % 12;
  }

  selectMapPointFromEvent(event) {
    if (!this.ready) return;

    const position = this.getMapPositionFromClient(event.clientX, event.clientY);
    if (this.pendingPressureAreaType) {
      this.addPressureArea(
        this.pendingPressureAreaType,
        position.horizontalPosition,
        position.verticalPosition,
      );
      return;
    }
    this.selectMapPoint(position.horizontalPosition, position.verticalPosition);
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
    this.updateSelectedPointClimate(true);
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

  updateSelectedPointClimate(force = false) {
    if (!this.ready || !this.selectedPoint || !this.pointReadFramebuffer) return;
    const currentTime = performance.now();
    if (!force && currentTime - this.lastPointClimateUpdateTime < 200) return;
    this.lastPointClimateUpdateTime = currentTime;

    const { x, y, longitude, latitude } = this.selectedPoint;
    const temperatures = this.simulation.monthlyTemperature.flatMap((texture) => (
      this.readTexturePixel(texture, x, y)
    ));
    const precipitation = this.simulation.monthlyPrecipitation.flatMap((texture) => (
      this.readTexturePixel(texture, x, y)
    ));
    const available = this.monthlySampleCounts.map((count) => count > 0);
    const availableCount = available.filter(Boolean).length;

    this.pointClimate.coordinates.textContent = [
      this.formatMapCoordinate(latitude, "N", "S"),
      this.formatMapCoordinate(longitude, "E", "W"),
    ].join(" · ");

    if (!this.controls.autoSeasons.checked) {
      this.pointClimate.status.textContent = "Enable automatic seasons to collect monthly normals.";
    } else if (availableCount < 12) {
      this.pointClimate.status.textContent = `Collecting monthly pattern · ${availableCount} of 12 months available`;
    } else {
      const sampleCount = this.monthlySampleCounts.reduce((sum, count) => sum + count, 0);
      this.pointClimate.status.textContent = `Monthly climatology · ${sampleCount} samples`;
    }

    if (availableCount === 12) {
      const annualMeanTemperature = temperatures.reduce((sum, value) => sum + value, 0) / 12;
      const coldestMonthlyMean = Math.min(...temperatures);
      const warmestMonthlyMean = Math.max(...temperatures);
      const annualPrecipitation = precipitation.reduce((sum, value) => sum + value, 0);
      this.pointClimate.summary.textContent = [
        `${annualMeanTemperature.toFixed(1)} °C annual mean`,
        `${coldestMonthlyMean.toFixed(1)} °C coldest monthly mean`,
        `${warmestMonthlyMean.toFixed(1)} °C warmest monthly mean`,
        `${annualPrecipitation.toFixed(1)} cm/year`,
      ].join(" · ");
    } else {
      this.pointClimate.summary.textContent = "Annual summary available after all twelve months.";
    }
    this.updateSelectedPointClimateType(x, y);

    this.pointClimate.renderTable(temperatures, precipitation, available, latitude);
    this.pointClimate.renderTemperatureChart(temperatures, available);
    this.pointClimate.renderPrecipitationChart(precipitation, available);
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

  readByteTexturePixel(texture, x, y) {
    const gl = this.gl;
    const values = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pointReadFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture.texture,
      0,
    );
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, values);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(values);
  }

  updateSelectedPointClimateType(x, y) {
    if (this.completedClimateYears === 0) {
      this.pointClimate.type.textContent = "Köppen type available after the first climate year.";
      return;
    }

    const [red, green, blue] = this.readByteTexturePixel(
      this.simulation.climateZones,
      x,
      y,
    );
    const climateClass = KOPPEN_CLASS_BY_COLOR.get(`${red},${green},${blue}`);
    this.pointClimate.type.textContent = climateClass
      ? `Köppen-like ${climateClass[0]} · ${climateClass[1]}`
      : "Ocean · no Köppen land type";
  }

  formatMapCoordinate(value, positiveSuffix, negativeSuffix) {
    const suffix = value < 0 ? negativeSuffix : positiveSuffix;
    return `${Math.abs(value).toFixed(1)}°${suffix}`;
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

  simulate(simulationTimeStep = 1) {
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
    ocean.setFloat("simulationTimeStep", simulationTimeStep);
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
    deepOcean.setFloat("simulationTimeStep", simulationTimeStep);
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
    advection.setTexture("pressureForcingMap", 5, this.simulation.pressureForcing);
    advection.setFloat("waterLevel", waterLevel);
    advection.setFloat("rotationSpeed", this.getRotationSpeed());
    advection.setFloat("globalCirculation", this.getGlobalCirculation());
    advection.setFloat("solarIrradiance", this.getSolarIrradiance());
    advection.setFloat("solarDeclination", this.getSolarDeclination());
    advection.setFloat("simulationTimeStep", simulationTimeStep);
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
    render.setTexture("pressureMap", 7, this.simulation.pressure[1 - this.pingPongIndex]);
    render.setTexture("climateZoneMap", 8, this.simulation.climateZones);
    render.setTexture("oceanCurrentMap", 9, this.simulation.oceanCurrent[1 - this.pingPongIndex]);
    render.setTexture("deepOceanState", 10, this.simulation.deepOceanState[1 - this.pingPongIndex]);
    const monthlyClimate = this.viewMode === 10
      ? this.simulation.monthlyPrecipitation
      : this.simulation.monthlyTemperature;
    render.setTexture("monthlyClimate0", 11, monthlyClimate[0]);
    render.setTexture("monthlyClimate1", 12, monthlyClimate[1]);
    render.setTexture("monthlyClimate2", 13, monthlyClimate[2]);
    render.setFloat("waterLevel", this.getWaterLevel());
    render.setInteger(
      "climatologyMonthsAvailable",
      this.monthlySampleCounts.filter((count) => count > 0).length,
    );
    render.setInteger("viewMode", this.viewMode);
    render.setInteger("grayscale", Number(this.controls.grayscale.checked));
    this.meshes.fullscreen.draw();

    this.drawOverlays();
    this.magnifier.refresh();
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

