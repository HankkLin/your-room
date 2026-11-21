import {
  ROOM,
  initialState,
  autoStyle,
  catalog,
  styles,
  createItem,
  createOwnedItems,
  getSpend,
  canPlaceItem,
  fitItem,
} from "./model.js";
import { createScene } from "./scene.js";
import { createPlanScene } from "./scene-fallback.js";
import { openSetup } from "./setup.js";
import {
  normalizeArchitecture,
  footprintCorners,
  roomWalls,
  wallOpenings,
} from "./room-layout.js";
import { icon } from "./icons.js";
import { showParsedGeometryModal } from "./floorplan-import-ui.js";
import {
  clearConfirmedImportedHouse,
  getConfirmedImportedHouse,
  setConfirmedImportedHouse,
} from "./src/spatial/floorplan-importer.js";

export { getConfirmedImportedHouse };
if (typeof window !== "undefined") {
  window.getConfirmedImportedHouse = getConfirmedImportedHouse;
}

const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const currency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
const palettes = {
  "Warm minimal": ["#d6c4a9", "#b08e6b", "#785c49"],
  "Soft modern": ["#c4cbd0", "#919fa6", "#727780"],
  "Earthy eclectic": ["#b0654b", "#868c62", "#c4a258"],
};
const storageKey = "stillroom.project.v1";
const demo = initialState();
let state = demo;
let hasProject = false;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (
    saved &&
    Array.isArray(saved.items) &&
    saved.style in styles &&
    typeof saved.roomName === "string"
  ) {
    state = { ...demo, ...saved };
    hasProject = true;
    if (state.importedHouse) {
      try {
        setConfirmedImportedHouse(state.importedHouse);
      } catch {
        state.importedHouse = null;
      }
    }
  }
} catch {
  /* A new local project also works with storage disabled. */
}
let selection = null;
let draftStyle = state.style;
let pickedStyle = false;
let reference = state.reference || null;
let history = [];
let view = "interior";
let stage = "setup";
let toastTimer;
let scene;
const dialog = $("#dialog");
document.querySelectorAll("[data-icon]").forEach((node) => {
  node.innerHTML = icon(node.dataset.icon);
});

function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    $("#save-state").textContent = "Saved on this device";
  } catch {
    $("#save-state").textContent = "Session only";
  }
}
function commit(next) {
  history.push(state);
  if (history.length > 20) history.shift();
  state = { ...next, spent: getSpend(next.items) };
  if (!state.items.some((i) => i.id === selection)) selection = null;
  persist();
  render();
}
function syncForm() {
  draftStyle = state.style;
  pickedStyle = false;
  reference = state.reference || null;
  $("#brief").value = state.brief || "";
  $("#budget").value = state.budget;
  renderDraft();
}
function renderDraft() {
  $("#styles").innerHTML = Object.entries(palettes)
    .map(
      ([label, colors]) =>
        `<button type="button" class="style-choice" data-style="${label}" aria-pressed="${label === draftStyle}"><span class="swatches">${colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span>${label}</button>`,
    )
    .join("");
  $("#reference-label").textContent = reference
    ? "Change inspiration photo"
    : "Add inspiration photo";
  $("#remove-ref").hidden = !reference;
  document.querySelector(".reference-preview")?.remove();
  if (reference) {
    const img = new Image();
    img.src = reference;
    img.alt = "Style reference";
    img.className = "reference-preview";
    $(".reference-wrap").prepend(img);
  }
}
function itemGlyph(item) {
  const kind = ["bookcase", "storage", "shelf"].includes(item.kind)
    ? "cabinet"
    : item.kind;
  return `<span class="item-swatch" style="background:${/^#[\da-f]{3,8}$/i.test(item.color) ? item.color : "#cdc5b6"}">${icon(kind)}</span>`;
}
function render() {
  $("#room-name").textContent = state.roomName;
  const room = state.room || ROOM;
  $(".subtitle").textContent = state.importedHouse
    ? `${state.importedHouse.bounds.width} × ${state.importedHouse.bounds.depth} m · ${state.importedHouse.rooms.length} rooms imported`
    : `${room.width} × ${room.depth} m · Living space`;
  $("#item-count").textContent = state.items.length;
  $("#shop-count").textContent = state.savedProducts?.length || "";
  $("#undo").disabled = !history.length;
  $("#compare-photo").hidden = !state.roomPhoto;
  $("#view-house-json").hidden = !state.importedHouse;
  const item = state.items.find((i) => i.id === selection);
  $("#objectbar").innerHTML = item
    ? `<strong>${escape(item.name)}</strong><span class="object-tools"><button data-action="rotate" title="Rotate 90 degrees">${icon("rotate")} Rotate</button>${item.owned ? "" : '<button data-action="save">Save piece</button>'}<button data-action="swap">${icon("swap")} Swap</button><button data-action="remove">${icon("trash")} Remove</button></span>`
    : `<span class="gesture">${icon("move")} ${view === "interior" ? "Drag to look around" : view === "plan" ? "Drag a piece to move" : "Drag to orbit"} <span aria-hidden="true">·</span> Select a piece to edit</span>`;
  $("#inventory").innerHTML =
    state.items
      .map(
        (i) =>
          `<button class="item-row" data-item="${escape(i.id)}" aria-pressed="${selection === i.id}">${itemGlyph(i)}<span class="item-name">${escape(i.name)}<small>${i.owned ? "Already owned" : "Suggested piece"}</small></span><span class="price">${i.owned ? "Owned" : currency(i.price)}</span></button>`,
      )
      .join("") ||
    '<p class="muted">Add a piece or auto-style this room to start.</p>';
  $("#notes").textContent =
    `${state.items.filter((i) => !i.owned).length} suggested · ${currency(getSpend(state.items))} estimated`;
  scene?.update(state.items, selection, state.style, room);
  drawPlanPins();
}
function select(id) {
  selection = id;
  render();
}
function move(id, x, z) {
  const item = state.items.find((i) => i.id === id);
  if (!item || Math.hypot(item.x - x, item.z - z) < 0.005) return;
  updatePiece(bounded({ ...item, x, z }));
}
$("#scene").tabIndex = 0;
$("#scene").setAttribute(
  "aria-label",
  "Room editor. Select a piece from the inventory, then use arrow keys here to move it.",
);
$("#scene").addEventListener("keydown", (e) => {
  const deltas = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const item = state.items.find((i) => i.id === selection);
  if (!item || !deltas[e.key]) return;
  e.preventDefault();
  const [dx, dz] = deltas[e.key];
  move(item.id, item.x + dx * 0.1, item.z + dz * 0.1);
});
function modal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function bounded(item, room = state.room || ROOM) {
  const radians = (item.rotation * Math.PI) / 180;
  const halfX =
    (Math.abs(Math.cos(radians)) * item.width +
      Math.abs(Math.sin(radians)) * item.depth) /
    2;
  const halfZ =
    (Math.abs(Math.sin(radians)) * item.width +
      Math.abs(Math.cos(radians)) * item.depth) /
    2;
  const limitX = room.width / 2 - halfX - 0.035;
  const limitZ = room.depth / 2 - halfZ - 0.035;
  return {
    ...item,
    x: Math.max(-limitX, Math.min(limitX, item.x)),
    z: Math.max(-limitZ, Math.min(limitZ, item.z)),
  };
}
function catalogDialog(swapId = null) {
  const old = state.items.find((i) => i.id === swapId);
  const products = [...catalog].sort(
    (a, b) => Number(b.kind === old?.kind) - Number(a.kind === old?.kind),
  );
  modal(
    old ? "Swap " + old.name : "Add furniture",
    `<p class="muted">Choose a piece for your room. Prices are estimates.</p><div class="catalog-list">${products.map((p) => `<button class="item-row" data-product="${escape(p.id)}">${itemGlyph(p)}<span class="item-name">${escape(p.name)}<small>${escape(p.kind)}</small></span><span class="price">${currency(p.price)}</span></button>`).join("")}</div>`,
  );
  $("#modal-body").onclick = (e) => {
    const btn = e.target.closest("[data-product]");
    if (!btn) return;
    const p = catalog.find((i) => i.id === btn.dataset.product);
    const remaining = state.items.filter((i) => i.id !== swapId);
    let item = bounded(
      createItem(p, {
        id: crypto.randomUUID(),
        x: old?.x ?? 0,
        z: old?.z ?? 0,
        rotation: old?.rotation ?? 0,
        owned: false,
      }),
    );
    item = fitItem(item, state.room || ROOM, remaining);
    if (!item) {
      toast("No clear space. Move or remove a piece first.");
      return;
    }
    selection = item.id;
    commit({ ...state, items: [...remaining, item] });
    dialog.close();
  };
}
$("#inventory").onclick = (e) => {
  const btn = e.target.closest("[data-item]");
  if (btn) {
    select(btn.dataset.item);
    $("#scene").focus({ preventScroll: true });
  }
};
$("#compare-photo").onclick = () =>
  modal(
    "Room reference",
    `<img class="room-reference-full" alt="Uploaded view of your room" src="${escape(state.roomPhoto)}">`,
  );
$("#view-house-json").onclick = () => {
  const house = state.importedHouse || getConfirmedImportedHouse();
  if (house) showParsedGeometryModal(house);
};
$("#objectbar").onclick = (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  const item = state.items.find((i) => i.id === selection);
  if (!item || !action) return;
  if (action === "save") return savePieces([item]);
  if (action === "swap") return catalogDialog(item.id);
  if (action === "rotate")
    return updatePiece(
      bounded({ ...item, rotation: (item.rotation + 90) % 360 }),
    );
  if (action === "remove")
    commit({ ...state, items: state.items.filter((i) => i.id !== selection) });
};
$("#styles").onclick = (e) => {
  const btn = e.target.closest("[data-style]");
  if (btn) {
    draftStyle = btn.dataset.style;
    pickedStyle = true;
    renderDraft();
  }
};
$("#style-form").onsubmit = (e) => {
  e.preventDefault();
  const budget = Number($("#budget").value);
  const overrides = {};
  if (pickedStyle) overrides.style = draftStyle;
  if (budget !== state.budget) overrides.budget = budget;
  const next = autoStyle(
    {
      ...state,
      style: draftStyle,
      budget,
      brief: $("#brief").value.trim(),
      reference,
    },
    overrides,
  );
  commit({ ...next, reference, hasLayout: true });
  syncForm();
  navigate("tour");
  changeView($("#view-interior").disabled ? "plan" : "interior");
  jumpTo("entry");
  toast("Room styled · owned pieces kept");
};
$("#undo").onclick = () => {
  if (history.length) {
    state = { ...history.pop(), screen: stage, flowVersion: 2 };
    selection = null;
    persist();
    syncForm();
    render();
    toast("Last change undone");
  }
};
$("#add-piece").onclick = () => catalogDialog();
$("#close-modal").onclick = () => dialog.close();
dialog.addEventListener("close", () => {
  $("#modal-body").onclick = null;
});
async function readPhoto(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw Error("Choose an image smaller than 20 MB.");
  const blob = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = blob;
    await img.decode();
    const c = document.createElement("canvas");
    const scale = Math.min(1, 720 / Math.max(img.width, img.height));
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    let red = 0,
      green = 0,
      blue = 0;
    for (let i = 0; i < pixels.length; i += 48) {
      red += pixels[i];
      green += pixels[i + 1];
      blue += pixels[i + 2];
    }
    const style =
      blue > red
        ? "Soft modern"
        : green > red * 0.97 && green > blue * 1.07
          ? "Earthy eclectic"
          : "Warm minimal";
    function sampledColor(yStart, yEnd) {
      const channels = [[], [], []];
      for (let y = Math.floor(c.height * yStart); y < c.height * yEnd; y += 4) {
        for (let x = 0; x < c.width; x += 6) {
          const i = (y * c.width + x) * 4;
          for (let j = 0; j < 3; j++) channels[j].push(pixels[i + j]);
        }
      }
      return channels.map(
        (values) =>
          values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 200,
      );
    }
    const wall = sampledColor(0.16, 0.39);
    const floor = sampledColor(0.81, 0.98);
    const wallColor =
      "#" + wall.map((v) => v.toString(16).padStart(2, "0")).join("");
    const floorFinish =
      Math.max(...floor) - Math.min(...floor) < 18
        ? "stone"
        : Math.max(...floor) < 145
          ? "walnut"
          : "oak";
    return {
      url: c.toDataURL("image/jpeg", 0.78),
      style,
      wallColor,
      floorFinish,
    };
  } finally {
    URL.revokeObjectURL(blob);
  }
}
$("#inspiration").onchange = async (e) => {
  try {
    const result = await readPhoto(e.target.files[0]);
    if (result) {
      reference = result.url;
      draftStyle = result.style;
      pickedStyle = true;
      renderDraft();
      toast("Style selected from photo colors");
    }
  } catch {
    toast("Choose a supported image smaller than 20 MB.");
  }
  e.target.value = "";
};
$("#remove-ref").onclick = () => {
  reference = null;
  renderDraft();
};
function changeView(mode) {
  const labels = {
    "3d": "Perspective",
    interior: "Interior view",
    plan: "Top view",
  };
  view = mode;
  scene?.setView(mode);
  for (const key of Object.keys(labels))
    $("#view-" + key).setAttribute("aria-pressed", String(mode === key));
  $("#view-label").textContent = labels[mode];
  updateWalkControls();
  render();
}
$("#view-3d").onclick = () => changeView("3d");
$("#view-interior").onclick = () => changeView("interior");
$("#view-plan").onclick = () => changeView("plan");
$("#zoom-in").onclick = () => scene?.zoom(1);
$("#zoom-out").onclick = () => scene?.zoom(-1);
$("#reset-camera").onclick = () => {
  scene?.reset();
  changeView($("#view-3d").disabled ? "plan" : view);
  if (view === "interior") jumpTo("entry");
};
function enterEditor() {
  if (scene) return;
  const handlers = { onSelect: select, onMove: move, onPose: drawPose };
  try {
    scene = createScene($("#scene"), handlers);
    scene.setView("interior");
  } catch (error) {
    console.warn("Using the floor plan editor", error);
    $("#scene").replaceChildren();
    scene = createPlanScene($("#scene"), handlers);
    $("#view-3d").disabled = true;
    $("#view-interior").disabled = true;
    view = "plan";
  }
  changeView(view);
}
function updateWalkControls() {
  const walking = stage === "tour" && view === "interior";
  $("#tour-map").hidden = !walking;
  $(".walk-pad").hidden = !walking;
  $("#walk-help").textContent = walking
    ? "Drag the background to look around. Jump between viewpoints or walk with W, A, S, D when the room is focused."
    : "Select furniture in the room to move, rotate, replace, or save it.";
}
function markStage(next) {
  if (document.body.classList.contains("room-expanded")) toggleExpanded(false);
  stage = next;
  document.body.dataset.stage = next;
  document.querySelectorAll("[data-step]").forEach((b) => {
    b.disabled =
      next === "setup" ||
      ((b.dataset.step === "tour" || b.dataset.step === "shop") &&
        !state.hasLayout);
    if (b.dataset.step === next) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  });
  $("#studio").hidden = !["design", "tour"].includes(next);
  $("#shop-page").hidden = next !== "shop";
  $("#setup-page").hidden = next !== "setup";
  $("#design-panel").hidden = next !== "design";
  $("#tour-panel").hidden = next !== "tour";
  $(".inventory").hidden = next !== "tour";
  updateWalkControls();
}
function toggleExpanded(expanded) {
  document.body.classList.toggle("room-expanded", expanded);
  const button = $("#expand-room");
  button.setAttribute("aria-pressed", String(expanded));
  button.setAttribute(
    "aria-label",
    expanded ? "Close expanded room" : "Expand room view",
  );
  button.title = button.getAttribute("aria-label");
  if (expanded) $("#scene").focus({ preventScroll: true });
  else button.focus({ preventScroll: true });
}
$("#expand-room").onclick = () =>
  toggleExpanded(!document.body.classList.contains("room-expanded"));
window.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    !dialog.open &&
    document.body.classList.contains("room-expanded")
  )
    toggleExpanded(false);
});
function navigate(next) {
  markStage(next);
  state = { ...state, flowVersion: 2, screen: next };
  if (next === "shop") renderShopping();
  else {
    enterEditor();
    render();
    if (next === "tour" && !$("#view-interior").disabled)
      changeView("interior");
  }
  persist();
  window.scrollTo(0, 0);
}
function beginSetup(fresh = false) {
  const previous = stage === "setup" ? state.screen || "design" : stage;
  markStage("setup");
  window.scrollTo(0, 0);
  openSetup({
    state: fresh ? initialState() : state,
    isNew: fresh,
    onCancel: hasProject ? () => navigate(previous) : null,
    readPhoto,
    onApply(next, { demo: sample = false } = {}) {
      hasProject = true;
      const importedHouse = sample ? null : (next.importedHouse ?? null);
      if (importedHouse) setConfirmedImportedHouse(importedHouse);
      else clearConfirmedImportedHouse();
      commit({
        ...next,
        importedHouse,
        flowVersion: 2,
        hasLayout: sample || (!fresh && Boolean(next.hasLayout)),
      });
      selection = null;
      syncForm();
      navigate(sample ? "tour" : "design");
      changeView($("#view-interior").disabled ? "plan" : "interior");
      jumpTo("entry");
    },
  });
}
function jumpTo(id) {
  if (view !== "interior") return;
  scene?.goToSpot?.(id);
  $("#spot-label").textContent = {
    entry: "Entrance",
    center: "Room center",
    window: "Window side",
  }[id];
  document
    .querySelectorAll("[data-spot]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.spot === id)),
    );
}
let eyePose;
function drawPose(pose) {
  eyePose = pose;
  const arrow = $("#map-eye");
  if (arrow)
    arrow.setAttribute(
      "transform",
      `translate(${pose.x} ${pose.z}) rotate(${(pose.yaw * 180) / Math.PI})`,
    );
}
function drawPlanPins() {
  if (stage !== "tour" || view !== "interior" || !scene?.getSpots) return;
  const map = $(".plan-pins");
  const room = normalizeArchitecture(state.room || ROOM);
  const polygon = footprintCorners(room)
    .map(([x, z]) => x + "," + z)
    .join(" ");
  const holes = roomWalls(room)
    .flatMap((wall) =>
      wallOpenings(room, wall).map((hole) => {
        const ends = [hole.left, hole.right].map((t) => [
          wall.x + t * Math.cos(wall.angle),
          wall.z - t * Math.sin(wall.angle),
        ]);
        return `<line x1="${ends[0][0]}" y1="${ends[0][1]}" x2="${ends[1][0]}" y2="${ends[1][1]}" stroke="${hole.kind === "window" ? "#83acb5" : "#ded4bb"}" stroke-width=".15"/>`;
      }),
    )
    .join("");
  const pieces = state.items
    .filter((i) => i.kind !== "rug")
    .map(
      (i) =>
        `<rect transform="translate(${i.x} ${i.z}) rotate(${-i.rotation})" x="${-i.width / 2}" y="${-i.depth / 2}" width="${i.width}" height="${i.depth}" rx=".08" fill="#a99c83" opacity=".64"/>`,
    )
    .join("");
  let svg = map.querySelector("svg");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    map.prepend(svg);
  }
  const w = room.width + 0.5,
    d = room.depth + 0.5;
  map.style.aspectRatio = w + "/" + d;
  svg.setAttribute("viewBox", [-w / 2, -d / 2, w, d].join(" "));
  svg.innerHTML = `<polygon points="${polygon}" fill="#ebe5d6" stroke="#6f7162" stroke-width=".09"/>${holes}${pieces}<path id="map-eye" d="M0,-.32 L.18,.12 L0,.04 L-.18,.12 Z" fill="#b94925" stroke="white" stroke-width=".035"/>`;
  for (const [id, spot] of Object.entries(scene.getSpots())) {
    const pin = map.querySelector(`[data-spot="${id}"]`);
    pin.style.left = 50 + (100 * spot.x) / w + "%";
    pin.style.top = 50 + (100 * spot.z) / d + "%";
  }
  if (eyePose) drawPose(eyePose);
}
function walk(direction) {
  if (view !== "interior") return;
  const vector = {
    forward: [1, 0],
    backward: [-1, 0],
    left: [0, -1],
    right: [0, 1],
  }[direction];
  if (!scene?.walk?.(...vector)) {
    toast("No more walking space in that direction.");
    return;
  }
  $("#spot-label").textContent = "Walking";
  document
    .querySelectorAll("[data-spot]")
    .forEach((b) => b.setAttribute("aria-pressed", "false"));
}
document
  .querySelectorAll("[data-spot]")
  .forEach((b) => (b.onclick = () => jumpTo(b.dataset.spot)));
document
  .querySelectorAll("[data-walk]")
  .forEach((b) => (b.onclick = () => walk(b.dataset.walk)));
$("#scene").addEventListener("keydown", (event) => {
  const direction = { w: "forward", s: "backward", a: "left", d: "right" }[
    event.key.toLowerCase()
  ];
  if (stage === "tour" && view === "interior" && direction) {
    event.preventDefault();
    walk(direction);
  }
});
$("#room-settings").onclick = () => beginSetup();
$("#new-project").onclick = () => beginSetup(true);
$("#style-step").onclick = $("#revise-brief").onclick = () =>
  navigate("design");
$("#tour-step").onclick = $("#back-to-tour").onclick = () => navigate("tour");
$("#shop").onclick = () => navigate("shop");
$(".brand").onclick = (e) => {
  e.preventDefault();
  if (stage !== "setup") beginSetup();
};
function savePieces(items) {
  const saved = new Map(
    (state.savedProducts || []).map((row) => [row.id, row]),
  );
  for (const item of items)
    if (!item.owned && item.productId)
      saved.set(item.id, { id: item.id, productId: item.productId });
  commit({ ...state, savedProducts: [...saved.values()] });
  toast(
    items.length === 1
      ? "Piece saved to your shopping list"
      : "Room saved to your shopping list",
  );
}
$("#save-room").onclick = () => {
  savePieces(state.items.filter((i) => !i.owned));
  navigate("shop");
};
function renderShopping() {
  const saved = (state.savedProducts || [])
    .map((row) => ({
      ...row,
      product: catalog.find((p) => p.id === row.productId),
    }))
    .filter((row) => row.product);
  $("#shop-intro").textContent = saved.length
    ? "Saved for " +
      state.roomName +
      ". Models approximate each piece. Check the selected variant and current price at the store."
    : "Save a piece while exploring, or save all the suggestions from your layout.";
  $("#saved-products").innerHTML =
    saved
      .map(
        ({ id, product: p }) =>
          `<article class="shop-card"><div class="shop-photo"><img src="${escape(p.photo)}" loading="lazy" referrerpolicy="no-referrer" alt="${escape(p.name)}"></div><div class="shop-card-body"><span class="merchant">${escape(p.store)}</span><h2>${escape(p.name)}</h2><p class="variant">${p.variant === "Default Title" ? "" : escape(p.variant)}</p><strong>${currency(p.price)}</strong><div class="shop-card-footer"><a class="primary" target="_blank" rel="noopener noreferrer" href="${escape(p.url)}">Shop at ${escape(p.store)} ↗</a><button class="text-btn" data-unsave="${escape(id)}">Remove</button></div></div></article>`,
      )
      .join("") ||
    '<div class="shop-empty">Your saved products will appear here.</div>';
  $("#saved-total").textContent =
    "Estimated subtotal · " +
    currency(saved.reduce((n, row) => n + row.product.price, 0));
}
$("#saved-products").onclick = (e) => {
  const btn = e.target.closest("[data-unsave]");
  if (!btn) return;
  commit({
    ...state,
    savedProducts: state.savedProducts.filter(
      (p) => p.id !== btn.dataset.unsave,
    ),
  });
  renderShopping();
};
function updatePiece(candidate) {
  const room = state.room || ROOM;
  if (!canPlaceItem(candidate, room, state.items)) {
    toast("That position needs more space. Try another spot.");
    render();
    return false;
  }
  commit({
    ...state,
    items: state.items.map((i) => (i.id === candidate.id ? candidate : i)),
  });
  return true;
}
$("#edit-request").onsubmit = (e) => {
  e.preventDefault();
  const text = $("#edit-text").value.trim().toLowerCase();
  const result = $("#edit-result");
  const kind = Object.entries({
    sofa: /sofa|couch/,
    chair: /chair/,
    table: /table/,
    lamp: /lamp|lighting/,
    rug: /rug|carpet/,
    plant: /plant|tree/,
    console: /cabinet|console|storage/,
    desk: /desk/,
    bed: /bed/,
    bookcase: /bookcase|shelf/,
  }).find(([, re]) => re.test(text))?.[0];
  const picked = state.items.find((i) => i.id === selection);
  const item =
    picked && (!kind || kind === picked.kind)
      ? picked
      : state.items.find((i) => i.kind === kind);
  const room = state.room || ROOM;
  let message;
  if (/^(remove|delete|rotate|turn|swap|replace)\b/.test(text)) {
    if (!item) message = "Select a piece or name an item in this room.";
    else if (/^(remove|delete)/.test(text)) {
      commit({ ...state, items: state.items.filter((i) => i.id !== item.id) });
      message = item.name + " removed.";
    } else if (/^(rotate|turn)/.test(text)) {
      message = updatePiece(
        bounded({ ...item, rotation: (item.rotation + 90) % 360 }),
      )
        ? "Rotated " + item.name + "."
        : "Move the piece into a larger space to rotate it.";
    } else {
      const remaining = state.items.filter((i) => i.id !== item.id);
      const limit = state.budget - getSpend(remaining);
      const cheaper = /cheaper|less expensive|lower price/.test(text);
      const alternatives = catalog.filter(
        (p) =>
          p.kind === item.kind &&
          p.id !== item.productId &&
          p.price <= limit &&
          (!cheaper || p.price < item.price),
      );
      alternatives.sort((a, b) =>
        cheaper
          ? a.price - b.price
          : Number(b.style === state.style) - Number(a.style === state.style) ||
            a.price - b.price,
      );
      const replacement = alternatives
        .map((p) =>
          fitItem(
            createItem(p, {
              id: crypto.randomUUID(),
              x: item.x,
              z: item.z,
              rotation: item.rotation,
            }),
            room,
            remaining,
          ),
        )
        .find(Boolean);
      if (replacement) {
        selection = replacement.id;
        commit({ ...state, items: [...remaining, replacement] });
        message = "Replaced " + item.name + " with " + replacement.name + ".";
      } else
        message = cheaper
          ? "No lower-priced alternative fits this layout."
          : "No alternative fits this layout and budget.";
    }
  } else if (/^add\b/.test(text) && kind) {
    const remaining = state.budget - getSpend(state.items);
    const candidates = catalog
      .filter((p) => p.kind === kind && p.price <= remaining)
      .sort(
        (a, b) =>
          Number(b.style === state.style) - Number(a.style === state.style) ||
          a.price - b.price,
      );
    const added = candidates
      .map((p) =>
        fitItem(createItem(p, { id: crypto.randomUUID() }), room, state.items),
      )
      .find(Boolean);
    if (added) {
      selection = added.id;
      commit({ ...state, items: [...state.items, added] });
      message = "Added " + added.name + ".";
    } else message = "No matching piece fits the remaining space and budget.";
  } else if (
    /style|warm|minimal|modern|earthy|eclectic|under|budget|without|reading/i.test(
      text,
    )
  ) {
    commit(autoStyle({ ...state, brief: text }));
    syncForm();
    message = state.notes;
  } else
    message =
      "Try “add a lamp”, “remove the rug”, “rotate this”, or “soft modern under $800”.";
  result.textContent = message;
};
syncForm();
if (
  hasProject &&
  state.flowVersion === 2 &&
  ["tour", "design", "shop"].includes(state.screen)
)
  navigate(state.screen);
else beginSetup(true);
