import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ── Constants ─────────────────────────────────────────────────────────────
const MM_PER_INCH = 25.4;

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  originalPixels: null,
  origWidth: 0,
  origHeight: 0,
  params: {},
  units: "metric",   // "metric" | "imperial"
  version: "0.00",
  previewGenerated: false,
  originalFileName: "",
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
const ctrlFlipH      = document.getElementById("ctrl-flip-h");
const ctrlFlipV      = document.getElementById("ctrl-flip-v");
const valBrightness  = document.getElementById("val-brightness");
const valContrast    = document.getElementById("val-contrast");
const ctrlNoCut      = document.getElementById("ctrl-nocut");
const ctrlMaxCut     = document.getElementById("ctrl-maxcut");
const valNoCut       = document.getElementById("val-nocut");
const valMaxCut      = document.getElementById("val-maxcut");
const legendBar      = document.getElementById("legend-bar");

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
const ctrlToolPath   = document.getElementById("ctrl-toolpath");

// ── Step navigation ───────────────────────────────────────────────────────
function showStep(n) {
  document.querySelectorAll(".step").forEach(s => s.classList.toggle("active", s.id === `step-${n}`));
  document.querySelectorAll(".step-indicator").forEach(el => {
    const sn = parseInt(el.dataset.step);
    el.classList.toggle("active", sn === n);
    el.classList.toggle("done", sn < n);
  });
}

// ── Image loading ─────────────────────────────────────────────────────────
function loadImage(file) {
  state.originalFileName = file.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]/gu, "_");
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
      state.previewGenerated = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Image adjustments (client-side) ───────────────────────────────────────
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// Coalesce rapid slider events into one redraw per frame
let previewRaf = 0;
function schedulePreview() {
  if (previewRaf) return;
  previewRaf = requestAnimationFrame(() => { previewRaf = 0; updatePreview(); });
}

function updatePreview() {
  if (!state.originalPixels) return;

  const brightness = parseInt(ctrlBrightness.value);
  const contrast   = parseInt(ctrlContrast.value);
  const invert     = ctrlInvert.checked;
  const flipH      = ctrlFlipH.checked;
  const flipV      = ctrlFlipV.checked;
  valBrightness.textContent = brightness >= 0 ? `+${brightness}` : brightness;
  valContrast.textContent   = contrast   >= 0 ? `+${contrast}`   : contrast;

  // Levels. Handles are in "darkness" (0 = white, 255 = black) to match the bar's direction;
  // gray >= white is no cut, gray <= black is max cut, linear in between.
  const dNoCut = parseInt(ctrlNoCut.value), dMaxCut = parseInt(ctrlMaxCut.value);
  const white  = 255 - dNoCut, black = 255 - dMaxCut;
  const lvScale = 255 / (white - black);
  valNoCut.textContent  = `≥ ${white}`;
  valMaxCut.textContent = `≤ ${black}`;
  legendBar.style.background =
    `linear-gradient(to right, #fff ${dNoCut / 2.55}%, #000 ${dMaxCut / 2.55}%)`;

  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const w = state.origWidth, h = state.origHeight;
  previewCanvas.width = w; previewCanvas.height = h;

  const src = state.originalPixels;
  const out = ctx.createImageData(w, h);
  const d   = out.data;

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const srcR = flipV ? h - 1 - r : r;
      const srcC = flipH ? w - 1 - c : c;
      const si = (srcR * w + srcC) * 4;
      const di = (r * w + c) * 4;
      let g = 0.299 * src[si] + 0.587 * src[si + 1] + 0.114 * src[si + 2];
      g = clamp(g + brightness);
      g = clamp(cf * (g - 128) + 128);
      if (invert) g = 255 - g;
      g = clamp((g - black) * lvScale);
      d[di] = d[di + 1] = d[di + 2] = g;
      d[di + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
}

// ── Unit system ───────────────────────────────────────────────────────────
const UNIT_LABELS = {
  metric:   { length: "(mm)",     rate: "(mm/min)" },
  imperial: { length: "(in)",     rate: "(in/min)" },
};

function toDisplay(mm) {
  return state.units === "imperial" ? mm / MM_PER_INCH : mm;
}

function toMM(displayVal) {
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
      el.value = formatDisplay(toDisplay(mm), el.dataset.unit);
    }
  });

  applyUnitLabels();
  updateHeightParam();
}

// Keep data-mm in sync when user edits a field
function syncMM(el) {
  const display = parseFloat(el.value);
  if (!isNaN(display)) {
    el.dataset.mm = toMM(display);
  }
}

// ── Height auto-calc ──────────────────────────────────────────────────────
function updateHeightParam() {
  if (!state.origWidth) return;
  const aspect = state.origHeight / state.origWidth;
  const widthMM = parseFloat(pWidth.dataset.mm ?? pWidth.value);
  const heightMM = widthMM * aspect;
  pHeight.dataset.mm = heightMM;
  pHeight.value = formatDisplay(toDisplay(heightMM), "length");
}

// ── Collect params (always in mm for the server) ──────────────────────────
function collectParams() {
  const mm = id => parseFloat(document.getElementById(id).dataset.mm ?? document.getElementById(id).value);

  return {
    width_mm:       mm("p-width"),
    height_mm:      parseFloat(pHeight.dataset.mm ?? pHeight.value),
    bit_type:       pBitType.value,
    bit_diameter:   mm("p-bit-dia"),
    tip_angle:      parseFloat(document.getElementById("p-tip-angle").value),
    cut_depth:      mm("p-cut-depth"),
    wood_thickness: mm("p-wood-thick"),
    step_over:      mm("p-step-over"),
    depth_per_pass: mm("p-depth-per-pass"),
    spindle_speed:  parseInt(document.getElementById("p-spindle").value),
    feed_rate:      mm("p-feed"),
    plunge_rate:    mm("p-plunge"),
    rapid_rate:     mm("p-rapid"),
    safe_height:    mm("p-safe-h"),
    retract_height: mm("p-retract"),
    units:          state.units,
    origin:         document.querySelector('input[name="origin"]:checked').value,
  };
}

// ── 3D Viewer ─────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, woodGroup, toolPath, viewerRaf = 0;

window.addEventListener("resize", () => {
  if (!renderer) return;
  const container = document.getElementById("viewer");
  const nw = container.clientWidth, nh = container.clientHeight;
  if (!nw || !nh) return;
  camera.aspect = nw / nh; camera.updateProjectionMatrix();
  renderer.setSize(nw, nh);
});

function initViewer() {
  const container = document.getElementById("viewer");
  if (renderer) {
    cancelAnimationFrame(viewerRaf);
    controls.dispose();
    renderer.dispose();
    container.innerHTML = "";
  }

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

  const animate = () => {
    viewerRaf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
}

function buildWoodMesh(heightmap, pathHeightmap, toolpath, rows, cols, params) {
  if (woodGroup) {
    scene.remove(woodGroup);
    woodGroup.traverse(o => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
    woodGroup = null;
  }
  if (toolPath) {
    toolPath.traverse(o => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
    toolPath = null;
  }

  // Y-up coordinate system (Three.js default):
  //   j (image column) → X axis  [-W/2, W/2]
  //   i (image row)    → Z axis  [-Dz/2, Dz/2]
  //   carving depth    → Y axis  (Y=TH → uncut top, Y=TH-CUT → deepest cut)
  const MARGIN = 5; // uncarved border in mm on each side
  let W   = params.width_mm;
  let Dz  = params.height_mm;
  const CUT = params.cut_depth;
  const TH  = params.wood_thickness;

  // Pad heightmap with uncarved border so the carved image floats inside the wood block.
  // srcRows/srcCols and mi/mj are kept so the tool path can address the unpadded grid.
  const srcRows = rows, srcCols = cols;
  let mi, mj;
  {
    const pxX = W  / Math.max(cols - 1, 1);
    const pxZ = Dz / Math.max(rows - 1, 1);
    mj  = Math.max(1, Math.round(MARGIN / pxX));
    mi  = Math.max(1, Math.round(MARGIN / pxZ));
    const nc  = cols + 2 * mj;
    const nr  = rows + 2 * mi;
    const pad = new Float32Array(nc * nr); // zeros = no cut
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        pad[(i + mi) * nc + (j + mj)] = heightmap[i * cols + j];
    heightmap = pad;
    cols = nc; rows = nr;
    W  += 2 * MARGIN;
    Dz += 2 * MARGIN;
  }

  const xAt = j => (j / (cols - 1)) * W  - W  / 2;
  // Z reversed so image top (high row index) maps to –Z (far side from camera),
  // matching the original photo orientation when viewed from the default camera angle.
  const zAt = i => Dz / 2 - (i / (rows - 1)) * Dz;
  const yAt = (i, j) => TH - heightmap[i * cols + j] * CUT;

  const woodMat  = new THREE.MeshPhongMaterial({ color: 0x7a4f21, shininess: 6 });
  const carveMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 35 });

  woodGroup = new THREE.Group();

  // ── 1. Carved top surface (XZ plane, +Y normals) ─────────────────
  {
    const n   = rows * cols;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const idx = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const k = i * cols + j;
        pos[k * 3]     = xAt(j);
        pos[k * 3 + 1] = yAt(i, j);
        pos[k * 3 + 2] = zAt(i);
        const t = heightmap[k];
        col[k * 3]     = 0.72 - t * 0.28;
        col[k * 3 + 1] = 0.50 - t * 0.22;
        col[k * 3 + 2] = 0.24 - t * 0.12;
      }
    }
    // With reversed zAt, Z decreases as i increases → winding a,b,c / b,d,c gives +Y normals
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j, b = a + 1, c = (i + 1) * cols + j, d = c + 1;
        idx.push(a, b, c,  b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    woodGroup.add(new THREE.Mesh(geo, carveMat));
  }

  // ── 2. Bottom face (Y=0, -Y normal) ─────────────────────────────
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      -W/2, 0, -Dz/2,   W/2, 0, -Dz/2,   W/2, 0,  Dz/2,  -W/2, 0,  Dz/2,
    ]), 3));
    geo.setIndex([0, 1, 2,  0, 2, 3]);   // -Y normal
    geo.computeVertexNormals();
    woodGroup.add(new THREE.Mesh(geo, woodMat));
  }

  // ── 3. Side walls: top edge follows carved surface, bottom at Y=0 ─
  // addWall(topPts, winding) where:
  //   topPts = [{x,y,z}] ordered along the edge
  //   '+' winding → indices (a,c,d / a,d,b)
  //   '-' winding → indices (a,b,d / a,d,c)
  // Verified windings:
  //   Front (Z=-Dz/2, -Z outward): '-'   Back  (Z=+Dz/2, +Z outward): '+'
  //   Left  (X=-W/2,  -X outward): '+'   Right (X=+W/2,  +X outward): '-'
  function addWall(topPts, winding) {
    const n = topPts.length;
    const flat = [];
    for (const p of topPts)  flat.push(p.x, p.y, p.z);       // top row
    for (const p of topPts)  flat.push(p.x, 0,   p.z);       // bottom row
    const idx = [];
    for (let k = 0; k < n - 1; k++) {
      const a = k, b = k + 1, c = n + k, d = n + k + 1;
      if (winding === "+") idx.push(a, c, d,  a, d, b);
      else                  idx.push(a, b, d,  a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(flat), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    woodGroup.add(new THREE.Mesh(geo, woodMat));
  }

  // With reversed zAt: i=0 → Z=+Dz/2, i=rows-1 → Z=-Dz/2
  // Windings updated so outward normals remain correct after the Z-axis reversal.
  // Front wall  (i=0,      Z=+Dz/2, outward +Z)
  addWall(Array.from({ length: cols }, (_, j) => ({ x: xAt(j),  y: yAt(0,      j), z:  Dz / 2 })), "+");
  // Back wall   (i=rows-1, Z=-Dz/2, outward -Z)
  addWall(Array.from({ length: cols }, (_, j) => ({ x: xAt(j),  y: yAt(rows-1, j), z: -Dz / 2 })), "-");
  // Left wall   (j=0,      X=-W/2,  outward -X) — Z now decreases as i increases
  addWall(Array.from({ length: rows }, (_, i) => ({ x: -W / 2,  y: yAt(i, 0),      z: zAt(i)  })), "-");
  // Right wall  (j=cols-1, X=+W/2,  outward +X) — Z now decreases as i increases
  addWall(Array.from({ length: rows }, (_, i) => ({ x:  W / 2,  y: yAt(i, cols-1), z: zAt(i)  })), "+");

  scene.add(woodGroup);

  // ── 4. Planned tool path: red = cutting, blue = link through a finished groove, grey = rapid ──
  // Polylines arrive as [pass_max, x0, y0, x1, y1, ...] in stock mm; expand each row-wise span
  // per pixel so the line follows the surface, lifted 0.15 mm to avoid z-fighting.
  {
    const xsSrc = params.width_mm  / Math.max(srcCols - 1, 1);
    const ysSrc = params.height_mm / Math.max(srcRows - 1, 1);
    const colOf = x => Math.min(srcCols - 1, Math.max(0, Math.round(x / xsSrc)));
    const rowOf = y => Math.min(srcRows - 1, Math.max(0, Math.round(y / ysSrc)));
    const tipY  = (i, j, pmax) => TH - Math.min(pathHeightmap[i * srcCols + j] * CUT, pmax) + 0.15;

    const expand = polys => {
      const out = [];
      for (const poly of polys) {
        const pmax = poly[0];
        for (let v = 1; v + 3 < poly.length; v += 2) {
          const ia = rowOf(poly[v + 1]), ib = rowOf(poly[v + 3]);
          const ja = colOf(poly[v]),     jb = colOf(poly[v + 2]);
          if (ia === ib) {
            const s = jb >= ja ? 1 : -1;
            for (let j = ja; j !== jb; j += s)
              out.push(xAt(j + mj),     tipY(ia, j,     pmax), zAt(ia + mi),
                       xAt(j + s + mj), tipY(ia, j + s, pmax), zAt(ia + mi));
          } else {
            out.push(xAt(ja + mj), tipY(ia, ja, pmax), zAt(ia + mi),
                     xAt(jb + mj), tipY(ib, jb, pmax), zAt(ib + mi));
          }
        }
      }
      return out;
    };
    const hopY = TH + params.retract_height;
    const hops = [];
    for (const [xa, ya, xb, yb] of toolpath.hops)
      hops.push(xAt(colOf(xa) + mj), hopY, zAt(rowOf(ya) + mi),
                xAt(colOf(xb) + mj), hopY, zAt(rowOf(yb) + mi));

    toolPath = new THREE.Group();
    for (const [flat, color] of [[expand(toolpath.cuts), 0xff2020],
                                 [expand(toolpath.links), 0x3b9cff],
                                 [hops, 0xb0b0b0]]) {
      if (!flat.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(flat), 3));
      toolPath.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color })));
    }
    toolPath.visible = ctrlToolPath.checked;
    scene.add(toolPath);
  }

  // ── 5. Work-origin marker on the stock top: dot at X0 Y0, +X red, +Y green ──
  {
    const [oy, ox] = params.origin.split("-");
    const W0 = params.width_mm, H0 = params.height_mm;
    const fx = { left: 0, center: 0.5, right: 1 }[ox];
    const fy = { bottom: 0, middle: 0.5, top: 1 }[oy];
    // Interpolate along the unpadded grid so the marker lands exactly on the stock edge
    const wx = xAt(mj) + fx * (xAt(mj + srcCols - 1) - xAt(mj));
    const wz = zAt(mi) + fy * (zAt(mi + srcRows - 1) - zAt(mi));
    const len = Math.min(W0, H0) * 0.15;

    const axis = (dx, dz, color) => new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(dx, 0, dz)]),
      new THREE.LineBasicMaterial({ color }));
    const marker = new THREE.Group();
    marker.add(new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, len * 0.08), 12, 8),
                              new THREE.MeshBasicMaterial({ color: 0x40d0ff })));
    marker.add(axis(len, 0, 0xff4040));   // machine +X
    marker.add(axis(0, -len, 0x40ff40));  // machine +Y (image up = world -Z)
    marker.position.set(wx, TH + 0.2, wz);
    woodGroup.add(marker);
  }

  // Subtle ground grid for depth reference
  scene.children.filter(c => c.isGridHelper).forEach(g => scene.remove(g));
  const maxDim = Math.max(W, Dz);
  const grid = new THREE.GridHelper(maxDim * 3, 16, 0x2a2d32, 0x1e2124);
  grid.position.y = -0.5;
  scene.add(grid);

  // Camera at +Z, centered in X → screen right = +X, image orientation matches photo
  camera.position.set(0, TH + maxDim * 1.0, Dz * 0.9);
  controls.target.set(0, TH * 0.3, 0);
  controls.update();
}

// ── API calls (JSON body — no part-size limit) ────────────────────────────
async function apiPost(endpoint, params) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data: previewCanvas.toDataURL("image/png"), params }),
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
  btnGenerate.disabled = true;

  try {
    const res  = await apiPost("/api/preview", p);
    const data = await res.json();

    initViewer();
    buildWoodMesh(data.heightmap, data.path_heightmap, data.toolpath, data.rows, data.cols, p);
    state.previewGenerated = true;

    const stepOver      = p.step_over;
    const rasterLines   = data.raster_lines;
    const depthPasses   = data.passes;
    const estHours      = Math.floor(data.estimate_min / 60);
    const estMins       = Math.round(data.estimate_min % 60);
    const timeLabel     = estHours > 0
      ? `${estHours}h ${String(estMins).padStart(2, "0")}m`
      : `${estMins}m`;
    const u             = state.units === "imperial";
    const fmt           = v => u ? (v / MM_PER_INCH).toFixed(3) + " in" : v.toFixed(1) + " mm";
    const toolLabel     = p.bit_type === "vbit"
      ? `V-bit ${p.tip_angle}° / ⌀${fmt(p.bit_diameter)}`
      : `End mill ⌀${fmt(p.bit_diameter)}`;

    exportInfo.innerHTML =
      `Size: <b>${fmt(p.width_mm)} × ${fmt(p.height_mm)}</b> &nbsp;|&nbsp; ` +
      `Depth: <b>${fmt(p.cut_depth)}</b> &nbsp;|&nbsp; ` +
      `Step: <b>${fmt(stepOver)}</b> &nbsp;|&nbsp; ` +
      (depthPasses > 1 ? `${depthPasses} depth passes &nbsp;|&nbsp; ` : "") +
      `${rasterLines} raster lines &nbsp;|&nbsp; ` +
      `Tool: <b>${toolLabel}</b> &nbsp;|&nbsp; ` +
      `Origin: <b>${p.origin.replace("-", " ")}</b> &nbsp;|&nbsp; ` +
      `Est: <b>~${timeLabel}</b>`;
  } catch (err) {
    alert("Error generating preview:\n" + err.message);
  } finally {
    loadingOverlay.classList.add("hidden");
    btnGenerate.disabled = false;
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

ctrlBrightness.addEventListener("input",  schedulePreview);
ctrlContrast.addEventListener("input",   schedulePreview);
ctrlInvert.addEventListener("change",    schedulePreview);
ctrlFlipH.addEventListener("change",     schedulePreview);
ctrlFlipV.addEventListener("change",     schedulePreview);

// Keep the no-cut handle strictly left of the max-cut handle
ctrlNoCut.addEventListener("input", () => {
  if (+ctrlNoCut.value >= +ctrlMaxCut.value) ctrlNoCut.value = +ctrlMaxCut.value - 1;
  schedulePreview();
});
ctrlMaxCut.addEventListener("input", () => {
  if (+ctrlMaxCut.value <= +ctrlNoCut.value) ctrlMaxCut.value = +ctrlNoCut.value + 1;
  schedulePreview();
});

// Keep data-mm in sync on all editable unit-aware inputs; width also drives height
document.querySelectorAll("input[data-unit]:not([readonly])").forEach(el => {
  el.addEventListener("input", () => { syncMM(el); if (el === pWidth) updateHeightParam(); });
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

ctrlToolPath.addEventListener("change", () => {
  if (toolPath) toolPath.visible = ctrlToolPath.checked;
});

btnDlStl.addEventListener("click",   () => downloadFile("/api/download/stl",   `molino_v${state.version}_${state.originalFileName}_carve.stl`));
btnDlGcode.addEventListener("click", () => downloadFile("/api/download/gcode", `molino_v${state.version}_${state.originalFileName}_carve.gcode`));

// ── Logo click → new session ───────────────────────────────────────────────
document.querySelector(".logo").addEventListener("click", () => location.reload());

// ── Step indicator click → navigate ───────────────────────────────────────
document.querySelectorAll(".step-indicator").forEach(el => {
  el.addEventListener("click", () => {
    const n = parseInt(el.dataset.step);
    if (n === 1) { showStep(1); return; }
    if (n === 2 && state.originalPixels)   { showStep(2); return; }
    if (n === 3 && state.previewGenerated) { showStep(3); return; }
  });
});

// ── Version display ────────────────────────────────────────────────────────
fetch("/api/info")
  .then(r => r.json())
  .then(({ version }) => {
    state.version = version;
    document.querySelector(".version").textContent = `v${version}`;
  })
  .catch(() => {});
