import {
  ROOM,
  initialState,
  autoStyle,
  catalog,
  styles,
  createItem,
  createShopifyPreview,
  furniturePreviewKinds,
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
import { createHouseholdPage } from "./src/components/persona/household-page.js";
import { validatePersonas } from "./src/contracts/persona.js";
import { listPersonaRooms } from "./src/persona/rooms.js";
import { mountShopifyPicker } from "./src/components/catalog/shopify-picker.js";
import { createShoppingList } from "./src/components/catalog/shopping-list.js";
import { formatShopifyMoney } from "./src/components/catalog/shopify-ui.js";
import { createShopifyQuotes, shopifyRef, shopifyRequest } from "./src/shopify/shopify-client.js";

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
    if (validatePersonas(state.personas, listPersonaRooms(state))) state.personas = [];
    hasProject = true;
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
let clearCatalog;
let quoteRefresh;
const dialog = $("#dialog");
const shopifyQuotes = createShopifyQuotes(() => {
  if (stage === "shop") shoppingList.render();
  if (stage === "tour") render();
});
const shoppingList = createShoppingList({
  root: $("#saved-products"),
  intro: $("#shop-intro"),
  total: $("#saved-total"),
  catalog,
  quotes: shopifyQuotes,
  formatUsd: currency,
  onRemove(id) {
    commit({ ...state, savedProducts: state.savedProducts.filter((row) => row.id !== id) });
    shoppingList.render(state);
  },
  onStockChange: () => void refreshShopifyQuotes(),
});
const householdPage = createHouseholdPage($("#household-page"), {
  onSave(personas) {
    state = { ...state, personas };
    navigate("design");
  },
  onSkip() {
    navigate("design");
  },
});
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
function itemName(item) {
  return shopifyQuotes.get(item.shopify)?.title || item.name;
}
function livePriceUsd(item) {
  const quote = shopifyQuotes.get(item.shopify);
  return quote?.currency === "USD" && Number.isSafeInteger(quote.priceMinor)
    ? quote.priceMinor / 100
    : null;
}
function roomEstimate(items) {
  const livePrices = items.filter((item) => item.shopify).map(livePriceUsd);
  return {
    total: getSpend(items) + livePrices.reduce((sum, price) => sum + (price ?? 0), 0),
    partial: livePrices.includes(null),
  };
}
function inventoryPrice(item) {
  if (item.owned) return "Owned";
  if (!item.shopify) return currency(item.price);
  const quote = shopifyQuotes.get(item.shopify);
  return formatShopifyMoney(quote?.priceMinor, quote?.currency) ?? "Price unconfirmed";
}
function render() {
  $("#room-name").textContent = state.roomName;
  const room = state.room || ROOM;
  $(".subtitle").textContent = `${room.width} × ${room.depth} m · Living space`;
  $("#item-count").textContent = state.items.length;
  $("#shop-count").textContent = state.savedProducts?.length || "";
  $("#undo").disabled = !history.length;
  $("#compare-photo").hidden = !state.roomPhoto;
  const item = state.items.find((i) => i.id === selection);
  $("#objectbar").innerHTML = item
    ? `<strong>${escape(itemName(item))}</strong><span class="object-tools"><button data-action="rotate" title="Rotate 90 degrees">${icon("rotate")} Rotate</button>${item.owned ? "" : '<button data-action="save">Save piece</button>'}<button data-action="swap">${icon("swap")} Swap</button><button data-action="remove">${icon("trash")} Remove</button></span>`
    : `<span class="gesture">${icon("move")} ${view === "interior" ? "Drag to look around" : view === "plan" ? "Drag a piece to move" : "Drag to orbit"} <span aria-hidden="true">·</span> Select a piece to edit</span>`;
  $("#inventory").innerHTML =
    state.items
      .map(
        (i) =>
          `<button class="item-row" data-item="${escape(i.id)}" aria-pressed="${selection === i.id}">${itemGlyph(i)}<span class="item-name">${escape(itemName(i))}<small>${i.owned ? "Already owned" : i.shopify ? "Approximate 3D preview" : "Suggested piece"}</small></span><span class="price">${inventoryPrice(i)}</span></button>`,
      )
      .join("") ||
    '<p class="muted">Add a piece or auto-style this room to start.</p>';
  const estimate = roomEstimate(state.items);
  $("#notes").textContent =
    `${state.items.filter((i) => !i.owned).length} suggested · ${currency(estimate.total)} ${estimate.partial ? "partial estimate" : "estimated"}`;
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
  clearCatalog?.();
  clearCatalog = undefined;
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
  if (old?.locked) return toast("Unlock this piece before swapping it.");
  const products = [...catalog].sort(
    (a, b) => Number(b.kind === old?.kind) - Number(a.kind === old?.kind),
  );
  modal(
    old ? "Swap " + itemName(old) : "Add furniture",
    `<div class="catalog-sources" role="group" aria-label="Furniture source">
      <button type="button" class="secondary" data-source="studio" aria-pressed="true">Studio catalog</button>
      <button type="button" class="secondary" data-source="shopify" aria-pressed="false">Shopify</button>
    </div>
    <div data-studio-catalog><p class="muted">Choose a piece for your room. Prices are estimates.</p><div class="catalog-list">${products.map((p) => `<button class="item-row" data-product="${escape(p.id)}">${itemGlyph(p)}<span class="item-name">${escape(p.name)}<small>${escape(p.kind)}</small></span><span class="price">${currency(p.price)}</span></button>`).join("")}</div></div>
    <div data-shopify-catalog hidden></div>`,
  );
  const body = $("#modal-body");
  const studio = body.querySelector("[data-studio-catalog]");
  const shopify = body.querySelector("[data-shopify-catalog]");
  let unmountPicker;
  clearCatalog = () => {
    unmountPicker?.();
    body.onclick = null;
  };

  function place(makeItem) {
    if (!dialog.open) return false;
    const current = state.items.find((item) => item.id === swapId);
    if (swapId && (!current || current.locked)) return false;
    const remaining = state.items.filter((i) => i.id !== swapId);
    const candidate = makeItem({
      id: crypto.randomUUID(),
      x: current?.x ?? 0,
      z: current?.z ?? 0,
      rotation: current?.rotation ?? 0,
    });
    const item = candidate && fitItem(bounded(candidate), state.room || ROOM, remaining);
    if (!item) {
      toast("No clear space. Move or remove a piece first.");
      return false;
    }
    selection = item.id;
    commit({ ...state, items: [...remaining, item] });
    dialog.close();
    return true;
  }

  body.onclick = (event) => {
    const source = event.target.closest("[data-source]");
    if (source) {
      const useShopify = source.dataset.source === "shopify";
      if (source.getAttribute("aria-pressed") === "true") return;
      for (const button of body.querySelectorAll("[data-source]"))
        button.setAttribute("aria-pressed", String(button === source));
      studio.hidden = useShopify;
      shopify.hidden = !useShopify;
      if (useShopify) {
        unmountPicker = mountShopifyPicker(shopify, {
          swap: Boolean(old),
          initialKind: old?.kind ?? "table",
          kinds: furniturePreviewKinds.map((kind) => ({
            value: kind,
            label: kind[0].toUpperCase() + kind.slice(1),
          })),
          shopifyRequest,
          onQuote: (product) => shopifyQuotes.remember(product),
          onPlace: (product, kind) =>
            place((placement) => createShopifyPreview(kind, shopifyRef(product), placement)),
        });
        shopify.querySelector("input").focus();
      } else {
        unmountPicker?.();
        unmountPicker = undefined;
        shopify.replaceChildren();
      }
      return;
    }
    const product = catalog.find((item) => item.id === event.target.closest("[data-product]")?.dataset.product);
    if (product) place((placement) => createItem(product, placement));
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
    state = { ...history.pop(), personas: state.personas, screen: stage, flowVersion: 2 };
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
  if (dialog.open) return;
  clearCatalog?.();
  clearCatalog = undefined;
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
  if (stage === "household" && next !== "household") householdPage.close();
  if (stage === "shop" && next !== "shop") shoppingList.close();
  if (next !== stage) quoteRefresh?.abort();
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
  $("#household-page").hidden = next !== "household";
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
  if (next === "shop") shoppingList.render(state);
  else if (next === "household") {
    householdPage.open({ personas: state.personas, rooms: listPersonaRooms(state) });
  } else {
    enterEditor();
    render();
    if (next === "tour" && !$("#view-interior").disabled)
      changeView("interior");
  }
  if (next === "tour" || next === "shop") void refreshShopifyQuotes();
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
      commit({
        ...next,
        personas: fresh ? [] : state.personas,
        flowVersion: 2,
        hasLayout: sample || (!fresh && Boolean(next.hasLayout)),
      });
      if (fresh) history = [];
      selection = null;
      syncForm();
      const nextStage = sample ? "tour" : fresh ? "household" : "design";
      navigate(nextStage);
      if (scene) {
        changeView($("#view-interior").disabled ? "plan" : "interior");
        jumpTo("entry");
      }
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
$("#household-step").onclick = () => navigate("household");
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
  for (const item of items) {
    if (item.owned) continue;
    if (item.shopify)
      saved.set(item.id, { id: item.id, name: item.name, shopify: item.shopify });
    else if (item.productId)
      saved.set(item.id, { id: item.id, productId: item.productId });
  }
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
async function refreshShopifyQuotes() {
  quoteRefresh?.abort();
  const shopping = stage === "shop";
  const rows = shopping ? state.savedProducts ?? [] : state.items;
  const refs = rows.flatMap((row) => row.shopify ? [row.shopify] : []);
  if (!refs.length) {
    if (shopping) shoppingList.showLookupStatus();
    return;
  }
  const controller = new AbortController();
  quoteRefresh = controller;
  if (shopping) {
    shoppingList.showLookupStatus({ loading: true });
    shoppingList.render(state);
  }
  try {
    const warnings = await shopifyQuotes.refresh(refs, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (shopping) shoppingList.showLookupStatus({ warnings });
    else if (warnings.length) toast(warnings.map(({ text }) => text).join(" "));
  } catch (error) {
    if (controller.signal.aborted) return;
    if (shopping) shoppingList.showLookupStatus({ error: error.message, warnings: error.warnings });
  }
  if (shopping) shoppingList.render(state);
  else render();
}
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
      message = itemName(item) + " removed.";
    } else if (/^(rotate|turn)/.test(text)) {
      message = updatePiece(
        bounded({ ...item, rotation: (item.rotation + 90) % 360 }),
      )
        ? "Rotated " + itemName(item) + "."
        : "Move the piece into a larger space to rotate it.";
    } else {
      const remaining = state.items.filter((i) => i.id !== item.id);
      const cheaper = /cheaper|less expensive|lower price/.test(text);
      const estimate = roomEstimate(remaining);
      const currentPrice = item.shopify ? livePriceUsd(item) : item.price;
      if (estimate.partial || (cheaper && currentPrice === null)) {
        result.textContent = "Shopify prices are needed to compare pieces against the room budget.";
        void refreshShopifyQuotes();
        return;
      }
      const limit = state.budget - estimate.total;
      const alternatives = catalog.filter(
        (p) =>
          p.kind === item.kind &&
          p.id !== item.productId &&
          p.price <= limit &&
          (!cheaper || p.price < currentPrice),
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
        message = "Replaced " + itemName(item) + " with " + replacement.name + ".";
      } else
        message = cheaper
          ? "No lower-priced alternative fits this layout."
          : "No alternative fits this layout and budget.";
    }
  } else if (/^add\b/.test(text) && kind) {
    const estimate = roomEstimate(state.items);
    if (estimate.partial) {
      result.textContent = "Shopify prices are needed to check the room budget.";
      void refreshShopifyQuotes();
      return;
    }
    const remaining = state.budget - estimate.total;
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
  ["household", "tour", "design", "shop"].includes(state.screen)
)
  navigate(state.screen);
else beginSetup(true);
