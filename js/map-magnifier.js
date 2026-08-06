export class MapMagnifier {
  constructor(mainCanvas, lensCanvas, button, zoom = 3) {
    this.mainCanvas = mainCanvas;
    this.canvas = lensCanvas;
    this.button = button;
    this.context = lensCanvas.getContext("2d");
    this.zoom = zoom;
    this.enabled = false;
    this.ready = false;
    this.pointer = null;

    this.button.addEventListener("click", () => this.setEnabled(!this.enabled));
    this.mainCanvas.addEventListener("pointerenter", (event) => this.updatePointer(event));
    this.mainCanvas.addEventListener("pointermove", (event) => this.updatePointer(event));
    this.mainCanvas.addEventListener("pointerleave", () => this.hide());
  }

  setReady(ready) {
    this.ready = ready;
    this.button.disabled = !ready;
    if (!ready) this.setEnabled(false);
  }

  setEnabled(enabled) {
    if (enabled && !this.ready) return;
    this.enabled = enabled;
    this.button.setAttribute("aria-pressed", String(enabled));
    this.mainCanvas.classList.toggle("magnifier-enabled", enabled);
    const action = enabled ? "Disable" : "Enable";
    this.button.setAttribute("aria-label", `${action} map magnifier`);
    this.button.title = `${action} map magnifier`;
    if (!enabled) this.hide();
  }

  updatePointer(event) {
    if (!this.ready || !this.enabled || event.pointerType === "touch") {
      this.hide();
      return;
    }
    const bounds = this.mainCanvas.getBoundingClientRect();
    this.pointer = {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
    this.refresh();
  }

  refresh() {
    if (!this.ready || !this.enabled || !this.pointer || !this.context) return;

    this.canvas.hidden = false;
    const mapBounds = this.mainCanvas.getBoundingClientRect();
    const lensBounds = this.canvas.getBoundingClientRect();
    const halfWidth = lensBounds.width / 2;
    const halfHeight = lensBounds.height / 2;
    const inset = 4;
    const lensX = Math.min(
      mapBounds.width - halfWidth - inset,
      Math.max(halfWidth + inset, this.pointer.x),
    );
    const lensY = Math.min(
      mapBounds.height - halfHeight - inset,
      Math.max(halfHeight + inset, this.pointer.y),
    );
    this.canvas.style.left = `${lensX}px`;
    this.canvas.style.top = `${lensY}px`;
    this.canvas.style.transform = "translate(-50%, -50%)";

    const scaleX = this.mainCanvas.width / mapBounds.width;
    const scaleY = this.mainCanvas.height / mapBounds.height;
    const sourceWidth = lensBounds.width * scaleX / this.zoom;
    const sourceHeight = lensBounds.height * scaleY / this.zoom;
    const sourceX = Math.min(
      this.mainCanvas.width - sourceWidth,
      Math.max(0, this.pointer.x * scaleX - sourceWidth / 2),
    );
    const sourceY = Math.min(
      this.mainCanvas.height - sourceHeight,
      Math.max(0, this.pointer.y * scaleY - sourceHeight / 2),
    );

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";
    this.context.drawImage(
      this.mainCanvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
  }

  hide() {
    this.pointer = null;
    this.canvas.hidden = true;
  }
}
