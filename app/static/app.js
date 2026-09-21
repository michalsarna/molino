import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ── Constants ─────────────────────────────────────────────────────────────
const MM_PER_INCH = 25.4;

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  originalPixels: null,
  origWidth: 0,
  origHeight: 0,
  processedDataURL: null,
  params: {},
  units: "metric",   // "metric" | "imperial"
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const dropZone      = document.getElementById("drop-zone");
const fileInput     = document.getElementById("file-input");
const previewArea   = document.getElementById("preview-area");
const previewCanvas = document.getElementById("preview-canvas");
const ctx           = previewCanvas.getContext("2d");

const ctrlBrightness = document.getElementById("ctrl-brightness");
const ctrlContrast   = document.getElementById("ctrl-contrast");
const ctrlInvert     = document.getElementById("ctrl-invert");
const valBrightness  = document.getElementById("val-brightness");
const valContrast    = document.getElementById("val-contrast");

const btnNext1    = document.getElementById("btn-next-1");
const btnBack2    = document.getElementById("btn-back-2");
const btnGenerate = document.getElementById("btn-generate");
const btnBack3    = document.getElementById("btn-back-3");
const btnDlStl    = document.getElementById("btn-dl-stl");
const btnDlGcode  = document.getElementById("btn-dl-gcode");

const pWidth    = document.getElementById("p-width");
const pHeight   = document.getElementById("p-height");
const pBitType  = document.getElementById("p-bit-type");
const rowTip    = document.getElementById("row-tip-angle");
const loadingOverlay = document.getElementById("loading-overlay");
const exportInfo     = document.getElementById("export-info");

// ── Step navigation ───────────────────────────────────────────────────────
function showStep(n) {
  document.querySelectorAll(".step").forEach(s => {
    s.classList.remove("active");
    s.classList.add("hidden");
  });
  const target = document.getElementById(`step-${n}`);
  target.classList.remove("hidden");
  target.classList.add("active");
  document.querySelectorAll(".step-indicator").forEach(el => {
    const sn = parseInt(el.dataset.step);
    el.classList.toggle("active", sn === n);
    el.classList.toggle("done", sn < n);
  });
}

// ── Image loading ─────────────────────────────────────────────────────────
function loadImage(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxRes = 1200;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxRes) { h = Math.round(h * maxRes / w); w = maxRes; }
      if (h > maxRes) { w = Math.round(w * maxRes / h); h = maxRes; }

      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      tmp.getContext("2d").drawImage(img, 0, 0, w, h);
      state.originalPixels = tmp.getContext("2d").getImageData(0, 0, w, h).data;
      state.origWidth = w; state.origHeight = h;

      previewArea.classList.remove("hidden");
      dropZone.classList.add("hidden");
      updatePreview();
      btnNext1.disabled = false;
      updateHeightParam();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Image adjustments (client-side) ───────────────────────────────────────
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function updatePreview() {
  if (!state.originalPixels) return;

  const brightness   = parseInt(ctrlBrightness.value);
  const contrast     = parseInt(ctrlContrast.value);
  const invert       = ctrlInvert.checked;
  valBrightness.textContent = brightness >= 0 ? `+${brightness}` : brightness;
  valContrast.textContent   = contrast   >= 0 ? `+${contrast}`   : contrast;

  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const w = state.origWidth, h = state.origHeight;
  previewCanvas.width = w; previewCanvas.height = h;

  const src = state.originalPixels;
  const out = ctx.createImageData(w, h);
  const d   = out.data;

  for (let i = 0; i < w * h; i++) {
    const si = i * 4;
    let g = 0.299 * src[si] + 0.587 * src[si + 1] + 0.114 * src[si + 2];
    g = clamp(g + brightness);
    g = clamp(cf * (g - 128) + 128);
    if (invert) g = 255 - g;
    d[si] = d[si + 1] = d[si + 2] = g;
    d[si + 3] = 255;
  }

  ctx.putImageData(out, 0, 0);
  state.processedDataURL = previewCanvas.toDataURL("image/png");
}

// ── Unit system ───────────────────────────────────────────────────────────
const UNIT_LABELS = {
  metric:   { length: "(mm)",     rate: "(mm/min)" },
  imperial: { length: "(in)",     rate: "(in/min)" },
};

function toDisplay(mm, unitType) {
  return state.units === "imperial" ? mm / MM_PER_INCH : mm;
}

function toMM(displayVal, unitType) {
  return state.units === "imperial" ? displayVal * MM_PER_INCH : displayVal;
}

function formatDisplay(val, unitType) {
  return state.units === "imperial"
    ? val.toFixed(unitType === "rate" ? 3 : 5)
    : val.toFixed(unitType === "rate" ? 1 : 3);
}

function applyUnitLabels() {
  const labels = UNIT_LABELS[state.units];
  document.querySelectorAll(".unit-label").forEach(el => {
    const input = el.closest("label")?.querySelector("input[data-unit]");
    if (!input) return;
    el.textContent = labels[input.dataset.unit] ?? el.textContent;
  });
}

function switchUnits(newUnits) {
  if (newUnits === state.units) return;
  state.units = newUnits;

  // Convert all numeric inputs that carry a data-mm baseline
  document.querySelectorAll("input[data-unit]").forEach(el => {
    if (el.readOnly) return;
    const mm = parseFloat(el.dataset.mm ?? el.value);
    if (!isNaN(mm)) {
      el.value = formatDisplay(toDisplay(mm, el.dataset.unit), el.dataset.unit);
    }
  });

  applyUnitLabels();
  updateHeightParam();
}

// Keep data-mm in sync when user edits a field
function syncMM(el) {
  const display = parseFloat(el.value);
  if (!isNaN(display)) {
    el.dataset.mm = toMM(display, el.dataset.unit);
  }
}

// ── Height auto-calc ──────────────────────────────────────────────────────
function updateHeightParam() {
  if (!state.origWidth) return;
  const aspect = state.origHeight / state.origWidth;
  const widthMM = parseFloat(pWidth.dataset.mm ?? pWidth.value);
  const heightMM = widthMM * aspect;
  pHeight.dataset.mm = heightMM;
  pHeight.value = formatDisplay(toDisplay(heightMM, "length"), "length");
}

// ── Collect params (always in mm for the server) ──────────────────────────
function collectParams() {
  const mm = id => parseFloat(document.getElementById(id).dataset.mm ?? document.getElementById(id).value);

  return {
    width_mm:       mm("p-width"),
    height_mm:      parseFloat(pHeight.dataset.mm ?? pHeight.value),
    aspect:         mm("p-width") / (parseFloat(pHeight.dataset.mm ?? pHeight.value) || 1),
    bit_type:       pBitType.value,
    bit_diameter:   mm("p-bit-dia"),
    tip_angle:      parseFloat(document.getElementById("p-tip-angle").value),
    cut_depth:      mm("p-cut-depth"),
    wood_thickness: mm("p-wood-thick"),
    step_over:      mm("p-step-over"),
    spindle_speed:  parseInt(document.getElementById("p-spindle").value),
    feed_rate:      mm("p-feed"),
    plunge_rate:    mm("p-plunge"),
    safe_height:    mm("p-safe-h"),
    units:          state.units,
  };
}

// ── 3D Viewer ─────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, woodGroup;

function initViewer() {
  const container = document.getElementById("viewer");
  if (renderer) { renderer.dispose(); container.innerHTML = ""; }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181a1d);

  const w = container.clientWidth || 800, h = container.clientHeight || 480;
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 50000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Y-up (Three.js default) — no camera.up override
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 5;
  controls.maxDistance = 5000;

  // Lighting: key from upper-front-right, fill from left, ambient base
  scene.add(new THREE.AmbientLight(0xfff8f0, 0.5));
  const key = new THREE.DirectionalLight(0xfff5e0, 1.1);
  key.position.set(80, 150, 120);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd0e8ff, 0.4);
  fill.position.set(-100, 60, -80);
  scene.add(fill);

  const animate = () => { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
  animate();

  window.addEventListener("resize", () => {
    const nw = container.clientWidth, nh = container.clientHeight;
    if (!nw || !nh) return;
    camera.aspect = nw / nh; camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
}

function buildWoodMesh(heightmap, rows, cols, params) {
  if (woodGroup) {
    scene.remove(woodGroup);
    woodGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }

  // Coordinate system: Y-up (Three.js default)
  //   j (image column) → X axis
  //   i (image row)    → Z axis
  //   carving depth    → Y axis (up = uncut surface)
  const W  = params.width_mm;
  const Dz = params.height_mm;   // image height mapped to Z
  const CUT = params.cut_depth;
  const TH  = params.wood_thickness;

  // ── Carved top surface ────────────────────────────────────────────
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 3);
  const idx = [];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      // Centre geometry on origin for comfortable orbiting
      pos[k * 3]     = (j / (cols - 1)) * W - W / 2;    // X: [-W/2, W/2]
      pos[k * 3 + 1] = TH - heightmap[k] * CUT;          // Y: [TH-CUT, TH]
      pos[k * 3 + 2] = (i / (rows - 1)) * Dz - Dz / 2;  // Z: [-Dz/2, Dz/2]
      const t = heightmap[k];
      col[k * 3]     = 0.72 - t * 0.25;  // R
      col[k * 3 + 1] = 0.50 - t * 0.20;  // G
      col[k * 3 + 2] = 0.24 - t * 0.10;  // B
    }
  }

  // Winding for +Y normals in XZ surface:
  //   a,c,b gives normal = +Y  (verified: (C-A)×(B-A) = +Y)
  //   b,c,d gives normal = +Y
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1,
            c = (i + 1) * cols + j, d = c + 1;
      idx.push(a, c, b,  b, c, d);
    }
  }

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  topGeo.setAttribute("color",    new THREE.BufferAttribute(col, 3));
  topGeo.setIndex(idx);
  topGeo.computeVertexNormals();

  const topMesh = new THREE.Mesh(
    topGeo,
    new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 35, side: THREE.FrontSide })
  );

  // ── Solid wood base ───────────────────────────────────────────────
  // Full block from Y=0 to Y=TH; polygonOffset pushes it back so the
  // carved surface (Y≤TH) wins where they overlap (uncut areas at Y=TH).
  const baseGeo = new THREE.BoxGeometry(W, TH, Dz);
  const baseMat = new THREE.MeshPhongMaterial({
    color: 0x8b5a28,
    shininess: 8,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.set(0, TH / 2, 0);  // Y: 0 → TH

  woodGroup = new THREE.Group();
  woodGroup.add(baseMesh, topMesh);
  scene.add(woodGroup);

  // Camera: Y-up, 3/4 angle above the front edge
  const maxDim = Math.max(W, Dz, TH);
  camera.position.set(W * 0.55, TH + maxDim * 0.85, Dz * 0.9);
  controls.target.set(0, TH * 0.45, 0);
  controls.update();
}

// ── API calls (JSON body — no part-size limit) ────────────────────────────
async function apiPost(endpoint, params) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data: state.processedDataURL, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res;
}

async function generatePreview() {
  const p = collectParams();
  state.params = p;
  loadingOverlay.classList.remove("hidden");

  try {
    const res  = await apiPost("/api/preview", { aspect: p.width_mm / p.height_mm });
    const data = await res.json();

    initViewer();
    buildWoodMesh(data.heightmap, data.rows, data.cols, p);

    const stepOver = p.step_over;
    const yPasses  = Math.ceil(p.height_mm / stepOver);
    const timeMin  = (yPasses * p.width_mm / p.feed_rate).toFixed(1);
    const u        = state.units === "imperial";
    const fmt      = v => u ? (v / MM_PER_INCH).toFixed(3) + " in" : v.toFixed(1) + " mm";

    exportInfo.innerHTML =
      `Size: <b>${fmt(p.width_mm)} × ${fmt(p.height_mm)}</b> &nbsp;|&nbsp; ` +
      `Depth: <b>${fmt(p.cut_depth)}</b> &nbsp;|&nbsp; ` +
      `Step: <b>${fmt(stepOver)}</b> &nbsp;|&nbsp; ` +
      `~${yPasses} passes &nbsp;|&nbsp; Est: <b>~${timeMin} min</b>`;
  } catch (err) {
    alert("Error generating preview:\n" + err.message);
  } finally {
    loadingOverlay.classList.add("hidden");
  }
}

async function downloadFile(endpoint, filename) {
  const btn = endpoint.includes("stl") ? btnDlStl : btnDlGcode;
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const res  = await apiPost(endpoint, state.params);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Download failed:\n" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────
dropZone.addEventListener("dragover",  e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault(); dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadImage(fileInput.files[0]); });

ctrlBrightness.addEventListener("input", updatePreview);
ctrlContrast.addEventListener("input",   updatePreview);
ctrlInvert.addEventListener("change",    updatePreview);

pWidth.addEventListener("input", () => { syncMM(pWidth); updateHeightParam(); });

// Sync data-mm on all editable unit-aware inputs
document.querySelectorAll("input[data-unit]:not([readonly])").forEach(el => {
  el.addEventListener("input", () => syncMM(el));
});

// Unit radio buttons
document.querySelectorAll('input[name="units"]').forEach(radio => {
  radio.addEventListener("change", () => switchUnits(radio.value));
});

pBitType.addEventListener("change", () => {
  rowTip.style.display = pBitType.value === "vbit" ? "" : "none";
});

btnNext1.addEventListener("click", () => showStep(2));
btnBack2.addEventListener("click", () => showStep(1));

btnGenerate.addEventListener("click", async () => {
  showStep(3);
  await generatePreview();
});

btnBack3.addEventListener("click", () => showStep(2));

btnDlStl.addEventListener("click",   () => downloadFile("/api/download/stl",   "molino_carve.stl"));
btnDlGcode.addEventListener("click", () => downloadFile("/api/download/gcode", "molino_carve.gcode"));
