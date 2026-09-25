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
const btnDlStl    = document.getElementById("btn-dl-stl");
const btnDlGcode  = document.getElementById("btn-dl-gcode");

const pWidth    = document.getElementById("p-width");
const pHeight   = document.getElementById("p-height");
const pBitType  = document.getElementById("p-bit-type");
const pStepMode = document.getElementById("p-step-mode");
const pStepPct  = document.getElementById("p-step-pct");
const rowStepPct = document.getElementById("row-step-pct");
const rowRidge  = document.getElementById("row-max-ridge");
const rowTip    = document.getElementById("row-tip-angle");
const loadingOverlay = document.getElementById("loading-overlay");
const exportInfo     = document.getElementById("export-info");
const ctrlToolPath   = document.getElementById("ctrl-toolpath");
const ctrlLeftover   = document.getElementById("ctrl-leftover");
const langSelect     = document.getElementById("lang-select");

// ── i18n ───────────────────────────────────────────────────────────────────
// Dictionaries live in /static/i18n/<code>.json; static text carries data-i18n /
// data-i18n-html / data-i18n-title attributes, JS-built strings go through t().
const LANGS = { en: "English", pl: "Polski", de: "Deutsch" };
let lang = "en", dict = {}, dictEn = {};
const t = (key, vars = {}) =>
  (dict[key] ?? dictEn[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const browserLang = () => (navigator.language || "en").slice(0, 2).toLowerCase();

async function loadLanguage(code, persist) {
  lang = LANGS[code] ? code : "en";
  if (!Object.keys(dictEn).length) dictEn = await (await fetch("/static/i18n/en.json")).json();
  dict = lang === "en" ? dictEn : await (await fetch(`/static/i18n/${lang}.json`)).json();
  if (persist) localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  langSelect.value = lang;
  if (lastPreview) renderExportInfo(lastPreview.data, lastPreview.p);
  else if (!exportInfo.classList.contains("error")) exportInfo.textContent = t("export.placeholder");
  updatePrivacyStatus();
}

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
  state.previewGenerated = false;   // the carve preview no longer matches the image
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
    step_over_pct:  parseFloat(pStepPct.value),
    step_over_mode: pStepMode.value,
    max_ridge:      mm("p-max-ridge"),
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
let topGeo, topColBase, topColTint;   // carved surface geometry + plain / unreachable-tinted colours
let gridDim = 0;
let viewDims = "";

function cssColor(name) {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

function addGrid(dim) {
  gridDim = dim;
  scene.children.filter(c => c.isGridHelper).forEach(g => { scene.remove(g); g.geometry.dispose(); g.material.dispose(); });
  const grid = new THREE.GridHelper(dim * 3, 16, cssColor("--grid-a"), cssColor("--grid-b"));
  grid.position.y = -0.5;
  scene.add(grid);
}

function applyViewerTheme() {
  if (!scene) return;
  scene.background = cssColor("--viewer-bg");
  if (gridDim) addGrid(gridDim);
}

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
  scene.background = cssColor("--viewer-bg");

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

function buildWoodMesh(heightmap, pathHeightmap, leftover, toolpath, rows, cols, params) {
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
    const pad = new Float32Array(nc * nr);  // zeros = no cut
    const padL = new Float32Array(nc * nr); // zeros = nothing unreachable
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        pad[(i + mi) * nc + (j + mj)]  = heightmap[i * cols + j];
        padL[(i + mi) * nc + (j + mj)] = leftover[i * cols + j];
      }
    heightmap = pad;
    leftover  = padL;
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
    const col  = new Float32Array(n * 3);
    const tint = new Float32Array(n * 3);
    const idx  = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const k = i * cols + j;
        pos[k * 3]     = xAt(j);
        pos[k * 3 + 1] = yAt(i, j);
        pos[k * 3 + 2] = zAt(i);
        const t = heightmap[k];
        const r = 0.72 - t * 0.28, g = 0.50 - t * 0.22, b = 0.24 - t * 0.12;
        col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
        // Tint towards magenta where the tool can't reach the target;
        // full tint at 20% of the cut depth (at least 1 mm) so the shading stays graded
        const lv = Math.min(1, leftover[k] * CUT / Math.max(1, 0.2 * CUT));
        tint[k * 3]     = r + (0.88 - r) * lv;
        tint[k * 3 + 1] = g + (0.20 - g) * lv;
        tint[k * 3 + 2] = b + (0.70 - b) * lv;
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
    geo.setAttribute("color",    new THREE.BufferAttribute(ctrlLeftover.checked ? tint : col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    woodGroup.add(new THREE.Mesh(geo, carveMat));
    topGeo = geo; topColBase = col; topColTint = tint;
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
  const maxDim = Math.max(W, Dz);
  addGrid(maxDim);

  // Camera at +Z, centered in X → screen right = +X, image orientation matches photo
  // Frame the block only when its dimensions change, so live updates don't yank the camera
  const dims = `${W}|${Dz}|${TH}`;
  if (dims !== viewDims) {
    camera.position.set(0, TH + maxDim * 1.0, Dz * 0.9);
    controls.target.set(0, TH * 0.3, 0);
    viewDims = dims;
  }
  controls.update();
}

// ── API calls (JSON body — no part-size limit) ────────────────────────────
async function apiPost(endpoint, params, signal) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data: previewCanvas.toDataURL("image/png"), params }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res;
}

// Live preview: debounce edits, cancel the in-flight request when a newer one starts,
// and keep the current mesh on screen until the new result arrives.
let previewAbort = null, previewTimer = 0;
function schedulePreviewGen(delay = 400) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(generatePreview, delay);
}

async function generatePreview() {
  if (!state.originalPixels) return;
  const p = collectParams();
  if (Object.values(p).some(v => typeof v === "number" && !Number.isFinite(v))) return;   // field mid-edit
  previewAbort?.abort();
  const ctrl = previewAbort = new AbortController();
  loadingOverlay.classList.remove("hidden");

  try {
    const res  = await apiPost("/api/preview", p, ctrl.signal);
    const data = await res.json();
    if (ctrl.signal.aborted) return;

    if (!renderer) initViewer();
    buildWoodMesh(data.heightmap, data.path_heightmap, data.leftover, data.toolpath, data.rows, data.cols, p);
    state.params = p;
    state.previewGenerated = true;
    btnDlStl.disabled = btnDlGcode.disabled = false;
    exportInfo.classList.remove("error");

    lastPreview = { data, p };
    renderExportInfo(data, p);
  } catch (err) {
    if (err.name === "AbortError") return;
    exportInfo.classList.add("error");
    exportInfo.textContent = t("info.failed", { msg: err.message });
  } finally {
    if (previewAbort === ctrl) { loadingOverlay.classList.add("hidden"); previewAbort = null; }
  }
}

let lastPreview = null;
function renderExportInfo(data, p) {
  const u   = state.units === "imperial";
  const fmt = v => u ? (v / MM_PER_INCH).toFixed(3) + " in" : v.toFixed(1) + " mm";
  const h = Math.floor(data.estimate_min / 60), m = Math.round(data.estimate_min % 60);
  const timeLabel = h > 0 ? t("time.hm", { h, m: String(m).padStart(2, "0") }) : t("time.m", { m });
  const toolLabel = t(`tool.${p.bit_type}`, { angle: p.tip_angle, dia: fmt(p.bit_diameter) });
  const pct = p.step_over_mode === "percent" ? `${p.step_over_pct}% ⌀, ` : "";

  exportInfo.classList.remove("error");
  exportInfo.innerHTML = [
    `${t("info.size")}: <b>${fmt(p.width_mm)} × ${fmt(p.height_mm)}</b>`,
    `${t("info.depth")}: <b>${fmt(p.cut_depth)}</b>`,
    `${t("info.step")}: <b>${fmt(data.step_over_mm)}</b> (${pct}${t("info.ridge")} ${fmt(data.ridge_mm)})`,
    data.passes > 1 ? t("info.passes", { n: data.passes }) : null,
    t("info.lines", { n: data.raster_lines }),
    `${t("info.tool")}: <b>${toolLabel}</b>`,
    `${t("info.origin")}: <b>${t(`origin.${p.origin}`)}</b>`,
    `${t("info.unreachable")}: <b>${data.unreachable_pct.toFixed(0)}%</b> (${t("info.max")} ${fmt(data.leftover_max_mm)})`,
    `${t("info.est")}: <b>~${timeLabel}</b>`,
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");
}

async function downloadFile(endpoint, filename) {
  const btn = endpoint.includes("stl") ? btnDlStl : btnDlGcode;
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("btn.generating");

  try {
    const res  = await apiPost(endpoint, state.params);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(t("dl.failed", { msg: err.message }));
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

pStepMode.addEventListener("change", () => {
  const auto = pStepMode.value === "auto";
  rowRidge.style.display   = auto ? "" : "none";
  rowStepPct.style.display = auto ? "none" : "";
});

function enterCarve() {
  showStep(2);
  if (!state.previewGenerated) generatePreview();
}
btnNext1.addEventListener("click", enterCarve);
btnBack2.addEventListener("click", () => showStep(1));

ctrlToolPath.addEventListener("change", () => {
  if (toolPath) toolPath.visible = ctrlToolPath.checked;
});
ctrlLeftover.addEventListener("change", () => {
  if (topGeo) topGeo.setAttribute("color", new THREE.BufferAttribute(ctrlLeftover.checked ? topColTint : topColBase, 3));
});

// Any machining parameter edit re-plans the preview (debounced); viewer toggles are excluded
document.querySelectorAll(".params-pane input, .params-pane select").forEach(el => {
  el.addEventListener("input",  () => schedulePreviewGen());
  el.addEventListener("change", () => schedulePreviewGen());
});

// e.g. "200x150mm_vbit60deg-3.175mm" — carve size and tool in the active unit system
function setupTag() {
  const p = state.params, imperial = state.units === "imperial";
  const unit = imperial ? "in" : "mm";
  const num  = mm => String(parseFloat((imperial ? mm / MM_PER_INCH : mm).toFixed(3)));
  const tool = p.bit_type === "vbit"
    ? `vbit${p.tip_angle}deg-${num(p.bit_diameter)}${unit}`
    : `${p.bit_type}-${num(p.bit_diameter)}${unit}`;
  return `${num(p.width_mm)}x${num(p.height_mm)}${unit}_${tool}`;
}

btnDlStl.addEventListener("click",   () => downloadFile("/api/download/stl",   `molino_v${state.version}_${state.originalFileName}_carve.stl`));
btnDlGcode.addEventListener("click", () => downloadFile("/api/download/gcode", `molino_v${state.version}_${state.originalFileName}_${setupTag()}.gcode`));

// ── Theme ──────────────────────────────────────────────────────────────────
const themeBtn = document.getElementById("theme-toggle");
const systemTheme = () => matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

// Persist only on an explicit click: an unrequested write to the device needs consent
// under ePrivacy, a user-chosen UI preference does not.
function setTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem("theme", theme);
  themeBtn.textContent = theme === "dark" ? "☀" : "☾";   // sun = go light, moon = go dark
  applyViewerTheme();
  updatePrivacyStatus();
}
setTheme(document.documentElement.dataset.theme || systemTheme(), false);
themeBtn.addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));

// ── Privacy notice ─────────────────────────────────────────────────────────
const privacyDialog = document.getElementById("privacy");
function updatePrivacyStatus() {
  const items = ["theme", "lang"].filter(k => localStorage.getItem(k) !== null)
                                 .map(k => `${k}="${localStorage.getItem(k)}"`);
  document.getElementById("privacy-status").textContent =
    items.length ? t("privacy.status.stored", { items: items.join(", ") }) : t("privacy.status.none");
  document.getElementById("privacy-forget").disabled = !items.length;
}
document.getElementById("privacy-open").addEventListener("click", () => { updatePrivacyStatus(); privacyDialog.showModal(); });
document.getElementById("privacy-close").addEventListener("click", () => privacyDialog.close());
document.getElementById("privacy-forget").addEventListener("click", () => {
  localStorage.removeItem("theme");
  localStorage.removeItem("lang");
  setTheme(systemTheme(), false);
  loadLanguage(browserLang(), false);
});

// ── Language ───────────────────────────────────────────────────────────────
langSelect.addEventListener("change", () => loadLanguage(langSelect.value, true));
loadLanguage(localStorage.getItem("lang") || browserLang(), false);

// ── Logo click → new session ───────────────────────────────────────────────
document.querySelector(".logo").addEventListener("click", () => location.reload());

// ── Step indicator click → navigate ───────────────────────────────────────
document.querySelectorAll(".step-indicator").forEach(el => {
  el.addEventListener("click", () => {
    const n = parseInt(el.dataset.step);
    if (n === 1) { showStep(1); return; }
    if (n === 2 && state.originalPixels) enterCarve();
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
