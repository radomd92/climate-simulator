import {
  MONTHS,
  MONTH_ABBREVIATIONS,
  NORTHERN_MONTH_SEASONS,
  SOUTHERN_MONTH_SEASONS,
} from "./climate-catalog.js";

export class PointClimatePanel {
  constructor(documentRoot) {
    this.document = documentRoot;
    this.marker = documentRoot.querySelector("#map-selection-marker");
    this.clearButton = documentRoot.querySelector("#clear-map-selection");
    this.empty = documentRoot.querySelector("#map-interaction-hint");
    this.data = documentRoot.querySelector("#point-climate-data");
    this.coordinates = documentRoot.querySelector("#point-climate-coordinates");
    this.summary = documentRoot.querySelector("#point-climate-summary");
    this.type = documentRoot.querySelector("#point-climate-type");
    this.status = documentRoot.querySelector("#point-climate-status");
    this.temperatureChart = documentRoot.querySelector("#point-temperature-chart");
    this.precipitationChart = documentRoot.querySelector("#point-precipitation-chart");
    this.values = documentRoot.querySelector("#point-climate-values");
  }

  renderTable(temperatures, precipitation, available, latitude) {
    const localSeasons = latitude >= 0
      ? NORTHERN_MONTH_SEASONS
      : SOUTHERN_MONTH_SEASONS;
    const rows = MONTHS.map((month, index) => {
      const row = this.document.createElement("tr");
      const values = [
        month,
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
    this.values.replaceChildren(...rows);
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

    const chart = this.temperatureChart;
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
        content.push(`<circle class="point-chart-temperature-point" cx="${geometry.x[index]}" cy="${y}" r="3.5"><title>${MONTHS[index]}: ${value.toFixed(1)} °C</title></circle>`);
      } else {
        content.push(this.renderMissingChartPoint(geometry.x[index], geometry));
      }
    });
    content.push(this.renderPointChartMonthLabels(geometry));
    chart.innerHTML = content.join("");
    chart.setAttribute(
      "aria-label",
      `Monthly mean temperature: ${this.formatChartAriaValues(values, available, "degrees Celsius")}`,
    );
  }

  renderPrecipitationChart(values, available) {
    const validValues = values.filter((value, index) => available[index]);
    const rawMaximum = validValues.length ? Math.max(...validValues) : 10;
    const maximum = Math.max(10, Math.ceil(rawMaximum / 10) * 10);
    const chart = this.precipitationChart;
    const geometry = this.getPointChartGeometry();
    const content = this.renderPointChartGrid(0, maximum, geometry);
    const barWidth = (geometry.x[1] - geometry.x[0]) * 0.68;

    values.forEach((value, index) => {
      if (available[index]) {
        const barHeight = Math.max(1, value / maximum * geometry.height);
        const y = geometry.bottom - barHeight;
        content.push(`<rect class="point-chart-precipitation-bar" x="${geometry.x[index] - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2"><title>${MONTHS[index]}: ${value.toFixed(1)} cm</title></rect>`);
      } else {
        content.push(this.renderMissingChartPoint(geometry.x[index], geometry));
      }
    });
    content.push(this.renderPointChartMonthLabels(geometry));
    chart.innerHTML = content.join("");
    chart.setAttribute(
      "aria-label",
      `Monthly precipitation: ${this.formatChartAriaValues(values, available, "centimeters")}`,
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
      x: MONTHS.map((_, index) => left + (right - left) * index / (MONTHS.length - 1)),
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

  renderPointChartMonthLabels(geometry) {
    return MONTH_ABBREVIATIONS.map((label, index) => `<text class="point-chart-label point-chart-month-label" x="${geometry.x[index]}" y="177" text-anchor="middle">${label}</text>`).join("");
  }

  renderMissingChartPoint(x, geometry) {
    return `<text class="point-chart-missing" x="${x}" y="${geometry.bottom - 8}" text-anchor="middle">…</text>`;
  }

  formatChartAriaValues(values, available, unit) {
    return MONTHS.map((month, index) => available[index]
      ? `${month} ${values[index].toFixed(1)} ${unit}`
      : `${month} collecting`).join(", ");
  }

}
