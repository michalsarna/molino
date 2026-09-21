import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  originalPixels: null,   // Uint8ClampedArray of RGBA from original image
  origWidth: 0,
  origHeight: 0,
  processedDataURL: null, // base64 PNG of adjusted B&W image for server
  params: {},
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
  document.querySelectorAll(".step").forEach(s => s.classList.replace("active","hidden") || s.classList.add("hidden"));
  document.getElementById(`step-${n}`).classList.remove("hidden");
  document.getElementById(`step-${n}`).classList.add("active");

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
      state.origWidth  = img.naturalWidth;
      state.origHeight = img.naturalHeight;

      // Read original pixels at native resolution (capped at 1200 for perf)
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

// ── Image processing (client-side) ────────────────────────────────────────
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function adjustPixel(r, g, b, brightness, contrastFactor, invert) {
  // Grayscale (luma)
  let gray = 0.299 * r + 0.587 * g + 0.114 * b;
  // Brightness
  gray = clamp(gray + brightness);
  // Contrast
  gray = clamp(contrastFactor * (gray - 128) + 128);
  // Invert
  if (invert) gray = 255 - gray;
  return gray;
}

function updatePreview() {
  if (!state.originalPixels) return;

  const brightness = parseInt(ctrlBrightness.value);
  const contrast   = parseInt(ctrlContrast.value);
  const invert     = ctrlInvert.checked;
  valBrightness.textContent = brightness >= 0 ? `+${brightness}` : brightness;
  valContrast.textContent   = contrast >= 0 ? `+${contrast}` : contrast;

  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  const w = state.origWidth, h = state.origHeight;
  previewCanvas.width = w;
  previewCanvas.height = h;

  const src = state.originalPixels;
  const out = ctx.createImageData(w, h);
  const d = out.data;

  for (let i = 0; i < w * h; i++) {
    const si = i * 4;
    const gray = adjustPixel(src[si], src[si+1], src[si+2], brightness, contrastFactor, invert);
    d[si]   = gray;
    d[si+1] = gray;
    d[si+2] = gray;
    d[si+3] = 255;
  }

  ctx.putImageData(out, 0, 0);

  // Export as data URL for server
  state.processedDataURL = previewCanvas.toDataURL("image/png");
}

// ── Physical height auto-calc ─────────────────────────────────────────────
function updateHeightParam() {
  const aspect = state.origHeight / state.origWidth;
  pHeight.value = (parseFloat(pWidth.value) * aspect).toFixed(1);
}

// ── Collect params ────────────────────────────────────────────────────────
function collectParams() {
  return {
    width_mm:      parseFloat(pWidth.value),
    height_mm:     parseFloat(pHeight.value),
    aspect:        parseFloat(pWidth.value) / parseFloat(pHeight.value),
    bit_type:      document.getElementById("p-bit-type").value,
    bit_diameter:  parseFloat(document.getElementById("p-bit-dia").value),
    tip_angle:     parseFloat(document.getElementById("p-tip-angle").value),
    cut_depth:     parseFloat(document.getElementById("p-cut-depth").value),
    wood_thickness:parseFloat(document.getElementById("p-wood-thick").value),
    step_over:     parseFloat(document.getElementById("p-step-over").value),
    spindle_speed: parseInt(document.getElementById("p-spindle").value),
    feed_rate:     parseFloat(document.getElementById("p-feed").value),
    plunge_rate:   parseFloat(document.getElementById("p-plunge").value),
    safe_height:   parseFloat(document.getElementById("p-safe-h").value),
  };
}

// ── 3D Viewer ─────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, woodMesh;

function initViewer() {
  const container = document.getElementById("viewer");
  if (renderer) {
    renderer.dispose();
    container.innerHTML = "";
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181a1d);

  const w = container.clientWidth, h = container.clientHeight;
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 50000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.position.set(1, 2, 1.5);
  sun.castShadow = true;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc0d8ff, 0.3);
  fill.position.set(-1, 0.5, -1);
  scene.add(fill);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    const nw = container.clientWidth, nh = container.clientHeight;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
}

function buildWoodMesh(heightmap, rows, cols, params) {
  // Remove previous mesh
  if (woodMesh) { scene.remove(woodMesh); woodMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

  const W  = params.width_mm;
  const H  = params.height_mm;
  const D  = params.cut_depth;
  const TH = params.wood_thickness;

  // ── Top carved surface ────────────────────────────────────────────
  const topGeo = new THREE.BufferGeometry();
  const verts  = new Float32Array(rows * cols * 3);
  const uvArr  = new Float32Array(rows * cols * 2);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const idx  = i * cols + j;
      const x    = (j / (cols - 1)) * W;
      const y    = (i / (rows - 1)) * H;
      const depth = heightmap[idx] * D;
      const z    = TH - depth;
      verts[idx * 3]     = x;
      verts[idx * 3 + 1] = y;
      verts[idx * 3 + 2] = z;
      uvArr[idx * 2]     = j / (cols - 1);
      uvArr[idx * 2 + 1] = i / (rows - 1);
    }
  }

  const indices = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = (i + 1) * cols + j, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  topGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  topGeo.setAttribute("uv",       new THREE.BufferAttribute(uvArr, 2));
  topGeo.setIndex(indices);
  topGeo.computeVertexNormals();

  // Color the carved surface: lighter for shallow, darker for deep
  const colorArr = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows * cols; i++) {
    const t = heightmap[i]; // 0=uncut, 1=deepest
    // Wood tone: warm brown, gets darker with depth
    colorArr[i * 3]     = 0.68 - t * 0.22;  // R
    colorArr[i * 3 + 1] = 0.47 - t * 0.18;  // G
    colorArr[i * 3 + 2] = 0.22 - t * 0.08;  // B
  }
  topGeo.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));

  const topMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 20,
    side: THREE.FrontSide,
  });
  const topMesh = new THREE.Mesh(topGeo, topMat);

  // ── Wood base (solid box below carved surface) ────────────────────
  // Minimal base: just a box sitting below; carved part handled by top surface
  const baseGeo = new THREE.BoxGeometry(W, H, TH);
  baseGeo.translate(W / 2, H / 2, TH / 2 - TH);  // shift so top of box = z=0
  const baseMat = new THREE.MeshPhongMaterial({ color: 0xa0682a, shininess: 10 });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);

  woodMesh = new THREE.Group();
  woodMesh.add(baseMesh);
  woodMesh.add(topMesh);

  // Centre in view
  woodMesh.position.set(-W / 2, -H / 2, 0);
  scene.add(woodMesh);

  // Camera position
  const maxDim = Math.max(W, H, TH);
  camera.position.set(W * 0.6, -H * 1.1, maxDim * 1.4);
  camera.up.set(0, 0, 1);
  controls.target.set(0, 0, TH / 2);
  controls.update();
}

// ── API calls ─────────────────────────────────────────────────────────────
async function generatePreview() {
  const p = collectParams();
  state.params = p;

  loadingOverlay.classList.remove("hidden");

  const body = new FormData();
  body.append("image_data", state.processedDataURL);
  body.append("params", JSON.stringify({ aspect: p.width_mm / p.height_mm }));

  try {
    const res = await fetch("/api/preview", { method: "POST", body });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    initViewer();
    buildWoodMesh(data.heightmap, data.rows, data.cols, p);

    // Stats
    const stepOver = p.step_over;
    const xPasses = Math.ceil(p.width_mm / stepOver);
    const yPasses = Math.ceil(p.height_mm / stepOver);
    const totalLines = xPasses * yPasses;
    const timeMin = (totalLines * p.width_mm / p.feed_rate).toFixed(1);

    exportInfo.innerHTML =
      `Size: <b>${p.width_mm} × ${p.height_mm} mm</b> &nbsp;|&nbsp; ` +
      `Depth: <b>${p.cut_depth} mm</b> &nbsp;|&nbsp; ` +
      `Step: <b>${stepOver} mm</b> &nbsp;|&nbsp; ` +
      `~${yPasses} passes &nbsp;|&nbsp; ` +
      `Est. time: <b>~${timeMin} min</b>`;

  } catch (err) {
    alert("Error generating preview: " + err.message);
  } finally {
    loadingOverlay.classList.add("hidden");
  }
}

async function downloadFile(endpoint, filename) {
  const p = state.params;
  const body = new FormData();
  body.append("image_data", state.processedDataURL);
  body.append("params", JSON.stringify(p));

  const btn = endpoint.includes("stl") ? btnDlStl : btnDlGcode;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const res = await fetch(endpoint, { method: "POST", body });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Download failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = endpoint.includes("stl") ? "↓ Download STL" : "↓ Download G-code";
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadImage(fileInput.files[0]); });

ctrlBrightness.addEventListener("input", updatePreview);
ctrlContrast.addEventListener("input", updatePreview);
ctrlInvert.addEventListener("change", updatePreview);

pWidth.addEventListener("input", updateHeightParam);

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

btnDlStl.addEventListener("click", () => downloadFile("/api/download/stl", "molino_carve.stl"));
btnDlGcode.addEventListener("click", () => downloadFile("/api/download/gcode", "molino_carve.gcode"));
