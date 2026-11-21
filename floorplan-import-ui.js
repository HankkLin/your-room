import "./floorplan-import.css";
import { icon } from "./icons.js";
import { DOOR_KINDS } from "./src/contracts/scene.js";
import { calculatePixelDistance } from "./src/spatial/floorplan-calibration.js";
import { polygonBounds } from "./src/spatial/floorplan-geometry.js";
import {
  applyImportCorrection,
  calibrateImportSession,
  confirmImportedHouse,
  createManualCalibrationFallbackSession,
  importFloorplanImage,
  importSampleFloorplan,
  preprocessFloorplanFile,
  toCleanHouseContract,
} from "./src/spatial/floorplan-importer.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );

const ROOM_FILL_COLORS = {
  living: "rgba(196, 154, 108, 0.24)",
  kitchen: "rgba(125, 156, 132, 0.25)",
  bedroom: "rgba(134, 152, 184, 0.25)",
  bathroom: "rgba(116, 172, 178, 0.26)",
  hallway: "rgba(178, 168, 148, 0.24)",
  other: "rgba(165, 156, 142, 0.22)",
};

const ROOM_STROKE_COLORS = {
  living: "#8e5837",
  kitchen: "#426a4b",
  bedroom: "#465e85",
  bathroom: "#386f76",
  hallway: "#6c6556",
  other: "#5f5c53",
};

/**
 * Open the developer/demo Debug JSON modal for inspecting and copying
 * the parsed House JSON without exposing any secrets.
 *
 * @param {object} house
 */
export function showParsedGeometryModal(house) {
  const dialog = document.getElementById("dialog");
  const titleNode = document.getElementById("modal-title");
  const bodyNode = document.getElementById("modal-body");
  if (!dialog || !titleNode || !bodyNode || !house) return;

  const clean = toCleanHouseContract(house);
  const sections = {
    full: { label: "Full House JSON", data: clean },
    rooms: { label: `Rooms (${clean.rooms.length})`, data: clean.rooms },
    doors: {
      label: `Doors & Adjacency (${clean.doors.length})`,
      data: { doors: clean.doors, adjacency: clean.adjacency },
    },
    windows: {
      label: `Windows (${clean.windows.length})`,
      data: clean.windows,
    },
    fixtures: {
      label: `Fixtures (${clean.fixtures.length})`,
      data: clean.fixtures,
    },
    calibration: {
      label: "Calibration & Warnings",
      data: {
        units: clean.units,
        bounds: clean.bounds,
        confidence: clean.confidence,
        calibration: clean.calibration,
        warnings: clean.warnings,
      },
    },
  };

  let activeSection = "full";

  function renderModalContent(copied = false) {
    const jsonText = JSON.stringify(sections[activeSection].data, null, 2);
    titleNode.textContent = "Parsed Whole-Home Geometry";
    bodyNode.innerHTML =
      '<div class="fp-json-dialog-tools">' +
      '<div class="fp-json-tabs" role="tablist" aria-label="Geometry sections">' +
      Object.entries(sections)
        .map(
          ([key, info]) =>
            '<button type="button" data-json-tab="' +
            esc(key) +
            '" aria-pressed="' +
            (key === activeSection) +
            '">' +
            esc(info.label) +
            "</button>",
        )
        .join("") +
      "</div>" +
      '<button type="button" class="secondary" id="copy-house-json">' +
      (copied ? "Copied JSON ✓" : "Copy JSON") +
      "</button>" +
      "</div>" +
      '<pre class="fp-json-pre" id="parsed-house-json">' +
      esc(jsonText) +
      "</pre>";
  }

  renderModalContent();
  bodyNode.onclick = async (event) => {
    const tabBtn = event.target.closest("[data-json-tab]");
    if (tabBtn) {
      activeSection = tabBtn.dataset.jsonTab;
      renderModalContent();
      return;
    }
    if (event.target.closest("#copy-house-json")) {
      const text = JSON.stringify(sections[activeSection].data, null, 2);
      try {
        await navigator.clipboard?.writeText(text);
        renderModalContent(true);
      } catch {
        // Clipboard permission unavailable in headless context
      }
    }
  };

  if (!dialog.open) dialog.showModal();
}

function getCandidateOriginPx(rawCandidate) {
  if (!rawCandidate || !Array.isArray(rawCandidate.rooms)) return [0, 0];
  let minX = Infinity;
  let minY = Infinity;
  for (const room of rawCandidate.rooms) {
    const poly = room?.polygonPx ?? room?.polygon ?? [];
    for (const pt of poly) {
      if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        minX = Math.min(minX, pt[0]);
        minY = Math.min(minY, pt[1]);
      }
    }
  }
  return Number.isFinite(minX) && Number.isFinite(minY) ? [minX, minY] : [0, 0];
}

function polygonCenter(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return [0, 0];
  const bounds = polygonBounds(polygon);
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
}

/**
 * Mount the Whole-Home Floorplan Importer workflow inside `#setup-page`.
 */
export function openFloorplanImporter({
  host,
  initialMode = "sample",
  initialFile = null,
  onBack,
  onConfirmed,
}) {
  let active = true;
  let requestToken = 0;
  let session = null;
  let lastPreprocessed = null;
  let showOverlay = true;
  let activePanel = "status"; // "status" | "calibrate" | "review"
  let reviewTab = "rooms"; // "rooms" | "doors" | "windows"
  let expandedVertexRoomId = null;

  // Calibration state
  let calPointA = null;
  let calPointB = null;
  let calUnit = "meters"; // "meters" | "feet_inches" | "ft"
  let calMetersValue = "3.65";
  let calFeetValue = "12";
  let calInchesValue = "0";
  let uiError = "";
  let vertexDrag = null;

  const $ = (sel) => host.querySelector(sel);

  function cleanup() {
    active = false;
    ++requestToken;
    host.onpointerdown = null;
    host.onpointermove = null;
    host.onpointerup = null;
  }

  function meterToImagePx(sessionObj, pt) {
    const [originX, originY] = getCandidateOriginPx(sessionObj.rawCandidate);
    const factor =
      Number(sessionObj.house?.calibration?.metersPerPixel) > 0
        ? Number(sessionObj.house.calibration.metersPerPixel)
        : 0.01;
    return [originX + pt[0] / factor, originY + pt[1] / factor];
  }

  function imagePxToMeter(sessionObj, pxPt) {
    const [originX, originY] = getCandidateOriginPx(sessionObj.rawCandidate);
    const factor =
      Number(sessionObj.house?.calibration?.metersPerPixel) > 0
        ? Number(sessionObj.house.calibration.metersPerPixel)
        : 0.01;
    return [(pxPt[0] - originX) * factor, (pxPt[1] - originY) * factor];
  }

  function svgPointFromEvent(svg, event) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return [
      Math.max(0, Math.min(session.imageWidth, local.x)),
      Math.max(0, Math.min(session.imageHeight, local.y)),
    ];
  }

  function renderOverlaySvg() {
    if (!session) return "";
    const w = session.imageWidth || 1000;
    const h = session.imageHeight || 800;
    const house = session.house;
    const isCalibrating = activePanel === "calibrate";
    const isReviewRooms = activePanel === "review" && reviewTab === "rooms";

    let shapes = "";
    if (house && showOverlay) {
      // Room polygons
      for (const room of house.rooms) {
        const pxPoints = room.polygon.map((pt) => meterToImagePx(session, pt));
        const ptsAttr = pxPoints
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ");
        const fill = ROOM_FILL_COLORS[room.kind] || ROOM_FILL_COLORS.other;
        const stroke = ROOM_STROKE_COLORS[room.kind] || ROOM_STROKE_COLORS.other;
        const centerM = polygonCenter(room.polygon);
        const [cx, cy] = meterToImagePx(session, centerM);
        const roomBounds = polygonBounds(room.polygon);
        const dimLabel = session.calibrationRequired
          ? "Uncalibrated"
          : `${roomBounds.width.toFixed(1)} × ${roomBounds.depth.toFixed(1)} m`;

        shapes +=
          `<g data-overlay-room="${esc(room.id)}">` +
          `<polygon points="${ptsAttr}" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>` +
          `<rect x="${(cx - 72).toFixed(1)}" y="${(cy - 20).toFixed(1)}" width="144" height="38" rx="6" fill="#fffdf8e8" stroke="${stroke}" stroke-width="1"/>` +
          `<text x="${cx.toFixed(1)}" y="${(cy - 3).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#252822">${esc(room.name)}</text>` +
          `<text x="${cx.toFixed(1)}" y="${(cy + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="#5e6158">${esc(dimLabel)}</text>` +
          `</g>`;
      }

      // Locked fixtures
      for (const fix of house.fixtures) {
        const [fx, fy] = meterToImagePx(session, [
          fix.position[0],
          fix.position[2],
        ]);
        shapes +=
          `<g data-overlay-fixture="${esc(fix.id)}">` +
          `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="9" fill="#464b42" stroke="#fff" stroke-width="1.5"/>` +
          `<text x="${fx.toFixed(1)}" y="${(fy + 3.5).toFixed(1)}" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">L</text>` +
          `</g>`;
      }

      // Windows
      for (const win of house.windows) {
        const [wx, wy] = meterToImagePx(session, win.position);
        shapes += `<rect x="${(wx - 8).toFixed(1)}" y="${(wy - 8).toFixed(1)}" width="16" height="16" rx="3" fill="#3a7d8c" stroke="#fff" stroke-width="2"/>`;
      }

      // Doors
      for (const door of house.doors) {
        const [dx, dy] = meterToImagePx(session, door.position);
        const color = door.kind === "exterior" ? "#994731" : "#b87430";
        shapes += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="9" fill="${color}" stroke="#fff" stroke-width="2"/>`;
      }

      // Draggable room vertex handles when editing rooms
      if (isReviewRooms) {
        for (const room of house.rooms) {
          room.polygon.forEach((pt, idx) => {
            const [vx, vy] = meterToImagePx(session, pt);
            shapes += `<circle class="fp-vertex-handle" data-vertex-room="${esc(room.id)}" data-vertex-idx="${idx}" cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="7" fill="#fff" stroke="#994731" stroke-width="2.5"/>`;
          });
        }
      }
    }

    // Calibration markers A & B
    if (calPointA) {
      shapes +=
        `<g class="fp-cal-marker">` +
        (calPointB
          ? `<line x1="${calPointA[0].toFixed(1)}" y1="${calPointA[1].toFixed(1)}" x2="${calPointB[0].toFixed(1)}" y2="${calPointB[1].toFixed(1)}" stroke="#994731" stroke-width="3.5" stroke-dasharray="8 5"/>`
          : "") +
        `<circle cx="${calPointA[0].toFixed(1)}" cy="${calPointA[1].toFixed(1)}" r="12" fill="#994731" stroke="#fff" stroke-width="2.5"/>` +
        `<text x="${calPointA[0].toFixed(1)}" y="${(calPointA[1] + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">A</text>` +
        `</g>`;
    }
    if (calPointB) {
      const midX = (calPointA[0] + calPointB[0]) / 2;
      const midY = (calPointA[1] + calPointB[1]) / 2;
      const pxDist = calculatePixelDistance(calPointA, calPointB);
      shapes +=
        `<g class="fp-cal-marker">` +
        `<circle cx="${calPointB[0].toFixed(1)}" cy="${calPointB[1].toFixed(1)}" r="12" fill="#994731" stroke="#fff" stroke-width="2.5"/>` +
        `<text x="${calPointB[0].toFixed(1)}" y="${(calPointB[1] + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">B</text>` +
        `<rect x="${(midX - 44).toFixed(1)}" y="${(midY - 24).toFixed(1)}" width="88" height="22" rx="5" fill="#292c27" opacity="0.9"/>` +
        `<text x="${midX.toFixed(1)}" y="${(midY - 9).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#fff">${pxDist.toFixed(0)} px</text>` +
        `</g>`;
    }

    return (
      `<svg id="fp-overlay-svg" class="fp-overlay-svg${isCalibrating ? " calibrating" : ""}" ` +
      `viewBox="0 0 ${w} ${h}" role="img" aria-label="Extracted whole-home floorplan geometry overlay">` +
      shapes +
      `</svg>`
    );
  }

  function renderCalibrationPanel() {
    const hasBoth = Boolean(calPointA && calPointB);
    const pxDist = hasBoth ? calculatePixelDistance(calPointA, calPointB) : null;

    return (
      '<section class="fp-card" id="fp-calibrate-panel" aria-label="Floorplan scale calibration">' +
      '<p class="eyebrow">Known-distance calibration</p>' +
      "<h3>Calibrate real-world scale</h3>" +
      '<p class="muted" style="margin-top:4px">Click two points on a known wall in the floorplan image, then enter its real measurement.</p>' +
      '<div class="fp-cal-points">' +
      '<span id="fp-cal-readout">' +
      (hasBoth
        ? `Point A → B: ${pxDist.toFixed(1)} px`
        : calPointA
          ? "Point A set — click Point B on the wall"
          : "Click Point A on the floorplan to begin") +
      "</span>" +
      '<button type="button" class="text-btn" id="fp-reset-cal-points">Reset points</button>' +
      "</div>" +
      '<div class="fp-cal-row">' +
      (calUnit === "feet_inches"
        ? '<div class="fp-cal-ftin">' +
          '<label class="field">Feet<input type="number" id="fp-cal-feet" min="0" max="500" step="1" value="' +
          esc(calFeetValue) +
          '"></label>' +
          '<label class="field">Inches<input type="number" id="fp-cal-inches" min="0" max="11.9" step="0.5" value="' +
          esc(calInchesValue) +
          '"></label>' +
          "</div>"
        : '<label class="field">Known distance<input type="number" id="fp-cal-distance" min="0.1" max="250" step="0.01" value="' +
          esc(calMetersValue) +
          '"></label>') +
      '<label class="field">Units<select id="fp-cal-unit">' +
      '<option value="meters"' +
      (calUnit === "meters" ? " selected" : "") +
      ">meters (m)</option>" +
      '<option value="feet_inches"' +
      (calUnit === "feet_inches" ? " selected" : "") +
      ">feet &amp; inches</option>" +
      '<option value="ft"' +
      (calUnit === "ft" ? " selected" : "") +
      ">feet (ft)</option>" +
      "</select></label>" +
      "</div>" +
      '<button type="button" class="secondary" id="fp-apply-calibration" style="width:100%;margin-top:6px">' +
      "Apply Calibration" +
      "</button>" +
      "</section>"
    );
  }

  function renderReviewPanel() {
    const house = session.house;
    const roomOptions = house.rooms
      .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
      .join("");

    let body = "";
    if (reviewTab === "rooms") {
      body =
        '<p class="muted" style="margin-bottom:8px">Rename rooms, remove false detections, or drag corner handles on the floorplan.</p>' +
        '<div class="fp-repair-list">' +
        house.rooms
          .map((room) => {
            const expanded = expandedVertexRoomId === room.id;
            return (
              '<div class="fp-repair-item" data-room-card="' +
              esc(room.id) +
              '">' +
              '<div class="fp-repair-row">' +
              '<input aria-label="Room name" data-room-rename="' +
              esc(room.id) +
              '" value="' +
              esc(room.name) +
              '">' +
              '<button type="button" class="text-btn" data-toggle-vertices="' +
              esc(room.id) +
              '">' +
              (expanded ? "Hide pts" : "Points") +
              "</button>" +
              '<button type="button" class="icon-btn" data-remove-room="' +
              esc(room.id) +
              '" aria-label="Remove ' +
              esc(room.name) +
              '"' +
              (house.rooms.length <= 1 ? " disabled" : "") +
              ">" +
              icon("trash") +
              "</button>" +
              "</div>" +
              (expanded
                ? '<div class="fp-vertex-grid">' +
                  room.polygon
                    .map(
                      (pt, idx) =>
                        '<div class="fp-vertex-cell">' +
                        `<span>P${idx + 1}</span>` +
                        `<input type="number" step="0.1" aria-label="${esc(room.name)} vertex ${idx + 1} X" data-vertex-edit="${esc(room.id)}" data-v-idx="${idx}" data-v-axis="0" value="${pt[0]}">` +
                        `<input type="number" step="0.1" aria-label="${esc(room.name)} vertex ${idx + 1} Z" data-vertex-edit="${esc(room.id)}" data-v-idx="${idx}" data-v-axis="1" value="${pt[1]}">` +
                        "</div>",
                    )
                    .join("") +
                  "</div>"
                : "") +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    } else if (reviewTab === "doors") {
      body =
        '<div class="fp-repair-list">' +
        house.doors
          .map(
            (door) =>
              '<div class="fp-repair-item" data-door-card="' +
              esc(door.id) +
              '">' +
              '<div class="fp-repair-row">' +
              `<strong>${esc(door.id)}</strong>` +
              `<select aria-label="Door kind" data-door-kind="${esc(door.id)}">` +
              DOOR_KINDS.map(
                (k) =>
                  `<option value="${k}"${door.kind === k ? " selected" : ""}>${k.replace("_", " ")}</option>`,
              ).join("") +
              "</select>" +
              `<button type="button" class="icon-btn" data-remove-door="${esc(door.id)}" aria-label="Remove ${esc(door.id)}">${icon("trash")}</button>` +
              "</div>" +
              '<div class="fp-repair-row">' +
              `<select aria-label="Door room A" data-door-room-a="${esc(door.id)}">` +
              house.rooms
                .map(
                  (r) =>
                    `<option value="${esc(r.id)}"${door.roomA === r.id ? " selected" : ""}>${esc(r.name)}</option>`,
                )
                .join("") +
              "</select>" +
              "<span>↔</span>" +
              `<select aria-label="Door room B" data-door-room-b="${esc(door.id)}"${door.kind === "exterior" ? " disabled" : ""}>` +
              `<option value="">Exterior / None</option>` +
              house.rooms
                .map(
                  (r) =>
                    `<option value="${esc(r.id)}"${door.roomB === r.id ? " selected" : ""}>${esc(r.name)}</option>`,
                )
                .join("") +
              "</select>" +
              "</div>" +
              "</div>",
          )
          .join("") +
        "</div>" +
        '<div class="fp-add-box">' +
        '<span class="section-label">Add missing door</span>' +
        '<div class="fp-add-grid">' +
        `<select id="fp-new-door-a" aria-label="New door room A">${roomOptions}</select>` +
        `<select id="fp-new-door-b" aria-label="New door room B"><option value="">Exterior door</option>${roomOptions}</select>` +
        "</div>" +
        '<button type="button" class="secondary" id="fp-add-door">+ Add Door</button>' +
        "</div>";
    } else {
      body =
        '<div class="fp-repair-list">' +
        house.windows
          .map(
            (win) =>
              '<div class="fp-repair-item">' +
              '<div class="fp-repair-row">' +
              `<strong style="flex:1">${esc(win.id)} (${esc(win.roomId || "unassigned")} · ${win.width} m)</strong>` +
              `<button type="button" class="icon-btn" data-remove-window="${esc(win.id)}" aria-label="Remove ${esc(win.id)}">${icon("trash")}</button>` +
              "</div>" +
              "</div>",
          )
          .join("") +
        "</div>" +
        '<div class="fp-add-box">' +
        '<span class="section-label">Add window on exterior wall</span>' +
        '<div class="fp-add-grid">' +
        `<select id="fp-new-win-room" aria-label="Window room">${roomOptions}</select>` +
        '<input type="number" id="fp-new-win-width" min="0.4" max="5" step="0.1" value="1.4" aria-label="Window width (m)">' +
        "</div>" +
        '<button type="button" class="secondary" id="fp-add-window">+ Add Window</button>' +
        "</div>";
    }

    return (
      '<section class="fp-card" id="fp-review-panel" aria-label="Manual geometry corrections">' +
      '<div class="fp-subtabs" role="tablist">' +
      `<button type="button" data-review-tab="rooms" aria-pressed="${reviewTab === "rooms"}">Rooms (${house.rooms.length})</button>` +
      `<button type="button" data-review-tab="doors" aria-pressed="${reviewTab === "doors"}">Doors (${house.doors.length})</button>` +
      `<button type="button" data-review-tab="windows" aria-pressed="${reviewTab === "windows"}">Windows (${house.windows.length})</button>` +
      "</div>" +
      body +
      "</section>"
    );
  }

  function renderInspector() {
    if (session?.status === "unreadable") {
      return `<section class="fp-card" role="alert"><h2>Could not load floorplan</h2><p>${esc(uiError)}</p></section>`;
    }
    if (!session || session.status === "reading" || session.status === "loading") {
      const reading = session?.status === "reading";
      return (
        '<section class="fp-card" role="status">' +
        '<p class="eyebrow">Gemini 4 spatial analysis</p>' +
        `<h2 class="image-processing">${reading ? "Loading floorplan image…" : "Analyzing floorplan…"}</h2>` +
        (reading ? "" : '<p class="muted" style="margin-top:8px">Extracting room polygons, walls, doors, windows, and locked fixtures.</p>') +
        '<div class="fp-failed-actions">' +
        '<button type="button" class="secondary" id="fp-use-sample">Try Sample Whole-Home Floorplan</button>' +
        "</div>" +
        "</section>"
      );
    }

    if (session.status === "failed") {
      return (
        '<section class="fp-card" role="alert" id="fp-analysis-failed">' +
        '<p class="eyebrow">Import status</p>' +
        "<h2>Analysis failed.</h2>" +
        '<p class="setup-error" style="margin-top:8px">' +
        esc(session.error) +
        "</p>" +
        '<p class="muted">Use the deterministic sample whole-home floorplan, retry analysis, or calibrate manually on your image.</p>' +
        '<div class="fp-failed-actions">' +
        '<button type="button" class="primary" id="fp-fallback-sample">Use Sample Floorplan</button>' +
        '<button type="button" class="secondary" id="fp-fallback-retry">Retry</button>' +
        '<button type="button" class="secondary" id="fp-fallback-manual">Manual Calibration</button>' +
        "</div>" +
        "</section>"
      );
    }

    const { house, validation } = session;
    const blockingErrors = validation.errors.filter(
      (e) => e.code !== "MISSING_SCALE",
    );
    const warningMessages = validation.warnings.map((w) => w.message);

    return (
      '<section class="fp-card" id="fp-status-card">' +
      '<div class="fp-status-head">' +
      "<div>" +
      '<p class="eyebrow">Import review</p>' +
      "<h2>Floorplan analyzed</h2>" +
      "</div>" +
      `<span class="fp-confidence-badge">${Math.round((house.confidence ?? 0.85) * 100)}% confidence</span>` +
      "</div>" +
      '<div class="fp-stats-grid" id="fp-stats">' +
      `<div class="fp-stat"><strong>${house.rooms.length}</strong><span>rooms detected</span></div>` +
      `<div class="fp-stat"><strong>${house.doors.length}</strong><span>doors detected</span></div>` +
      `<div class="fp-stat"><strong>${house.windows.length}</strong><span>windows detected</span></div>` +
      `<div class="fp-stat"><strong>${house.fixtures.length}</strong><span>fixed fixtures (locked)</span></div>` +
      "</div>" +
      (session.calibrationRequired
        ? '<div class="fp-scale-banner warn" id="fp-scale-status" role="status">' +
          "<strong>⚠ Calibration required</strong><br>" +
          "No verified scale detected. Select two points on a known wall to set real-world dimensions." +
          "</div>"
        : '<div class="fp-scale-banner ok" id="fp-scale-status" role="status">' +
          `<strong>✓ Scale verified (${esc(house.calibration.source)})</strong><br>` +
          `${house.bounds.width.toFixed(2)} × ${house.bounds.depth.toFixed(2)} m footprint · ${house.calibration.metersPerPixel} m/px` +
          "</div>") +
      (blockingErrors.length
        ? '<p class="section-label">Validation blockers</p><ul class="fp-issues-list errors">' +
          blockingErrors.map((err) => `<li>${esc(err.message)}</li>`).join("") +
          "</ul>"
        : "") +
      (warningMessages.length
        ? '<p class="section-label" style="margin-top:8px">Warnings</p><ul class="fp-issues-list" id="fp-warnings">' +
          warningMessages.map((msg) => `<li>${esc(msg)}</li>`).join("") +
          "</ul>"
        : "") +
      '<div class="fp-mode-bar">' +
      `<button type="button" class="secondary" id="fp-open-calibrate" aria-pressed="${activePanel === "calibrate"}">Calibrate</button>` +
      `<button type="button" class="secondary" id="fp-open-review" aria-pressed="${activePanel === "review"}">Review</button>` +
      '<button type="button" class="secondary" id="fp-view-json">View Parsed Geometry</button>' +
      "</div>" +
      "</section>" +
      (activePanel === "calibrate" ? renderCalibrationPanel() : "") +
      (activePanel === "review" ? renderReviewPanel() : "") +
      (uiError ? `<p class="setup-error" role="alert">${esc(uiError)}</p>` : "") +
      '<div class="fp-confirm-bar">' +
      `<button type="button" class="primary" id="fp-confirm-import"${!validation.valid || session.calibrationRequired ? " disabled" : ""}>Confirm Import →</button>` +
      "</div>"
    );
  }

  function render() {
    if (!active) return;
    const house = session?.house;
    const dimsText =
      house && !session.calibrationRequired
        ? `${house.bounds.width.toFixed(1)} × ${house.bounds.depth.toFixed(1)} m · ${house.rooms.length} rooms`
        : "Scale uncalibrated";

    host.innerHTML =
      '<div class="setup-shell fp-shell">' +
      '<div class="fp-topbar">' +
      '<button type="button" class="secondary" id="fp-back">← Back to setup</button>' +
      '<div class="fp-topbar-actions">' +
      '<label class="secondary fp-upload-inline">Upload floorplan image<input type="file" id="fp-reupload" accept="image/png,image/jpeg,image/webp"></label>' +
      '<button type="button" class="secondary" id="fp-try-sample-top">Try Sample Whole-Home Floorplan</button>' +
      "</div>" +
      "</div>" +
      '<div class="fp-grid">' +
      '<section class="fp-viewport-card" aria-label="Floorplan preview">' +
      '<div class="fp-viewport-head">' +
      `<span>${icon("room")} ${esc(house?.name || "Uploaded Floorplan")}</span>` +
      `<span class="setup-plan-dims">${esc(dimsText)}</span>` +
      "</div>" +
      '<div class="fp-canvas-stage">' +
      (session?.imageUrl
        ? '<div class="fp-stage-inner">' +
          `<img class="fp-stage-image" src="${esc(session.imageUrl)}" alt="Floorplan reference">` +
          renderOverlaySvg() +
          "</div>"
        : session?.status === "reading"
          ? ""
          : '<p class="muted">Select a floorplan image or try the bundled sample.</p>') +
      "</div>" +
      '<div class="fp-viewport-foot">' +
      '<div class="fp-legend">' +
      '<span><i style="background:#8e5837"></i>Rooms</span>' +
      '<span><i style="background:#b87430"></i>Doors</span>' +
      '<span><i style="background:#3a7d8c"></i>Windows</span>' +
      '<span><i style="background:#464b42"></i>Locked fixtures</span>' +
      "</div>" +
      (house
        ? `<label class="check-field" style="margin:0;font-size:12px"><input type="checkbox" id="fp-toggle-overlay"${showOverlay ? " checked" : ""}> Overlay</label>`
        : "") +
      "</div>" +
      "</section>" +
      `<div class="fp-inspector">${renderInspector()}</div>` +
      "</div>" +
      "</div>";
  }

  function loadSample() {
    ++requestToken;
    uiError = "";
    calPointA = null;
    calPointB = null;
    session = importSampleFloorplan();
    activePanel = session.calibrationRequired ? "calibrate" : "status";
    render();
  }

  async function handleFileUpload(file) {
    if (!file) return;
    const token = ++requestToken;
    uiError = "";
    calPointA = null;
    calPointB = null;
    session = { status: "reading" };
    lastPreprocessed = null;
    render();
    try {
      const preprocessed = await preprocessFloorplanFile(file);
      if (!active || token !== requestToken) return;
      lastPreprocessed = preprocessed;
      session = {
        status: "loading",
        mode: "upload",
        imageUrl: preprocessed.dataUrl,
        imageWidth: preprocessed.width,
        imageHeight: preprocessed.height,
        house: null,
        validation: null,
        calibrationRequired: true,
      };
      render();

      const analyzedSession = await importFloorplanImage(preprocessed);
      if (!active || token !== requestToken) return;
      session = analyzedSession;
      activePanel =
        session.status === "ready" && session.calibrationRequired
          ? "calibrate"
          : "status";
      render();
    } catch (err) {
      if (!active || token !== requestToken) return;
      uiError = err?.message || "Could not read floorplan image.";
      session = { status: "unreadable" };
      render();
    }
  }

  host.onclick = (event) => {
    const btn = event.target.closest("button");
    if (!btn || !host.contains(btn)) return;

    if (btn.id === "fp-back") {
      cleanup();
      onBack?.();
      return;
    }
    if (
      btn.id === "fp-try-sample-top" ||
      btn.id === "fp-use-sample" ||
      btn.id === "fp-fallback-sample"
    ) {
      loadSample();
      return;
    }
    if (btn.id === "fp-fallback-retry" && lastPreprocessed) {
      const token = ++requestToken;
      session = { ...session, status: "loading", error: null };
      render();
      importFloorplanImage(lastPreprocessed).then((next) => {
        if (!active || token !== requestToken) return;
        session = next;
        activePanel =
          session.status === "ready" && session.calibrationRequired
            ? "calibrate"
            : "status";
        render();
      });
      return;
    }
    if (btn.id === "fp-fallback-manual") {
      session = createManualCalibrationFallbackSession({
        imageUrl: session?.imageUrl,
        imageWidth: session?.imageWidth || 1000,
        imageHeight: session?.imageHeight || 800,
        name: lastPreprocessed?.name || "Manual Floorplan Import",
      });
      activePanel = "calibrate";
      calPointA = [
        Math.round(session.imageWidth * 0.12),
        Math.round(session.imageHeight * 0.12),
      ];
      calPointB = [
        Math.round(session.imageWidth * 0.54),
        Math.round(session.imageHeight * 0.12),
      ];
      render();
      return;
    }
    if (btn.id === "fp-open-calibrate") {
      activePanel = activePanel === "calibrate" ? "status" : "calibrate";
      uiError = "";
      render();
      return;
    }
    if (btn.id === "fp-open-review") {
      activePanel = activePanel === "review" ? "status" : "review";
      uiError = "";
      render();
      return;
    }
    if (btn.id === "fp-view-json" && session?.house) {
      showParsedGeometryModal(session.house);
      return;
    }
    if (btn.id === "fp-reset-cal-points") {
      calPointA = null;
      calPointB = null;
      uiError = "";
      render();
      return;
    }
    if (btn.id === "fp-apply-calibration" && session?.house) {
      try {
        if (!calPointA || !calPointB) {
          throw new Error(
            "Click two points (Point A and Point B) on a known wall in the floorplan first.",
          );
        }
        const distanceValue =
          calUnit === "feet_inches"
            ? { feet: Number(calFeetValue || 0), inches: Number(calInchesValue || 0) }
            : Number(calMetersValue);
        session = calibrateImportSession(session, {
          pointA: calPointA,
          pointB: calPointB,
          distanceValue,
          unit: calUnit,
        });
        uiError = "";
        render();
      } catch (err) {
        uiError = err.message;
        render();
      }
      return;
    }
    if (btn.dataset.reviewTab) {
      reviewTab = btn.dataset.reviewTab;
      render();
      return;
    }
    if (btn.dataset.toggleVertices) {
      expandedVertexRoomId =
        expandedVertexRoomId === btn.dataset.toggleVertices
          ? null
          : btn.dataset.toggleVertices;
      render();
      return;
    }
    if (btn.dataset.removeRoom) {
      session = applyImportCorrection(session, {
        type: "remove_room",
        roomId: btn.dataset.removeRoom,
      });
      render();
      return;
    }
    if (btn.dataset.removeDoor) {
      session = applyImportCorrection(session, {
        type: "remove_door",
        doorId: btn.dataset.removeDoor,
      });
      render();
      return;
    }
    if (btn.id === "fp-add-door") {
      const roomA = $("#fp-new-door-a")?.value;
      const roomB = $("#fp-new-door-b")?.value || null;
      session = applyImportCorrection(session, {
        type: "add_door",
        roomA,
        roomB,
        kind: roomB ? "interior" : "exterior",
      });
      render();
      return;
    }
    if (btn.dataset.removeWindow) {
      session = applyImportCorrection(session, {
        type: "remove_window",
        windowId: btn.dataset.removeWindow,
      });
      render();
      return;
    }
    if (btn.id === "fp-add-window") {
      const roomId = $("#fp-new-win-room")?.value;
      const width = Number($("#fp-new-win-width")?.value || 1.4);
      session = applyImportCorrection(session, {
        type: "add_window",
        roomId,
        width,
      });
      render();
      return;
    }
    if (btn.id === "fp-confirm-import" && session?.house) {
      try {
        const confirmed = confirmImportedHouse(session);
        cleanup();
        onConfirmed?.(confirmed, { imageUrl: session.imageUrl });
      } catch (err) {
        uiError = err.message;
        render();
      }
    }
  };

  host.onchange = (event) => {
    const target = event.target;
    if (target.id === "fp-reupload") {
      void handleFileUpload(target.files?.[0]);
      return;
    }
    if (target.id === "fp-toggle-overlay") {
      showOverlay = target.checked;
      render();
      return;
    }
    if (target.id === "fp-cal-unit") {
      calUnit = target.value;
      render();
      return;
    }
    if (target.dataset.doorKind) {
      session = applyImportCorrection(session, {
        type: "update_door",
        doorId: target.dataset.doorKind,
        kind: target.value,
      });
      render();
      return;
    }
    if (target.dataset.doorRoomA) {
      session = applyImportCorrection(session, {
        type: "update_door",
        doorId: target.dataset.doorRoomA,
        roomA: target.value,
      });
      render();
      return;
    }
    if (target.dataset.doorRoomB) {
      session = applyImportCorrection(session, {
        type: "update_door",
        doorId: target.dataset.doorRoomB,
        roomB: target.value || null,
        kind: target.value ? "interior" : "exterior",
      });
      render();
      return;
    }
    if (target.dataset.vertexEdit && session?.house) {
      const roomId = target.dataset.vertexEdit;
      const idx = Number(target.dataset.vIdx);
      const axis = Number(target.dataset.vAxis);
      const room = session.house.rooms.find((r) => r.id === roomId);
      const val = Number(target.value);
      if (room && Number.isFinite(val)) {
        const nextPt = [...room.polygon[idx]];
        nextPt[axis] = val;
        session = applyImportCorrection(session, {
          type: "move_vertex",
          roomId,
          vertexIndex: idx,
          position: nextPt,
        });
        render();
      }
    }
  };

  host.oninput = (event) => {
    const target = event.target;
    if (target.id === "fp-cal-distance") calMetersValue = target.value;
    if (target.id === "fp-cal-feet") calFeetValue = target.value;
    if (target.id === "fp-cal-inches") calInchesValue = target.value;
    if (target.dataset.roomRename && session?.house) {
      session = applyImportCorrection(session, {
        type: "rename_room",
        roomId: target.dataset.roomRename,
        name: target.value,
      });
      const overlay = $("#fp-overlay-svg");
      if (overlay) overlay.outerHTML = renderOverlaySvg();
    }
  };

  host.onpointerdown = (event) => {
    const svg = event.target.closest("#fp-overlay-svg");
    if (!svg || !session?.house) return;

    const handle = event.target.closest(".fp-vertex-handle");
    if (handle && activePanel === "review" && reviewTab === "rooms") {
      vertexDrag = {
        pointerId: event.pointerId,
        roomId: handle.dataset.vertexRoom,
        vertexIndex: Number(handle.dataset.vertexIdx),
      };
      host.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (activePanel === "calibrate") {
      const pxPt = svgPointFromEvent(svg, event);
      if (!pxPt) return;
      if (!calPointA || (calPointA && calPointB)) {
        calPointA = pxPt;
        calPointB = null;
      } else {
        calPointB = pxPt;
      }
      uiError = "";
      render();
    }
  };

  host.onpointermove = (event) => {
    if (!vertexDrag || vertexDrag.pointerId !== event.pointerId) return;
    const svg = $("#fp-overlay-svg");
    if (!svg || !session?.house) return;
    const pxPt = svgPointFromEvent(svg, event);
    if (!pxPt) return;
    const meterPt = imagePxToMeter(session, pxPt);
    session = applyImportCorrection(session, {
      type: "move_vertex",
      roomId: vertexDrag.roomId,
      vertexIndex: vertexDrag.vertexIndex,
      position: meterPt,
    });
    const overlay = $("#fp-overlay-svg");
    if (overlay) overlay.outerHTML = renderOverlaySvg();
  };

  host.onpointerup = host.onpointercancel = (event) => {
    if (vertexDrag && vertexDrag.pointerId === event.pointerId) {
      vertexDrag = null;
      render();
    }
  };

  if (initialMode === "upload" && initialFile) {
    void handleFileUpload(initialFile);
  } else {
    loadSample();
  }
}
