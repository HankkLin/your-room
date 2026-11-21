import "./setup.css";
import {
  normalizeArchitecture,
  openingConflict,
  roomWalls,
  wallOpenings,
} from "./room-layout.js";
import {
  ROOM,
  catalog,
  createItem,
  createOwnedItems,
  initialState,
  fitItem,
  getSpend,
} from "./model.js";
import { createWholeHomeDemoState } from "./house-demo.js";
import { icon } from "./icons.js";
import { openFloorplanImporter } from "./floorplan-import-ui.js";
import { toSceneObject } from "./src/contracts/scene.js";
import { houseToPrimaryStudioRoom } from "./src/spatial/floorplan-geometry.js";
import { confirmImportedHouse, importSampleFloorplan } from "./src/spatial/floorplan-importer.js";
import { createBlockedRouteDemo } from "./src/simulation/studio-replay-demo.js";

const finishes = { oak: "#d0b493", walnut: "#9a7459", stone: "#c3c1b8" };
const paints = {
  Chalk: "#eee7dc",
  Sand: "#dcc8ac",
  Sage: "#b7c1aa",
  Clay: "#c99782",
};
const kinds = {
  sofa: "Sofa",
  chair: "Chair",
  table: "Coffee table",
  desk: "Desk",
  bookcase: "Bookcase",
  console: "Cabinet",
  lamp: "Lamp",
  rug: "Rug",
  plant: "Plant",
  bed: "Bed",
};
const walls = ["back", "left", "front", "right"];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const limits = { width: [3, 9], depth: [3, 9], height: [2.1, 4.5] };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const snap = (n) => Math.round(n * 10) / 10;
const uid = () => crypto.randomUUID();
const selected = (a, b) => (a === b ? " selected" : "");
const option = (value, label, current) =>
  '<option value="' +
  esc(value) +
  '"' +
  selected(value, current) +
  ">" +
  esc(label) +
  "</option>";
const selectOptions = (kind) =>
  Object.entries(kinds)
    .map(([k, name]) => option(k, name, kind))
    .join("");
function buildMercerSampleStarterItems() {
  const byId = (id) => catalog.find((p) => p.id === id);
  const place = (productId, overrides) => {
    const product = byId(productId);
    if (!product) return null;
    const base = createItem(
      overrides.name ? { ...product, name: overrides.name } : product,
      overrides,
    );
    return toSceneObject({
      ...base,
      roomId: overrides.roomId,
      type: overrides.owned ? "existing" : "shopify",
      locked: false,
    });
  };

  return [
    place("stone-table", {
      id: "kitchen-table-1",
      roomId: "kitchen",
      name: "Breakfast Bistro Table",
      x: 7.25,
      z: 1.35,
      rotation: 0,
    }),
    place("linen-chair", {
      id: "kitchen-chair-1",
      roomId: "kitchen",
      name: "Kitchen Café Chair",
      x: 6.42,
      z: 1.35,
      rotation: 90,
    }),
    place("linen-sofa", {
      id: "living-sofa-1",
      roomId: "living-room",
      x: 2.9,
      z: 3.25,
      rotation: 180,
      owned: true,
    }),
    place("oat-rug", {
      id: "living-rug-1",
      roomId: "living-room",
      x: 2.9,
      z: 2.25,
      rotation: 0,
    }),
    place("brass-lamp", {
      id: "living-lamp-1",
      roomId: "living-room",
      x: 4.5,
      z: 3.4,
      rotation: 0,
    }),
    place("olive-tree", {
      id: "living-plant-1",
      roomId: "living-room",
      x: 0.65,
      z: 0.65,
      rotation: 0,
    }),
    place("cream-bed", {
      id: "bedroom-bed-1",
      roomId: "bedroom",
      x: 1.65,
      z: 7.25,
      rotation: 0,
    }),
  ].filter(Boolean);
}

function roomDefaults(value = {}) {
  const room = normalizeArchitecture(value);
  return {
    ...room,
    wallColor: room.wallColor ?? paints.Chalk,
    openings: room.openings.map((o, i) => ({
      ...o,
      id: value.openings?.[i]?.id || uid(),
    })),
  };
}

function drawing(room) {
  const s = Math.min(436 / room.width, 250 / room.depth);
  const w = room.width * s,
    d = room.depth * s,
    x = (560 - w) / 2,
    y = (360 - d) / 2;
  const inset = room.shape === "alcove";
  const endX = x + w,
    endY = y + d;
  const cutX = inset ? x + 0.66 * w : endX;
  const cutY = inset ? y + 0.64 * d : endY;
  const path =
    "M " +
    x +
    " " +
    y +
    " H " +
    endX +
    " V " +
    cutY +
    " H " +
    cutX +
    " V " +
    endY +
    " H " +
    x +
    " Z";
  const color = finishes[room.floorFinish] || finishes.oak;
  const lines =
    room.floorFinish === "stone"
      ? '<path d="M 0 0 H 42 V 36 H 0 Z" fill="none" stroke="#91887b" stroke-opacity=".4" stroke-width="1"/>'
      : '<path d="M 0 0 H 80 M 0 12 H 80 M 0 24 H 80 M 36 0 V 12 M 13 12 V 24" fill="none" stroke="#72593e" stroke-opacity=".30" stroke-width=".8"/>';
  const measureX = y - 24,
    measureY = x - 26;
  const openings = roomWalls(room)
    .flatMap((wall) =>
      wallOpenings(room, wall).map((o) => {
        const center = (o.left + o.right) / 2;
        const a = 280 + (wall.x + center * Math.cos(wall.angle)) * s;
        const b = 180 + (wall.z - center * Math.sin(wall.angle)) * s;
        const span = (o.right - o.left) * s;
        const angle = (-wall.angle * 180) / Math.PI;
        const half = span / 2;
        const glyph =
          o.kind === "door"
            ? '<path d="M ' +
              -half +
              " 0 V " +
              span +
              " A " +
              span +
              " " +
              span +
              " 0 0 0 " +
              half +
              ' 0" fill="none" stroke="#73573e" stroke-width="1.4"/>'
            : '<path d="M ' +
              -half +
              " -2.3 H " +
              half +
              " M " +
              -half +
              " 2.3 H " +
              half +
              '" stroke="#597677" stroke-width="1.4"/>';
        return (
          '<g transform="translate(' +
          a +
          " " +
          b +
          ") rotate(" +
          angle +
          ')"><path d="M ' +
          -half +
          " 0 H " +
          half +
          '" stroke="#f9f6ec" stroke-width="9"/>' +
          glyph +
          "</g>"
        );
      }),
    )
    .join("");
  function handle(axis, cx, cy, rotation) {
    return (
      '<g class="plan-grip" data-axis="' +
      axis +
      '" transform="translate(' +
      cx +
      " " +
      cy +
      ") rotate(" +
      rotation +
      ')"><rect x="-21" y="-15" width="42" height="30" fill="transparent"/><rect x="-15" y="-7" width="30" height="14" rx="7" fill="#fffaf2" stroke="#975039"/><path d="m-9 0 3-2.5 m-3 2.5 3 2.5 M9 0 6-2.5 M9 0 6 2.5 M-4 0 h8" fill="none" stroke="#975039" stroke-width="1.2"/></g>'
    );
  }
  const paint = /^#[a-f0-9]{6}$/i.test(room.wallColor)
    ? room.wallColor
    : paints.Chalk;
  return (
    '<svg class="setup-drawing" role="img" aria-label="Dimensioned ' +
    (inset ? "alcove" : "rectangular") +
    ' floor plan" viewBox="0 0 560 360" data-scale="' +
    s +
    '"><defs><pattern id="setup-surface" width="' +
    (room.floorFinish === "stone" ? 42 : 80) +
    '" height="' +
    (room.floorFinish === "stone" ? 36 : 24) +
    '" patternUnits="userSpaceOnUse">' +
    lines +
    "</pattern></defs>" +
    '<path d="' +
    path +
    '" fill="' +
    color +
    '" stroke="#575346" stroke-width="9" stroke-linejoin="round"/><path d="' +
    path +
    '" fill="url(#setup-surface)" stroke="' +
    paint +
    '" stroke-width="4"/>' +
    openings +
    '<g stroke="#75786b" stroke-width="1"><path d="M ' +
    x +
    " " +
    measureX +
    " h " +
    w +
    " m 0 -4 v 8 M " +
    x +
    " " +
    (measureX - 4) +
    " v8 M " +
    measureY +
    " " +
    y +
    " v " +
    d +
    " m -4 0 h8 M " +
    (measureY - 4) +
    " " +
    y +
    ' h8"/></g>' +
    '<g fill="#4a4e43" font-size="13" font-family="Segoe UI, sans-serif" text-anchor="middle"><text x="' +
    (x + w / 2) +
    '" y="' +
    (measureX - 7) +
    '">' +
    room.width.toFixed(1) +
    ' m</text><text transform="translate(' +
    (measureY - 7) +
    " " +
    (y + d / 2) +
    ') rotate(-90)">' +
    room.depth.toFixed(1) +
    " m</text></g>" +
    handle("width", endX, y + (cutY - y) * 0.42, 0) +
    handle("depth", x + (cutX - x) * 0.56, endY, 90) +
    "</svg>"
  );
}

function resizedItems(items, oldRoom, room) {
  const placed = [];
  for (const item of items) {
    const candidate = {
      ...item,
      x: (item.x * room.width) / oldRoom.width,
      z: (item.z * room.depth) / oldRoom.depth,
    };
    const best = fitItem(candidate, room, placed);
    if (!best)
      throw Error(
        "There is not enough space for " +
          item.name +
          ". Enlarge the room or remove that piece.",
      );
    placed.push(best);
  }
  return placed;
}

export function openSetup({ state, isNew, initialStep = null, onApply, onCancel, readPhoto }) {
  const host = document.getElementById("setup-page");
  let step = initialStep ?? (isNew ? 1 : 2);
  let source = isNew ? "custom" : state.roomPhoto ? "photo" : "custom";
  const draft = {
    room: roomDefaults(isNew ? {} : structuredClone(state.room ?? {})),
    roomName: isNew ? "My living room" : state.roomName,
    photo: isNew ? null : state.roomPhoto,
    items: isNew ? [] : structuredClone(state.items),
    additions: [],
  };
  let detection = "idle",
    message = "",
    error = "",
    active = true,
    photoToken = 0,
    drag;
  const $ = (s) => host.querySelector(s);
  const dims = () =>
    "<span>" +
    draft.room.width.toFixed(1) +
    " × " +
    draft.room.depth.toFixed(1) +
    " m</span>";
  function onExit() {
    active = false;
    ++photoToken;
    host.onpointermove = null;
    host.onpointerup = null;
  }
  function leave(next, demo, extra = {}) {
    onExit();
    onApply(next, { demo, ...extra });
  }
  function stepper() {
    return (
      '<ol class="setup-steps" aria-label="Room setup progress">' +
      ["Start", "Floor plan", "Furniture"]
        .map(
          (s, i) =>
            "<li" +
            (step === i + 1 ? ' aria-current="step"' : "") +
            ' class="' +
            (step > i + 1 ? "done" : "") +
            '"><span>' +
            (step > i + 1 ? icon("check") : i + 1) +
            "</span>" +
            s +
            "</li>",
        )
        .join("") +
      "</ol>"
    );
  }
  function first() {
    return (
      '<div class="setup-start-grid"><section class="setup-welcome"><p class="eyebrow">Room setup</p><h1 tabindex="-1">Start with your room.</h1><p class="setup-lead">Bring in a room photo or build a floor plan. Then design around the furniture you own.</p>' +
      '<label class="start-option start-option-photo"><span class="start-symbol">' +
      icon("image") +
      '</span><span><strong>Upload a room photo</strong><small>Review the furniture found in your photo.</small></span><span class="start-arrow">↗</span><input type="file" id="room-photo-upload" accept="image/*"></label>' +
      '<button class="text-btn sample-photo-link" id="try-sample-photo">Try a sample photo <span aria-hidden="true">→</span></button>' +
      '<label class="start-option start-option-floorplan"><span class="start-symbol">' +
      icon("cube") +
      '</span><span><strong>Import a whole-home floorplan</strong><small>Extract multi-room walls, doors, windows, and locked fixtures.</small></span><span class="start-arrow">↗</span><input type="file" id="floorplan-upload" accept="image/png,image/jpeg,image/webp"></label>' +
      '<button class="text-btn sample-photo-link" id="try-sample-floorplan">Try sample whole-home floorplan <span aria-hidden="true">→</span></button>' +
      '<button class="text-btn sample-photo-link" id="try-replay-demo">Try blocked-route replay demo <span aria-hidden="true">→</span></button>' +
      '<button class="start-option" id="custom-room"><span class="start-symbol">' +
      icon("room") +
      '</span><span><strong>Build a custom room</strong><small>Set the shape, dimensions, and finishes.</small></span><span class="start-arrow">→</span></button>' +
      '<button class="start-option" id="whole-home-demo"><span class="start-symbol">' +
      icon("house") +
      '</span><span><strong>Try whole-home demo</strong><small>Explore a connected 4-room house with fixed fixtures.</small></span><span class="start-arrow">→</span></button>' +
      '<p class="setup-error" role="status">' +
      esc(error) +
      '</p></section><section class="setup-sample"><div class="sample-preview">' +
      drawing(roomDefaults()) +
      '<img src="/assets/sample-room.jpg" alt="Sample living room with a sofa and lounge chair" class="sample-room-photo"></div>' +
      '<div class="sample-caption"><div><p class="eyebrow">Sample project</p><h2>Brooklyn living room</h2></div><button id="explore-demo" class="secondary">Explore demo <span aria-hidden="true">→</span></button></div></section></div>'
    );
  }
  function openingsMarkup() {
    return draft.room.openings
      .map(
        (o) =>
          '<div class="opening-row" data-opening="' +
          esc(o.id) +
          '"><div class="opening-line"><strong>' +
          cap(o.kind) +
          '</strong><select aria-label="' +
          cap(o.kind) +
          ' wall" data-opening-field="wall">' +
          walls.map((w) => option(w, cap(w) + " wall", o.wall)).join("") +
          '</select><button class="icon-btn" data-remove-opening="' +
          esc(o.id) +
          '" aria-label="Remove ' +
          o.kind +
          '">' +
          icon("close") +
          '</button></div><label>Position <input type="range" min=".05" max=".95" step=".01" value="' +
          o.offset +
          '" data-opening-field="offset"></label></div>',
      )
      .join("");
  }
  function details() {
    const capture = draft.photo
      ? '<div class="setup-capture"><img src="' +
        esc(draft.photo) +
        '" alt="Uploaded room reference"><div><strong>Your room photo</strong><p>Use the starting dimensions as an estimate. Enter measurements here if you know them.</p></div></div>'
      : "";
    return (
      '<div class="setup-grid"><section class="setup-plan-panel"><div class="setup-panel-title"><span>' +
      icon("room") +
      ' Floor plan</span><span class="setup-plan-dims">' +
      dims() +
      "</span></div>" +
      capture +
      '<div class="setup-plan-preview">' +
      drawing(draft.room) +
      '</div><p class="setup-hint">' +
      icon("move") +
      " Drag a wall handle or enter dimensions.</p></section>" +
      '<section class="setup-controls"><label class="field">Room name<input id="setup-name" maxlength="60" required value="' +
      esc(draft.roomName) +
      '"></label><div class="setup-shape-line"><label class="field">Room shape<select id="room-shape">' +
      option("rectangle", "Rectangle", draft.room.shape) +
      option("alcove", "L-shaped room", draft.room.shape) +
      "</select></label></div>" +
      '<div class="setup-dimensions">' +
      Object.entries(limits)
        .map(
          ([k, [lo, hi]]) =>
            '<label class="field">' +
            cap(k) +
            ' (m)<input type="number" id="room-' +
            k +
            '" min="' +
            lo +
            '" max="' +
            hi +
            '" step="' +
            (k === "height" ? ".01" : ".1") +
            '" value="' +
            draft.room[k] +
            '"></label>',
        )
        .join("") +
      "</div>" +
      '<fieldset><legend class="section-label">Wall paint</legend><div class="finish-options">' +
      Object.entries(
        Object.values(paints).includes(draft.room.wallColor)
          ? paints
          : { "Photo finish": draft.room.wallColor, ...paints },
      )
        .map(
          ([label, color]) =>
            '<button class="paint-chip" data-paint="' +
            color +
            '" aria-label="' +
            label +
            ' wall paint" title="' +
            label +
            '" aria-pressed="' +
            (draft.room.wallColor === color) +
            '" style="--chip:' +
            color +
            '"></button>',
        )
        .join("") +
      "</div></fieldset>" +
      '<fieldset><legend class="section-label">Floor finish</legend><div class="finish-options">' +
      Object.entries(finishes)
        .map(
          ([key, color]) =>
            '<button class="finish-chip" data-floor="' +
            key +
            '" aria-pressed="' +
            (draft.room.floorFinish === key) +
            '"><i style="background:' +
            color +
            '"></i>' +
            cap(key) +
            "</button>",
        )
        .join("") +
      "</div></fieldset>" +
      '<fieldset><legend class="section-label">Doors and windows</legend><div id="setup-openings">' +
      openingsMarkup() +
      '</div><p id="opening-error" class="setup-error" role="status"></p><div class="opening-actions"><button id="add-door" class="secondary">+ Door</button><button id="add-window" class="secondary">+ Window</button></div></fieldset></section></div>'
    );
  }
  function statusText() {
    if (detection === "loading")
      return message || "Looking for furniture in your photo…";
    if (detection === "failed")
      return (
        message || "Photo detection is unavailable. Add your pieces below."
      );
    if (detection === "done") return message;
    return "";
  }
  function inventory() {
    const owned = draft.items.filter((i) => i.owned);
    const rows =
      owned
        .map(
          (i) =>
            '<div class="owned-entry" data-owned-card="' +
            esc(i.id) +
            '"><span class="owned-icon">' +
            icon(i.kind) +
            '</span><div class="owned-card-main"><div class="owned-card-head"><span class="bp-owned-badge">Owned</span><span class="bp-kind-label">' +
            esc(kinds[i.kind] || i.kind) +
            "</span></div>" +
            '<label class="field">Item name<input value="' +
            esc(i.name) +
            '" data-kept-name="' +
            esc(i.id) +
            '" maxlength="65"></label>' +
            '<div class="owned-dims-row" aria-label="Edit dimensions">' +
            '<label class="field">W (m)<input type="number" min="0.05" max="10" step="any" value="' +
            Number(i.width || 0.8).toFixed(2) +
            '" data-kept-dim="width" data-kept-id="' +
            esc(i.id) +
            '"></label>' +
            '<label class="field">D (m)<input type="number" min="0.05" max="10" step="any" value="' +
            Number(i.depth || 0.8).toFixed(2) +
            '" data-kept-dim="depth" data-kept-id="' +
            esc(i.id) +
            '"></label>' +
            '<label class="field">H (m)<input type="number" min="0.05" max="10" step="any" value="' +
            Number(i.height || 0.85).toFixed(2) +
            '" data-kept-dim="height" data-kept-id="' +
            esc(i.id) +
            '"></label></div></div><button class="icon-btn" data-remove-kept="' + +
            esc(i.id) +
            '" aria-label="Remove ' +
            esc(i.name) +
            '">' +
            icon("close") +
            "</button></div>",
        )
        .join("") +
      draft.additions
        .map(
          (i) =>
            '<div class="review-entry" data-draft="' +
            esc(i.id) +
            '"><div class="owned-card-head"><span class="bp-owned-badge">Owned</span><span class="bp-kind-label">' +
            esc(i.detected ? "Detected from photo" : "Manual piece") +
            '</span></div><div class="review-entry-grid"><label class="field">Piece<select data-kind>' +
            selectOptions(i.kind) +
            '</select></label><label class="field">Name<input maxlength="65" value="' +
            esc(i.name) +
            '" data-name></label><label class="field">Qty<input type="number" min="1" max="8" step="1" value="' +
            i.count +
            '" data-count></label><button class="icon-btn" data-remove-draft="' +
            esc(i.id) +
            '" aria-label="Remove ' +
            esc(i.name) +
            '">' +
            icon("close") +
            "</button></div></div>",
        )
        .join("");
    return (
      '<div class="setup-grid setup-review-grid"><section class="setup-photo-pane">' +
      (draft.photo
        ? '<img src="' +
          esc(draft.photo) +
          '" alt="Your uploaded room" class="review-photo">'
        : '<div class="setup-plan-preview">' + drawing(draft.room) + "</div>") +
      '<div class="review-caption"><span>' +
      esc(draft.roomName) +
      "</span>" +
      dims() +
      "</div>" +
      '<label class="start-option start-option-photo" style="margin-top:12px"><span class="start-symbol">' +
      icon("image") +
      '</span><span><strong>Upload existing furniture photo</strong><small>Auto-detect sofa, table, chairs, bed, or plants.</small></span><span class="start-arrow">↗</span><input type="file" id="furniture-photo-upload" accept="image/*"></label>' +
      "</section>" +
      '<section class="setup-controls"><p class="eyebrow">Step 3 · Your Furniture</p><h2>Pieces you already own</h2><p class="setup-help">Confirm detected pieces, edit dimensions in meters, or add items you are keeping.</p><p role="status" id="detect-status">' +
      esc(statusText()) +
      '</p><div id="setup-inventory">' +
      (rows || '<p class="empty-pieces">Your furniture list is empty.</p>') +
      '</div><div class="quick-add"><label class="field">Add a piece<select id="owned-kind">' +
      selectOptions("chair") +
      '</select></label><button class="secondary" id="add-owned">' +
      icon("plus") +
      " Add</button></div></section></div>"
    );
  }
  function render(focus = false) {
    if (!active) return;
    const title = step === 2 ? "Shape your room." : "Keep your furniture.";
    host.innerHTML =
      '<div class="setup-shell">' +
      stepper() +
      (step === 1
        ? first()
        : '<div class="setup-heading"><p class="eyebrow">Room setup</p><h1 tabindex="-1">' +
          title +
          "</h1></div>" +
          (step === 2 ? details() : inventory()) +
          '<div class="setup-footer"><button id="setup-back" class="secondary">← Back</button><p class="setup-error" role="status">' +
          esc(error) +
          '</p><button class="primary" id="setup-next">' +
          (step === 2
            ? source === "photo"
              ? "Use this footprint"
              : "Review furniture"
            : detection === "loading"
              ? "Use current list"
              : "Continue to styling") +
          ' <span aria-hidden="true">→</span></button></div>') +
      (isNew && step === 1 && typeof onCancel === "function"
        ? '<button class="text-btn" id="resume-room">Resume current room</button>'
        : !isNew
          ? '<button class="text-btn" id="setup-cancel">Cancel changes</button>'
          : "") +
      "</div>";
    if (step === 1)
      $(".sample-room-photo").onerror = (e) => (e.target.hidden = true);
    if (step === 2) validateOpenings();
    if (focus) {
      window.scrollTo({ top: 0, behavior: "instant" });
      $("h1")?.focus({ preventScroll: true });
    }
  }
  function stepTo(s) {
    step = s;
    error = "";
    render(true);
  }
  function validateOpenings() {
    const wall = openingConflict(draft.room);
    $("#opening-error").textContent = wall
      ? "Openings overlap on the " +
        wall +
        " wall. Slide them apart, change walls, or remove one."
      : "";
    $("#setup-next").disabled = Boolean(wall);
  }
  function refreshPlan() {
    if (step !== 2) return;
    $(".setup-plan-preview").innerHTML = drawing(draft.room);
    $(".setup-plan-dims").innerHTML = dims();
    validateOpenings();
    for (const key of Object.keys(limits))
      if (document.activeElement?.id !== "room-" + key)
        $("#room-" + key).value = draft.room[key];
  }
  function mergeDetection(list) {
    const used = new Map();
    for (const item of draft.items.filter((i) => i.owned))
      used.set(item.kind, (used.get(item.kind) || 0) + 1);
    for (const item of draft.additions)
      used.set(item.kind, (used.get(item.kind) || 0) + item.count);
    const found = new Map();
    for (const item of list) {
      if (!(item.kind in kinds)) continue;
      const n = clamp(Number(item.count) || 1, 1, 8);
      const total = (found.get(item.kind) || 0) + n;
      const needed = Math.max(0, total - (used.get(item.kind) || 0));
      found.set(item.kind, total);
      if (needed) {
        draft.additions.push({
          id: uid(),
          kind: item.kind,
          name: String(item.name || kinds[item.kind]),
          count: Math.min(n, needed),
          positions: item.positions,
          detected: true,
        });
      }
    }
    return found.size;
  }
  async function detect(file, token) {
    detection = "loading";
    message = "";
    try {
      const { detectFurnishings } = await import("./detection.js");
      const list = await detectFurnishings(file, (s) => {
        if (active && photoToken === token && typeof s === "string") {
          message = s;
          const node = $("#detect-status");
          if (node) node.textContent = s;
        }
      });
      if (!active || photoToken !== token) return;
      const n = mergeDetection(list || []);
      detection = "done";
      message = n
        ? "Review the photo-derived previews. Their dimensions and floor positions are estimated."
        : "No furniture was recognized. Add pieces below or continue with an empty room.";
    } catch {
      if (!active || photoToken !== token) return;
      detection = "failed";
      message =
        "Furniture detection could not finish. Add your pieces below or choose another photo.";
    }
    if (step === 3) render();
  }
  async function photo(file) {
    if (!file) return;
    const token = ++photoToken;
    error = "";
    try {
      const result = await readPhoto(file);
      if (!active || token !== photoToken || !result) return;
      draft.additions = draft.additions.filter((i) => !i.detected);
      draft.photo = result.url;
      if (isNew) {
        if (/^#[a-f0-9]{6}$/i.test(result.wallColor))
          draft.room.wallColor = result.wallColor;
        if (Object.hasOwn(finishes, result.floorFinish))
          draft.room.floorFinish = result.floorFinish;
      }
      source = "photo";
      stepTo(2);
      void detect(file, token);
    } catch {
      if (active && token === photoToken) {
        error = "Choose a supported image smaller than 20 MB.";
        render();
      }
    }
  }
  function finish() {
    const oldRoom = state.room || ROOM;
    const wholeHome = !isNew && (state.importedHouse || state.house);
    const changed =
      !isNew && !wholeHome &&
      (draft.room.width !== oldRoom.width ||
        draft.room.depth !== oldRoom.depth ||
        draft.room.shape !== (oldRoom.shape || "rectangle") ||
        JSON.stringify(draft.room.openings) !==
          JSON.stringify(roomDefaults(oldRoom).openings));
    let items = changed
      ? resizedItems(draft.items, oldRoom, draft.room)
      : [...draft.items];
    for (const piece of draft.additions) {
      for (let n = 0; n < piece.count; n++) {
        const [item] = createOwnedItems(
          kinds[piece.kind],
          items.map((i) => ({ ...i, owned: false })),
          draft.room,
        );
        if (!item)
          throw Error(
            "There is no clear spot for " +
              piece.name +
              ". Enlarge the room or reduce the furniture list.",
          );
        const hint = piece.positions?.[n];
        let placed = item;
        if (Number.isFinite(hint?.x) && Number.isFinite(hint?.y)) {
          placed =
            fitItem(
              {
                ...item,
                // A single view estimates the front silhouette. Keep depth at the furniture-type estimate.
                width: Number.isFinite(hint.aspectRatio) && hint.aspectRatio > 0
                  ? clamp(item.height * hint.aspectRatio, item.width * 0.75, item.width * 1.25)
                  : item.width,
                x: (clamp(hint.x, 0, 1) - 0.5) * draft.room.width,
                z: (clamp(hint.y, 0, 1) - 0.5) * draft.room.depth,
              },
              draft.room,
              items,
            ) ?? item;
        }
        items.push({
          ...placed,
          color: hint?.color ?? placed.color,
          ...(piece.detected && hint ? { photoPreview: true, dimensionsSource: "estimated" } : {}),
          name: piece.name || kinds[piece.kind],
          id: uid(),
        });
      }
    }
    leave(
      {
        ...state,
        house: isNew ? null : state.house,
        roomName: draft.roomName.trim() || "My living room",
        room: draft.room,
        roomPhoto: draft.photo,
        importedHouse: isNew ? null : state.importedHouse,
        items,
        spent: getSpend(items),
      },
      false,
    );
  }
  function finishFloorplanImport(confirmedHouse, { items = [], householdDraft } = {}) {
    leave({
      ...state,
      roomName: confirmedHouse.name || "Imported Home",
      room: roomDefaults(houseToPrimaryStudioRoom(confirmedHouse)),
      roomPhoto: null,
      importedHouse: confirmedHouse,
      items,
      spent: 0,
    }, false, { householdDraft });
  }
  function launchFloorplanFlow(initialMode, initialFile = null) {
    ++photoToken;
    openFloorplanImporter({
      host,
      initialMode,
      initialFile,
      onBack() {
        bindSetupHandlers();
        render(true);
      },
      onConfirmed(confirmedHouse) {
        const starterItems =
          Array.isArray(confirmedHouse.objects) && confirmedHouse.objects.length > 0
            ? confirmedHouse.objects
            : confirmedHouse.id === "mercer-apartment-sample"
              ? buildMercerSampleStarterItems()
              : [];
        finishFloorplanImport(confirmedHouse, { items: starterItems });
      },
    });
  }
  function bindSetupHandlers() {
  host.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || !host.contains(b)) return;
    if (b.id === "setup-cancel" || b.id === "resume-room") {
      onExit();
      onCancel?.();
      return;
    }
    if (b.id === "try-sample-floorplan") {
      launchFloorplanFlow("sample");
      return;
    }
    if (b.id === "try-replay-demo") {
      finishFloorplanImport(confirmImportedHouse(importSampleFloorplan()), createBlockedRouteDemo());
      return;
    }
    if (b.id === "try-sample-photo") {
      b.disabled = true;
      const token = ++photoToken;
      fetch("/assets/sample-capture.jpg")
        .then(async (response) => {
          if (!response.ok) throw Error("Sample unavailable");
          const image = await response.blob();
          if (active && step === 1 && token === photoToken)
            await photo(
              new File([image], "Sample room.jpg", { type: "image/jpeg" }),
            );
        })
        .catch(() => {
          if (active && token === photoToken) {
            error =
              "The sample photo could not load. Upload a room photo or build a custom room.";
            render();
          }
        });
      return;
    }
    if (b.id === "whole-home-demo") {
      leave(createWholeHomeDemoState(), true, { wholeHome: true });
      return;
    }
    if (b.id === "explore-demo") {
      const sample = initialState();
      leave({ ...sample, house: null, room: roomDefaults(sample.room) }, true);
      return;
    }
    if (b.id === "custom-room") {
      if (source === "photo" && isNew) {
        ++photoToken;
        draft.photo = null;
        draft.additions = draft.additions.filter((i) => !i.detected);
        detection = "idle";
      }
      source = "custom";
      stepTo(2);
      return;
    }
    if (b.id === "setup-back") {
      stepTo(step - 1);
      return;
    }
    if (b.id === "setup-next") {
      const invalid = Array.from(host.querySelectorAll("input")).find(
        (i) => !i.reportValidity(),
      );
      if (invalid) return;
      if (step === 2) {
        if (openingConflict(draft.room)) return;

        stepTo(3);
        return;
      }
      try {
        finish();
      } catch (err) {
        error = err.message;
        render();
      }
      return;
    }
    if (b.dataset.paint) {
      draft.room.wallColor = b.dataset.paint;
      render();
      return;
    }
    if (b.dataset.floor) {
      draft.room.floorFinish = b.dataset.floor;
      render();
      return;
    }
    if (b.id === "add-door" || b.id === "add-window") {
      draft.room.openings.push({
        id: uid(),
        kind: b.id === "add-door" ? "door" : "window",
        wall: b.id === "add-door" ? "left" : "back",
        offset: 0.5,
      });
      render();
      return;
    }
    if (b.dataset.removeOpening) {
      draft.room.openings = draft.room.openings.filter(
        (o) => o.id !== b.dataset.removeOpening,
      );
      render();
      return;
    }
    if (b.id === "add-owned") {
      const kind = $("#owned-kind").value;
      draft.additions.push({ id: uid(), kind, name: kinds[kind], count: 1 });
      render();
      return;
    }
    if (b.dataset.removeKept) {
      draft.items = draft.items.filter((i) => i.id !== b.dataset.removeKept);
      render();
      return;
    }
    if (b.dataset.removeDraft) {
      draft.additions = draft.additions.filter(
        (i) => i.id !== b.dataset.removeDraft,
      );
      render();
    }
  };
  host.oninput = (e) => {
    const node = e.target;
    if (node.id === "setup-name") draft.roomName = node.value;
    if (
      ["room-width", "room-depth", "room-height"].includes(node.id) &&
      node.validity.valid &&
      node.value
    ) {
      draft.room[node.id.slice(5)] = Number(node.value);
      refreshPlan();
    }
    if (node.id === "room-shape") {
      draft.room.shape = node.value;
      refreshPlan();
    }
    const wrap = node.closest("[data-opening]");
    if (wrap && node.dataset.openingField) {
      const o = draft.room.openings.find((o) => o.id === wrap.dataset.opening);
      o[node.dataset.openingField] =
        node.dataset.openingField === "offset"
          ? Number(node.value)
          : node.value;
      refreshPlan();
    }
    if (node.dataset.keptName) {
      draft.items.find((i) => i.id === node.dataset.keptName).name = node.value;
    }
    if (node.dataset.keptDim && node.dataset.keptId && node.validity.valid && node.value) {
      const target = draft.items.find((i) => i.id === node.dataset.keptId);
      if (target) target[node.dataset.keptDim] = clamp(Number(node.value), 0.2, 4.5);
    }
    const row = node.closest("[data-draft]");
    if (!row) return;
    const item = draft.additions.find((i) => i.id === row.dataset.draft);
    if (node.matches("[data-kind]")) {
      item.kind = node.value;
      item.name = kinds[item.kind];
      row.querySelector("[data-name]").value = item.name;
    }
    if (node.matches("[data-name]")) item.name = node.value;
    if (node.matches("[data-count]") && node.validity.valid && node.value)
      item.count = Math.floor(Number(node.value));
  };
  host.onchange = (e) => {
    if (e.target.id === "room-photo-upload" || e.target.id === "furniture-photo-upload") {
      const targetStepAfter = e.target.id === "furniture-photo-upload" ? 3 : 2;
      const file = e.target.files[0];
      if (targetStepAfter === 3 && file) {
        const token = ++photoToken;
        readPhoto(file)
          .then((res) => {
            if (!active || token !== photoToken || !res) return;
            draft.photo = res.url;
            render();
            return detect(file, token);
          })
          .catch(() => {});
      } else {
        void photo(file);
      }
    }
    if (e.target.id === "floorplan-upload" && e.target.files?.[0]) {
      launchFloorplanFlow("upload", e.target.files[0]);
    }
  };
  host.onpointerdown = (e) => {
    const handle = e.target.closest(".plan-grip");
    if (!handle || step !== 2) return;
    const svg = handle.closest("svg");
    drag = {
      axis: handle.dataset.axis,
      x: e.clientX,
      y: e.clientY,
      room: { ...draft.room },
      pixels: Number(svg.dataset.scale) * svg.getScreenCTM().a,
      id: e.pointerId,
    };
    host.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  host.onpointermove = (e) => {
    if (drag?.id !== e.pointerId) return;
    const axis = drag.axis,
      delta = axis === "width" ? e.clientX - drag.x : e.clientY - drag.y;
    draft.room[axis] = clamp(
      snap(drag.room[axis] + delta / drag.pixels),
      ...limits[axis],
    );
    refreshPlan();
  };
  host.onpointerup = host.onpointercancel = () => {
    drag = null;
  };
  }
  bindSetupHandlers();
  render(true);
}
