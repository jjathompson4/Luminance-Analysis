const state = {
  sessionId: null,
  width: 0,
  height: 0,
  scaleX: 1,
  scaleY: 1,
  calibrating: false,
  dragging: false,
  dragStart: null,
  dragCurrent: null,
  falseColor: false,
  lastGamma: 2.2,
  pixelTags: [],
  roiTags: [],
  histogramChart: null,
  loadingCount: 0,
};

const elements = {
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  imageWrapper: document.getElementById("imageWrapper"),
  hdrImage: document.getElementById("hdrImage"),
  imagePlaceholder: document.getElementById("imagePlaceholder"),
  overlay: document.getElementById("overlay"),
  calibrateButton: document.getElementById("calibrateButton"),
  clearTags: document.getElementById("clearTags"),
  showHistogram: document.getElementById("showHistogram"),
  calibrationStatus: document.getElementById("calibrationStatus"),
  luminanceStats: document.getElementById("luminanceStats"),
  fileName: document.getElementById("fileName"),
  fileDimensions: document.getElementById("fileDimensions"),
  gammaSlider: document.getElementById("gammaSlider"),
  gammaValue: document.getElementById("gammaValue"),
  exposureSlider: document.getElementById("exposureSlider"),
  exposureValue: document.getElementById("exposureValue"),
  srgbCheckbox: document.getElementById("srgbCheckbox"),
  falsecolorCheckbox: document.getElementById("falsecolorCheckbox"),
  falsecolorControls: document.getElementById("falsecolorControls"),
  colormapSelect: document.getElementById("colormapSelect"),
  falsecolorMin: document.getElementById("falsecolorMin"),
  falsecolorMax: document.getElementById("falsecolorMax"),
  displayScale: document.getElementById("displayScale"),
  colorbarContainer: document.getElementById("colorbarContainer"),
  colorbarImage: document.getElementById("colorbarImage"),
  annotationList: document.getElementById("annotationList"),
  histogramDialog: document.getElementById("histogramDialog"),
  histogramChartCanvas: document.getElementById("histogramChart"),
  histogramMode: document.getElementsByName("histogramMode"),
  toast: document.getElementById("toast"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
};

const overlayCtx = elements.overlay.getContext("2d");
let toastTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  updateCalibrationStatus(false);
  renderAnnotationList();
  requestAnimationFrame(drawOverlay);
});

elements.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) handleFileUpload(file);
});

bindDragAndDrop(elements.dropZone);
bindDragAndDrop(elements.imageWrapper);

elements.gammaSlider.addEventListener("input", handleGammaChange);
elements.exposureSlider.addEventListener("input", handleExposureChange);
elements.srgbCheckbox.addEventListener("change", handleSrgbToggle);
elements.falsecolorCheckbox.addEventListener("change", handleFalsecolorToggle);
elements.colormapSelect.addEventListener("change", requestRender);
elements.falsecolorMin.addEventListener("change", handleFalsecolorRange);
elements.falsecolorMax.addEventListener("change", handleFalsecolorRange);
elements.displayScale.addEventListener("change", updateColorbarVisibility);
elements.calibrateButton.addEventListener("click", beginCalibration);
elements.clearTags.addEventListener("click", clearAllTags);
elements.showHistogram.addEventListener("click", openHistogram);
elements.hdrImage.addEventListener("load", syncOverlayDimensions);
window.addEventListener("resize", syncOverlayDimensions);

elements.overlay.addEventListener("pointerdown", onPointerDown);
elements.overlay.addEventListener("pointermove", onPointerMove);
elements.overlay.addEventListener("pointerup", onPointerUp);
elements.overlay.addEventListener("pointerleave", onPointerUp);

elements.histogramMode.forEach((input) => {
  input.addEventListener("change", () => {
    if (!state.sessionId || !elements.histogramDialog.open) return;
    loadHistogram(input.value);
  });
});

elements.histogramDialog.addEventListener("close", () => {
  if (state.histogramChart) {
    state.histogramChart.destroy();
    state.histogramChart = null;
  }
});

function bindDragAndDrop(target) {
  if (!target) return;
  target.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDragState(true);
  });
  target.addEventListener("dragleave", (event) => {
    event.preventDefault();
    if (!event.relatedTarget || !target.contains(event.relatedTarget)) {
      setDragState(false);
    }
  });
  target.addEventListener("drop", (event) => {
    event.preventDefault();
    setDragState(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });
}

function setDragState(active) {
  if (active) {
    elements.dropZone?.classList.add("active");
    elements.imageWrapper?.classList.add("dragging");
  } else {
    elements.dropZone?.classList.remove("active");
    elements.imageWrapper?.classList.remove("dragging");
  }
}

async function handleFileUpload(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);

  disableControls();
  setLoading(true, "Uploading image…");

  try {
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Upload failed (${response.status})`);
    }
    const data = await response.json();
    state.sessionId = data.sessionId;
    state.width = data.width;
    state.height = data.height;
    state.pixelTags = [];
    state.roiTags = [];
    state.calibrating = false;
    elements.gammaSlider.value = 2.2;
    elements.exposureSlider.value = 6;
    elements.gammaValue.textContent = "2.2";
    elements.exposureValue.textContent = "6";
    elements.srgbCheckbox.checked = false;
    state.falseColor = false;
    elements.falsecolorCheckbox.checked = false;
    elements.falsecolorControls.classList.add("hidden");
    elements.falsecolorMin.value = "0";
    elements.falsecolorMax.value = "1000";
    elements.displayScale.checked = true;
    elements.gammaSlider.disabled = false;
    elements.exposureSlider.disabled = false;
    elements.calibrateButton.disabled = false;
    elements.clearTags.disabled = false;
    elements.showHistogram.disabled = false;
    elements.fileName.textContent = data.filename;
    elements.fileDimensions.textContent = `${data.width.toLocaleString()} × ${data.height.toLocaleString()}`;
    updateStats(data.stats);
    updateCalibrationStatus(false);
    elements.imagePlaceholder.classList.add("hidden");
    renderAnnotationList();
    await requestRender(true);
    showToast("Image loaded successfully", "success");
  } catch (error) {
    console.error(error);
    showToast(`Failed to load image: ${error.message}`, "error");
  } finally {
    enableControls();
    setLoading(false);
  }
}

function disableControls() {
  elements.calibrateButton.disabled = true;
  elements.clearTags.disabled = true;
  elements.showHistogram.disabled = true;
}

function enableControls() {
  if (!state.sessionId) return;
  elements.calibrateButton.disabled = false;
  elements.clearTags.disabled = false;
  elements.showHistogram.disabled = false;
  if (!state.falseColor) {
    elements.exposureSlider.disabled = false;
    if (!elements.srgbCheckbox.checked) {
      elements.gammaSlider.disabled = false;
    }
  }
}

function handleGammaChange(event) {
  state.lastGamma = parseFloat(event.target.value);
  elements.gammaValue.textContent = state.lastGamma.toFixed(1);
  requestRender();
}

function handleExposureChange(event) {
  elements.exposureValue.textContent = event.target.value;
  requestRender();
}

function handleSrgbToggle(event) {
  const useSrgb = event.target.checked;
  const currentGamma = parseFloat(elements.gammaSlider.value);
  if (useSrgb) {
    state.lastGamma = Number.isFinite(currentGamma) ? currentGamma : state.lastGamma;
    elements.gammaSlider.disabled = true;
    elements.gammaSlider.value = 2.4;
    elements.gammaValue.textContent = "2.4";
  } else {
    elements.gammaSlider.disabled = state.falseColor;
    elements.gammaSlider.value = state.lastGamma.toFixed(1);
    elements.gammaValue.textContent = parseFloat(elements.gammaSlider.value).toFixed(1);
  }
  requestRender();
}

function handleFalsecolorToggle(event) {
  state.falseColor = event.target.checked;
  elements.falsecolorControls.classList.toggle("hidden", !state.falseColor);
  elements.exposureSlider.disabled = state.falseColor;
  elements.gammaSlider.disabled = state.falseColor || elements.srgbCheckbox.checked;
  updateColorbarVisibility();
  requestRender();
}

function handleFalsecolorRange() {
  const minVal = parseFloat(elements.falsecolorMin.value);
  const maxVal = parseFloat(elements.falsecolorMax.value);
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return;
  if (maxVal <= minVal) {
    elements.falsecolorMax.value = (minVal + 0.1).toFixed(1);
  }
  requestRender();
}

function updateColorbarVisibility() {
  const show = state.falseColor && elements.displayScale.checked;
  elements.colorbarContainer.classList.toggle("hidden", !show);
}

async function requestRender(initial = false) {
  if (!state.sessionId) return;
  const payload = {
    sessionId: state.sessionId,
    exposure: parseFloat(elements.exposureSlider.value),
    gamma: parseFloat(elements.gammaSlider.value),
    useSrgb: elements.srgbCheckbox.checked,
    falseColor: state.falseColor,
    colormap: elements.colormapSelect.value,
    falsecolorMin: parseFloat(elements.falsecolorMin.value),
    falsecolorMax: parseFloat(elements.falsecolorMax.value),
  };

  if (!initial) {
    setLoading(true, state.falseColor ? "Updating false-color view…" : "Updating preview…");
  }

  try {
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Render failed (${response.status})`);
    }
    const data = await response.json();
    elements.hdrImage.src = data.image;
    if (data.colorbar && state.falseColor && elements.displayScale.checked) {
      elements.colorbarImage.src = data.colorbar;
      elements.colorbarContainer.classList.remove("hidden");
    } else {
      elements.colorbarContainer.classList.add("hidden");
    }
  } catch (error) {
    console.error(error);
    showToast(`Failed to render image: ${error.message}`, "error");
  } finally {
    setLoading(false);
  }
}

function syncOverlayDimensions() {
  if (!state.sessionId || !elements.hdrImage.complete) return;
  const displayWidth = elements.hdrImage.clientWidth || elements.hdrImage.naturalWidth;
  const displayHeight = elements.hdrImage.clientHeight || elements.hdrImage.naturalHeight;
  if (!displayWidth || !displayHeight) return;
  elements.overlay.width = displayWidth;
  elements.overlay.height = displayHeight;
  elements.overlay.style.width = `${displayWidth}px`;
  elements.overlay.style.height = `${displayHeight}px`;
  state.scaleX = state.width / displayWidth;
  state.scaleY = state.height / displayHeight;
  drawOverlay();
}

function toOriginalCoordinates(event) {
  const rect = elements.overlay.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const origX = Math.round(x * state.scaleX);
  const origY = Math.round(y * state.scaleY);
  return {
    displayX: x,
    displayY: y,
    origX: Math.max(0, Math.min(state.width - 1, origX)),
    origY: Math.max(0, Math.min(state.height - 1, origY)),
  };
}

function beginCalibration() {
  if (!state.sessionId) return;
  state.calibrating = true;
  showToast("Pick a pixel to calibrate and enter the known luminance", "info");
}

function clearAllTags() {
  state.pixelTags = [];
  state.roiTags = [];
  drawOverlay();
  renderAnnotationList();
  showToast("Annotations cleared", "success");
}

function onPointerDown(event) {
  if (!state.sessionId || !elements.hdrImage.complete) return;
  const coords = toOriginalCoordinates(event);
  if (state.calibrating) {
    handleCalibrationClick(coords);
    return;
  }
  state.dragging = true;
  state.dragStart = coords;
  state.dragCurrent = coords;
  elements.overlay.setPointerCapture(event.pointerId);
  drawOverlay();
}

function onPointerMove(event) {
  if (!state.dragging) return;
  state.dragCurrent = toOriginalCoordinates(event);
  drawOverlay();
}

function onPointerUp(event) {
  if (!state.dragging) return;
  if (elements.overlay.hasPointerCapture(event.pointerId)) {
    elements.overlay.releasePointerCapture(event.pointerId);
  }
  state.dragging = false;
  const endCoords = state.dragCurrent || state.dragStart;
  const start = state.dragStart;
  state.dragStart = null;
  state.dragCurrent = null;
  const movement = Math.hypot(endCoords.displayX - start.displayX, endCoords.displayY - start.displayY);
  if (movement < 5) {
    registerPixelTag(endCoords);
  } else {
    registerRoiTag(start, endCoords);
  }
}

async function registerPixelTag(coords) {
  try {
    const response = await fetch("/api/pixel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, x: coords.origX, y: coords.origY }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.pixelTags.push({ x: coords.origX, y: coords.origY, value: data.luminance });
    drawOverlay();
    renderAnnotationList();
    showToast(`Pixel luminance: ${data.luminance.toFixed(2)} cd/m²`, "info");
  } catch (error) {
    console.error(error);
    showToast(`Failed to lookup pixel luminance: ${error.message}`, "error");
  }
}

async function registerRoiTag(start, end) {
  try {
    const response = await fetch("/api/roi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        x0: start.origX,
        y0: start.origY,
        x1: end.origX,
        y1: end.origY,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.roiTags.push({
      x0: start.origX,
      y0: start.origY,
      x1: end.origX,
      y1: end.origY,
      value: data.mean,
    });
    drawOverlay();
    renderAnnotationList();
    showToast(`ROI mean luminance: ${data.mean.toFixed(2)} cd/m²`, "info");
  } catch (error) {
    console.error(error);
    showToast(`Failed to compute ROI luminance: ${error.message}`, "error");
  }
}

async function handleCalibrationClick(coords) {
  const input = prompt("Enter known luminance (cd/m²):");
  state.calibrating = false;
  if (input === null) return;
  const knownValue = parseFloat(input);
  if (!Number.isFinite(knownValue) || knownValue <= 0) {
    showToast("Please provide a positive number", "error");
    return;
  }
  try {
    const response = await fetch("/api/calibrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        x: coords.origX,
        y: coords.origY,
        knownValue,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    updateStats(data.stats);
    updateCalibrationStatus(true, data.scaleFactor);
    await requestRender(true);
    showToast(`Calibration applied (×${data.scaleFactor.toFixed(2)})`, "success");
  } catch (error) {
    console.error(error);
    showToast(`Calibration failed: ${error.message}`, "error");
  }
}

function updateStats(stats) {
  if (!stats) return;
  elements.luminanceStats.textContent = `Min=${stats.min.toFixed(1)} Max=${stats.max.toFixed(1)} Mean=${stats.mean.toFixed(1)}`;
}

function updateCalibrationStatus(calibrated, scale = 1.0) {
  if (calibrated) {
    elements.calibrationStatus.textContent = `Calibrated ×${scale.toFixed(2)}`;
    elements.calibrationStatus.classList.add("calibrated");
  } else {
    elements.calibrationStatus.textContent = "Not calibrated";
    elements.calibrationStatus.classList.remove("calibrated");
  }
}

function renderAnnotationList() {
  const list = elements.annotationList;
  if (!list) return;
  list.innerHTML = "";
  const entries = [];

  state.pixelTags.forEach((tag, index) => {
    entries.push({
      type: "Pixel",
      label: `(${tag.x}, ${tag.y})`,
      value: `${tag.value.toFixed(2)} cd/m²`,
      order: index,
    });
  });

  state.roiTags.forEach((tag, index) => {
    const xmin = Math.min(tag.x0, tag.x1);
    const xmax = Math.max(tag.x0, tag.x1);
    const ymin = Math.min(tag.y0, tag.y1);
    const ymax = Math.max(tag.y0, tag.y1);
    entries.push({
      type: "ROI",
      label: `(${xmin}, ${ymin}) → (${xmax}, ${ymax})`,
      value: `${tag.value.toFixed(2)} cd/m²`,
      order: index,
    });
  });

  if (!entries.length) {
    list.classList.add("empty");
    list.innerHTML = "<li>No annotations yet</li>";
    return;
  }

  list.classList.remove("empty");
  entries.forEach((entry) => {
    const item = document.createElement("li");
    const title = document.createElement("div");
    title.textContent = `${entry.type}: ${entry.label}`;
    const value = document.createElement("span");
    value.textContent = entry.value;
    item.appendChild(title);
    item.appendChild(value);
    list.appendChild(item);
  });
}

function drawOverlay() {
  const canvas = elements.overlay;
  const ctx = overlayCtx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 112, 112, 0.95)";
  ctx.fillStyle = "rgba(255, 112, 112, 0.95)";
  ctx.font = "12px Inter, sans-serif";

  state.pixelTags.forEach((tag) => {
    const dx = (tag.x / state.width) * canvas.width;
    const dy = (tag.y / state.height) * canvas.height;
    ctx.beginPath();
    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(tag.value.toFixed(1), dx + 6, dy - 6);
  });

  ctx.strokeStyle = "rgba(90, 169, 248, 0.95)";
  ctx.fillStyle = "rgba(90, 169, 248, 0.95)";

  state.roiTags.forEach((tag) => {
    const x0 = (tag.x0 / state.width) * canvas.width;
    const y0 = (tag.y0 / state.height) * canvas.height;
    const x1 = (tag.x1 / state.width) * canvas.width;
    const y1 = (tag.y1 / state.height) * canvas.height;
    ctx.beginPath();
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.stroke();
    ctx.fillText(tag.value.toFixed(1), Math.max(x0, x1) + 6, Math.min(y0, y1) + 12);
  });

  if (state.dragging && state.dragStart && state.dragCurrent) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    const start = state.dragStart;
    const current = state.dragCurrent;
    const x0 = (start.origX / state.width) * canvas.width;
    const y0 = (start.origY / state.height) * canvas.height;
    const x1 = (current.origX / state.width) * canvas.width;
    const y1 = (current.origY / state.height) * canvas.height;
    ctx.beginPath();
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.stroke();
  }

  ctx.restore();
}

function openHistogram() {
  if (!state.sessionId) return;
  if (typeof elements.histogramDialog.showModal === "function") {
    elements.histogramDialog.showModal();
    const mode = [...elements.histogramMode].find((input) => input.checked)?.value ?? "calibrated";
    loadHistogram(mode);
  } else {
    showToast("Your browser does not support dialog elements", "error");
  }
}

async function loadHistogram(mode) {
  try {
    const response = await fetch(`/api/histogram?sessionId=${state.sessionId}&mode=${mode}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    renderHistogram(mode, data);
  } catch (error) {
    console.error(error);
    showToast(`Failed to load histogram: ${error.message}`, "error");
  }
}

function renderHistogram(mode, data) {
  const context = elements.histogramChartCanvas.getContext("2d");
  const points = data.bins.map((bin, idx) => ({ x: Math.max(bin, 1e-6), y: data.counts[idx] ?? 0 }));
  if (state.histogramChart) {
    state.histogramChart.destroy();
  }
  state.histogramChart = new Chart(context, {
    type: "line",
    data: {
      datasets: [
        {
          label: `${mode} luminance`,
          data: points,
          borderColor: "#5aa9f8",
          backgroundColor: "rgba(90, 169, 248, 0.15)",
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: false,
      scales: {
        x: {
          type: "logarithmic",
          title: { display: true, text: "Luminance (cd/m²)" },
          ticks: { color: "#9ba6bf" },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          title: { display: true, text: "Frequency" },
          ticks: { color: "#9ba6bf" },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function showToast(message, type = "info", duration = 4200) {
  const toast = elements.toast;
  if (!toast) return;
  toast.classList.remove("hidden", "success", "error");
  toast.textContent = message;
  if (type !== "info") toast.classList.add(type);
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show", "success", "error");
    toastTimer = null;
  }, duration);
}

function setLoading(active, message) {
  const overlay = elements.loadingOverlay;
  if (!overlay) return;
  if (active) {
    state.loadingCount += 1;
    if (message) elements.loadingText.textContent = message;
    overlay.classList.remove("hidden");
  } else {
    state.loadingCount = Math.max(0, state.loadingCount - 1);
    if (state.loadingCount === 0) {
      overlay.classList.add("hidden");
    }
  }
}
