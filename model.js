import { glbUrl } from "./src/shopify/product-assets.js";
import offers from "./offers.json" with { type: "json" };

export const ROOM = { width: 5.4, depth: 4.2, height: 2.65 };

export const styles = {
  "Warm minimal": {
    label: "Warm minimal",
    description: "Honey oak, oatmeal linen and soft ivory.",
    wall: "#eee7dc",
    floor: "#b98d64",
    accent: "#a0704b",
  },
  "Soft modern": {
    label: "Soft modern",
    description: "Cool linen, pale stone and muted blue.",
    wall: "#e6e9e8",
    floor: "#ac9580",
    accent: "#80939d",
  },
  "Earthy eclectic": {
    label: "Earthy eclectic",
    description: "Walnut, rust and layers of olive green.",
    wall: "#efe6d5",
    floor: "#a47b59",
    accent: "#a95842",
  },
};

// The mesh dimensions are approximations. Product names and prices come from Shopify variants.
export const catalog = [
  {
    id: "linen-sofa",
    kind: "sofa",
    color: "#d4c4ad",
    width: 2.2,
    depth: 1.01,
    height: 0.86,
    style: "Warm minimal",
  },
  {
    id: "oak-desk",
    kind: "desk",
    color: "#b99a75",
    width: 1.23,
    depth: 0.6,
    height: 0.75,
    style: "Warm minimal",
  },
  {
    id: "cream-bed",
    kind: "bed",
    color: "#d3c6b4",
    width: 1.75,
    depth: 2.2,
    height: 1.05,
    style: "Soft modern",
  },
  {
    id: "union-bookcase",
    kind: "bookcase",
    color: "#b68d67",
    width: 1.03,
    depth: 0.37,
    height: 1.7,
    style: "Warm minimal",
  },
  {
    id: "oat-rug",
    kind: "rug",
    color: "#d6bea0",
    width: 2.95,
    depth: 2.05,
    height: 0.025,
    style: "Warm minimal",
  },
  {
    id: "blue-rug",
    kind: "rug",
    color: "#a7afb5",
    width: 2.75,
    depth: 1.95,
    height: 0.025,
    style: "Soft modern",
  },
  {
    id: "clay-rug",
    kind: "rug",
    color: "#ad7260",
    width: 2.8,
    depth: 1.95,
    height: 0.025,
    style: "Earthy eclectic",
  },
  {
    id: "oak-table",
    kind: "table",
    color: "#976441",
    width: 1.17,
    depth: 0.64,
    height: 0.4,
    style: "Warm minimal",
  },
  {
    id: "stone-table",
    kind: "table",
    color: "#c1b5a1",
    width: 0.96,
    depth: 0.68,
    height: 0.38,
    style: "Soft modern",
  },
  {
    id: "walnut-table",
    kind: "table",
    color: "#674431",
    width: 1.17,
    depth: 0.65,
    height: 0.4,
    style: "Earthy eclectic",
  },
  {
    id: "linen-chair",
    kind: "chair",
    color: "#d6bc99",
    width: 0.8,
    depth: 0.81,
    height: 0.81,
    style: "Warm minimal",
  },
  {
    id: "blue-chair",
    kind: "chair",
    color: "#7b909d",
    width: 0.8,
    depth: 0.79,
    height: 0.83,
    style: "Soft modern",
  },
  {
    id: "olive-chair",
    kind: "chair",
    color: "#777757",
    width: 0.83,
    depth: 0.78,
    height: 0.84,
    style: "Earthy eclectic",
  },
  {
    id: "brass-lamp",
    kind: "lamp",
    color: "#e5d1a8",
    width: 0.37,
    depth: 0.37,
    height: 1.52,
    style: "Warm minimal",
  },
  {
    id: "milk-glass-lamp",
    kind: "lamp",
    color: "#e0dfd7",
    width: 0.34,
    depth: 0.34,
    height: 1.58,
    style: "Soft modern",
  },
  {
    id: "umber-lamp",
    kind: "lamp",
    color: "#a56949",
    width: 0.37,
    depth: 0.37,
    height: 1.47,
    style: "Earthy eclectic",
  },
  {
    id: "olive-tree",
    kind: "plant",
    color: "#677653",
    width: 0.49,
    depth: 0.49,
    height: 1.54,
    style: "Warm minimal",
  },
  {
    id: "rubber-plant",
    kind: "plant",
    color: "#4d654f",
    width: 0.46,
    depth: 0.46,
    height: 1.32,
    style: "Soft modern",
  },
  {
    id: "bird-of-paradise",
    kind: "plant",
    color: "#50744b",
    width: 0.58,
    depth: 0.58,
    height: 1.7,
    style: "Earthy eclectic",
  },
  {
    id: "oak-console",
    kind: "console",
    color: "#af7d51",
    width: 1.12,
    depth: 0.36,
    height: 0.53,
    style: "Warm minimal",
  },
  {
    id: "chalk-cubby",
    kind: "console",
    color: "#cbc6b6",
    width: 0.56,
    depth: 0.38,
    height: 0.57,
    style: "Soft modern",
  },
  {
    id: "walnut-console",
    kind: "console",
    color: "#654533",
    width: 1.12,
    depth: 0.38,
    height: 0.53,
    style: "Earthy eclectic",
  },
].map((preview) => ({ ...preview, ...offers[preview.id] }));

export const kindWords = {
  sofa: "sofas?|couch(?:es)?|sectionals?",
  bookcase: "bookcases?|bookshel(?:f|ves)|shelving|shelves",
  rug: "rugs?|carpets?|flatweaves?",
  table: "coffee tables?|tables?",
  chair: "lounge chairs?|armchairs?|chairs?|recliners?",
  lamp: "floor lamps?|lamps?|lighting",
  plant: "plants?|olive trees?|greenery",
  console:
    "consoles?|cabinets?|closets?|wardrobes?|sideboards?|dressers?|storage",
  desk: "desks?|workstations?",
  bed: "beds?|mattresses?",
};

const ownedDefaults = {
  sofa: { width: 2.22, depth: 0.88, height: 0.85, color: "#c8b99e" },
  bookcase: { width: 0.87, depth: 0.34, height: 1.54, color: "#9e6945" },
  rug: { width: 2.45, depth: 1.75, height: 0.025, color: "#c8b9a2" },
  table: { width: 0.96, depth: 0.6, height: 0.4, color: "#976441" },
  chair: { width: 0.7, depth: 0.73, height: 0.82, color: "#b6a88f" },
  lamp: { width: 0.34, depth: 0.34, height: 1.48, color: "#e9d7b4" },
  plant: { width: 0.45, depth: 0.45, height: 1.3, color: "#677653" },
  console: { width: 1.0, depth: 0.4, height: 0.8, color: "#9e6945" },
  desk: { width: 1.18, depth: 0.58, height: 0.74, color: "#a97f5a" },
  bed: { width: 1.42, depth: 2.04, height: 0.8, color: "#d7c5b1" },
};

const anchors = {
  sofa: [
    [-0.48, -1.52, 0],
    [0.4, -1.52, 0],
    [-2.1, -0.05, 90],
  ],
  bookcase: [
    [2.42, -1.36, -90],
    [-2.42, -1.29, 90],
    [2.42, 1.14, -90],
  ],
  rug: [
    [-0.18, -0.29, 0],
    [0.22, -0.14, 0],
    [0, 0, 0],
  ],
  table: [
    [-0.52, -0.18, 0],
    [-0.33, 0.08, 0],
    [0.43, 0.25, 90],
  ],
  chair: [
    [1.12, 0.65, 228],
    [1.58, 0.4, 243],
    [1.38, 1.08, 210],
    [-1.73, 0.05, 125],
  ],
  lamp: [
    [-1.94, -1.59, 0],
    [-1.93, -0.82, 0],
    [1.79, 1.48, 0],
  ],
  plant: [
    [1.66, -1.59, 0],
    [2.24, 1.53, 0],
    [-2.25, -0.28, 0],
  ],
  console: [
    [2.42, 0.88, -90],
    [1.79, -1.78, 0],
    [-2.42, -0.63, 90],
  ],
  desk: [
    [2.29, 0.82, -90],
    [1.64, -1.71, 0],
    [-2.28, -0.46, 90],
  ],
  bed: [
    [0.85, -0.9, 0],
    [-0.8, -0.9, 0],
    [1.43, -0.38, -90],
  ],
};

const kindMatchers = Object.entries(kindWords).map(([kind, words]) => [
  kind,
  new RegExp(`^(?:${words})$`, "i"),
]);
const itemWords = new RegExp(
  `\\b(?:${Object.values(kindWords).join("|")})\\b`,
  "gi",
);
const colors = {
  "light oak": "#b79168",
  "dark walnut": "#654533",
  "off-white": "#dfd8ca",
  oak: "#a97f5a",
  walnut: "#72513b",
  blue: "#647c91",
  navy: "#334858",
  green: "#617451",
  olive: "#777757",
  gray: "#9c9a95",
  grey: "#9c9a95",
  cream: "#ded0ba",
  beige: "#c6b599",
  white: "#e7e2d7",
  black: "#494340",
  brown: "#8d674f",
  tan: "#b38b65",
  red: "#a45c50",
  rust: "#a46249",
  pink: "#bd908b",
};

export function createItem(
  product,
  { id, x = 0, z = 0, rotation = 0, owned = false } = {},
) {
  const {
    kind,
    name,
    color,
    width,
    depth,
    height,
    price,
    url,
    merchantProduct,
  } = product;
  return {
    id: id ?? product.id,
    productId: owned ? null : product.id,
    kind,
    name,
    color,
    x,
    z,
    rotation,
    width,
    depth,
    height,
    owned,
    price: owned ? 0 : (price ?? 0),
    ...(owned || !url ? {} : { url, merchantProduct }),
  };
}

export const furniturePreviewKinds = Object.keys(ownedDefaults);

export function createShopifyPreview(kind, ref, placement, product = null) {
  if (!Object.hasOwn(ownedDefaults, kind)) return null;
  const item = createItem(
    { ...ownedDefaults[kind], kind, name: `Shopify ${kind}` },
    placement,
  );
  const exact = product && product.variantId === ref.variantId && product.sellerDomain === ref.sellerDomain;
  const dimensions = exact && product.dimensionsSource === "merchant" ? product.dimensions : null;
  const measured = ["width", "height", "depth"].every((axis) => Number.isFinite(dimensions?.[axis]) && dimensions[axis] > 0);
  const modelUrl = exact && glbUrl(product.modelUrl);
  return {
    ...item, name: (exact && product.title) || item.name, price: null, shopify: ref,
    productId: (exact && product.productId) || null,
    ...(measured ? { width: dimensions.width, height: dimensions.height, depth: dimensions.depth } : {}),
    dimensionsSource: measured ? "merchant" : "estimated",
    ...(modelUrl ? { modelUrl, modelScope: product.modelScope } : {}),
  };
}

function halfExtents(item) {
  const radians = ((item.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    x: (cosine * item.width + sine * item.depth) / 2,
    z: (sine * item.width + cosine * item.depth) / 2,
  };
}

export function withinRoom(item, room = ROOM) {
  const half = halfExtents(item);
  const wallMargin = 0.03;
  const withinWalls =
    Math.abs(item.x) + half.x <= room.width / 2 - wallMargin &&
    Math.abs(item.z) + half.z <= room.depth / 2 - wallMargin;
  const crossesAlcove =
    room.shape === "alcove" &&
    item.x + half.x > room.width * 0.16 - wallMargin &&
    item.z + half.z > room.depth * 0.14 - wallMargin;
  return withinWalls && !crossesAlcove;
}

export function footprintsOverlap(a, b, clearance = 0) {
  if ((a.kind === "rug") !== (b.kind === "rug")) return false;
  const aHalf = halfExtents(a);
  const bHalf = halfExtents(b);
  return (
    Math.abs(a.x - b.x) < aHalf.x + bHalf.x + clearance &&
    Math.abs(a.z - b.z) < aHalf.z + bHalf.z + clearance
  );
}

export function getSpend(items) {
  return items.reduce(
    (total, item) =>
      item.owned || item.locked || item.type === "fixed"
        ? total
        : total + (item.price ?? 0),
    0,
  );
}

function doorClearance(opening, room) {
  const alongX = opening.wall === "front" || opening.wall === "back";
  const alcoveEdge =
    room.shape === "alcove" &&
    (opening.wall === "front" || opening.wall === "right");
  const span = alongX ? room.width : room.depth;
  const start = -span / 2;
  const end = alcoveEdge ? span * (alongX ? 0.16 : 0.14) : span / 2;
  const width = Math.min(0.9, end - start);
  const center = start + (end - start) * (opening.offset ?? 0.5);
  const along = Math.max(start + width / 2, Math.min(end - width / 2, center));
  const approach = 1.24;
  const sign = opening.wall === "front" || opening.wall === "right" ? 1 : -1;
  const inward = sign * ((alongX ? room.depth : room.width) / 2 - approach / 2);
  return {
    x: alongX ? along : inward,
    z: alongX ? inward : along,
    width: alongX ? width : approach,
    depth: alongX ? approach : width,
    rotation: 0,
  };
}

export function clearsDoorways(item, room = ROOM) {
  const openings = room.openings ?? [
    { kind: "door", wall: "front", offset: 0.1 },
  ];
  return !openings.some(
    (opening) =>
      opening.kind === "door" &&
      footprintsOverlap(item, doorClearance(opening, room), 0.07),
  );
}

export function canPlaceItem(item, room = ROOM, items = [], clearance = 0) {
  return (
    withinRoom(item, room) &&
    clearsDoorways(item, room) &&
    !items.some(
      (other) =>
        other !== item &&
        (item.id == null || other.id !== item.id) &&
        footprintsOverlap(item, other, clearance),
    )
  );
}

function placementCandidates(kind, room, includeGrid) {
  const preferred = (anchors[kind] ?? []).map(([x, z, rotation]) => [
    (x * room.width) / ROOM.width,
    (z * room.depth) / ROOM.depth,
    rotation,
  ]);
  if (!includeGrid) return preferred;

  for (let z = -room.depth / 2 + 0.45; z < room.depth / 2; z += 0.45) {
    for (let x = -room.width / 2 + 0.45; x < room.width / 2; x += 0.45) {
      preferred.push([x, z, 0], [x, z, 90]);
    }
  }
  return preferred;
}

function fitAtCandidate(item, room, items, includeGrid) {
  for (const [x, z, rotation] of placementCandidates(
    item.kind,
    room,
    includeGrid,
  )) {
    const placed = { ...item, x, z, rotation };
    if (canPlaceItem(placed, room, items, 0.1)) return placed;
  }
  return null;
}

export function fitItem(item, room = ROOM, items = []) {
  if (canPlaceItem(item, room, items, 0.1)) return item;
  return fitAtCandidate(item, room, items, true);
}

function placeItem(product, items, room, options) {
  return fitAtCandidate(
    createItem(product, options),
    room,
    items,
    options.owned,
  );
}

export function resolveBrief(state, overrides = {}) {
  const brief = state.brief ?? "";
  const leadingStyle = Object.keys(styles).find((style) =>
    brief.toLowerCase().includes(style.toLowerCase()),
  );
  const cues = [
    [
      "Earthy eclectic",
      /\b(?:earthy|eclectic|boho|terracotta|rust|walnut|moody)\b/i,
    ],
    ["Soft modern", /\b(?:modern|mist|cool|contemporary|monochrome|blue)\b/i],
    ["Warm minimal", /\b(?:warm|minimal|japandi|scandinavian|oak|linen)\b/i],
  ];
  const style =
    overrides.style ||
    leadingStyle ||
    cues.find(([, matcher]) => matcher.test(brief))?.[0] ||
    state.style ||
    "Warm minimal";
  const budgetText = brief.match(
    /(?:\$\s*|\b(?:budget(?:\s+of)?|under|up to|at most)\s+)([\d,]+(?:\.\d{1,2})?)\s*(k\b)?/i,
  );
  const parsedBudget =
    budgetText &&
    Number(budgetText[1].replaceAll(",", "")) * (budgetText[2] ? 1000 : 1);
  const providedBudget = Number(
    overrides.budget ?? parsedBudget ?? state.budget ?? 1400,
  );
  const budget = Number.isFinite(providedBudget)
    ? Math.max(0, providedBudget)
    : 1400;
  const skipKinds = [];
  const prioritizeKinds = [];
  for (const [kind, words] of Object.entries(kindWords)) {
    const skip = new RegExp(
      `\\b(?:no|without|remove|skip|avoid)\\s+(?:any\\s+|the\\s+|a\\s+)?(?:${words})\\b`,
      "i",
    );
    const mention = new RegExp(`\\b(?:${words})\\b`, "i");
    if (skip.test(brief)) skipKinds.push(kind);
    else if (mention.test(brief)) prioritizeKinds.push(kind);
  }
  if (/\breading\b/i.test(brief)) prioritizeKinds.unshift("chair", "lamp");
  return {
    style: Object.hasOwn(styles, style) ? style : "Warm minimal",
    budget,
    skipKinds,
    prioritizeKinds,
  };
}

export function autoStyle(state, overrides) {
  const { style, budget, skipKinds, prioritizeKinds } = resolveBrief(
    state,
    overrides,
  );
  const owned = state.items.filter((item) => item.owned || item.locked);
  const items = [...owned];
  const room = state.room ?? ROOM;
  const use = (state.roomName || "") + " " + (state.brief || "");
  const anchor = /bedroom|sleep|guest bed/i.test(use)
    ? "bed"
    : /office|workstation|study/i.test(use)
      ? "desk"
      : "sofa";
  const kinds = [
    ...new Set([
      ...prioritizeKinds,
      anchor,
      "table",
      "chair",
      "rug",
      "lamp",
      "plant",
    ]),
  ];
  let remaining = budget;

  for (const kind of kinds) {
    if (skipKinds.includes(kind) || owned.some((item) => item.kind === kind))
      continue;
    const options = catalog.filter(
      (product) => product.kind === kind && product.price <= remaining,
    );
    const preferred = options.find((product) => product.style === style);
    const product = preferred ?? options.sort((a, b) => a.price - b.price)[0];
    if (!product) continue;
    const item = placeItem(product, items, room, { id: `suggested-${kind}` });
    if (item) {
      items.push(item);
      remaining -= item.price;
    }
  }

  const count = items.length - owned.length;
  const notes = count
    ? `${count} ${count === 1 ? "suggestion" : "suggestions"} in ${style.toLowerCase()}. ${owned.length} existing ${owned.length === 1 ? "piece kept" : "pieces kept"}.`
    : "Your existing pieces are kept. No additions fit the current budget and layout.";
  return { ...state, items, style, budget, spent: getSpend(items), notes };
}

export function createOwnedItems(text, existingItems = [], room = ROOM) {
  const source = String(text ?? "");
  const added = [];
  const items = [...existingItems];
  const requested = new Map();
  const quantityWords = { one: 1, two: 2, three: 3, four: 4 };
  let previousEnd = 0;

  for (const match of source.matchAll(itemWords)) {
    const term = match[0].toLowerCase();
    const kind = kindMatchers.find(([, regex]) => regex.test(term))[0];
    const prefix = source
      .slice(previousEnd, match.index)
      .toLowerCase()
      .split(/[,.;!\n]|\band\b/)
      .at(-1);
    previousEnd = match.index + term.length;
    if (/\b(?:no|without|don't have|do not have)\b/.test(prefix)) continue;

    const colorName = Object.keys(colors).find((color) =>
      new RegExp(`\\b${color}\\b`).test(prefix),
    );
    const color = colors[colorName] ?? ownedDefaults[kind].color;
    const key = `${kind}:${color}`;
    const amountText = prefix.match(/\b([1-4]|one|two|three|four)\b/)?.[1];
    const count =
      (requested.get(key) ?? 0) +
      (quantityWords[amountText] ?? Number(amountText ?? 1));
    requested.set(key, count);

    const matching = items.filter(
      (item) => item.owned && item.kind === kind && item.color === color,
    ).length;
    const label = `${colorName ? `${colorName} ` : ""}${kind === "table" ? "coffee table" : kind}`;
    const product = {
      ...ownedDefaults[kind],
      kind,
      name: label[0].toUpperCase() + label.slice(1),
      color,
    };

    for (let index = matching; index < count; index += 1) {
      const idPrefix = `owned-${kind}`;
      let suffix = items.length + 1;
      while (items.some((item) => item.id === `${idPrefix}-${suffix}`))
        suffix += 1;
      const item = placeItem(product, items, room, {
        id: `${idPrefix}-${suffix}`,
        owned: true,
      });
      if (!item) break;
      added.push(item);
      items.push(item);
    }
  }

  return added;
}

export function initialState() {
  return autoStyle({
    roomName: "Brooklyn living room",
    personas: [],
    style: "Warm minimal",
    budget: 2700,
    brief: "A soft rug and a reading corner.",
    items: [
      createItem(
        { ...ownedDefaults.sofa, name: "Linen sofa", kind: "sofa" },
        { id: "owned-sofa", x: -0.48, z: -1.52, owned: true },
      ),
      createItem(
        {
          ...ownedDefaults.bookcase,
          name: "Walnut bookcase",
          kind: "bookcase",
        },
        { id: "owned-bookcase", x: 2.42, z: -1.36, rotation: -90, owned: true },
      ),
    ],
  });
}
