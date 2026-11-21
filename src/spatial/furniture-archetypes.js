/**
 * Furniture Visual Archetype Classifier.
 *
 * Uses actual product metadata (`title` / `name`, `productType`, `tags`,
 * `description`, `variantTitle`, `dimensions`, `imageUrl` / `photo`, and fallback `kind`)
 * to classify furniture into clear, recognizable 3D visual archetypes without
 * claiming photorealistic 2D→3D reconstruction.
 */

export const FURNITURE_ARCHETYPES = Object.freeze({
  SOFA: "sofa",
  ARMCHAIR: "armchair",
  DINING_CHAIR: "dining_chair",
  COFFEE_TABLE: "coffee_table",
  DINING_TABLE: "dining_table",
  DESK: "desk",
  BED: "bed",
  NIGHTSTAND: "nightstand",
  DRESSER_CABINET: "dresser_cabinet",
  BOOKSHELF: "bookshelf",
  FLOOR_LAMP: "floor_lamp",
  TABLE_LAMP: "table_lamp",
  PLANT: "plant",
  RUG: "rug",
  TV_MEDIA_CONSOLE: "tv_media_console",
  OTTOMAN_BENCH: "ottoman_bench",
});

export const ARCHETYPE_FALLBACK_DIMENSIONS = Object.freeze({
  sofa: { width: 2.22, depth: 0.9, height: 0.85, color: "#c8b99e", kind: "sofa" },
  armchair: { width: 0.8, depth: 0.8, height: 0.82, color: "#b6a88f", kind: "chair" },
  dining_chair: { width: 0.52, depth: 0.55, height: 0.84, color: "#9c7a56", kind: "chair" },
  coffee_table: { width: 1.08, depth: 0.64, height: 0.4, color: "#976441", kind: "table" },
  dining_table: { width: 1.65, depth: 0.9, height: 0.75, color: "#a17650", kind: "table" },
  desk: { width: 1.22, depth: 0.6, height: 0.75, color: "#a97f5a", kind: "desk" },
  bed: { width: 1.65, depth: 2.1, height: 0.98, color: "#d7c5b1", kind: "bed" },
  nightstand: { width: 0.54, depth: 0.44, height: 0.56, color: "#b38c67", kind: "console" },
  dresser_cabinet: { width: 1.12, depth: 0.44, height: 0.78, color: "#9e6945", kind: "console" },
  bookshelf: { width: 0.95, depth: 0.36, height: 1.68, color: "#9e6945", kind: "bookcase" },
  floor_lamp: { width: 0.36, depth: 0.36, height: 1.52, color: "#e5d1a8", kind: "lamp" },
  table_lamp: { width: 0.28, depth: 0.28, height: 0.52, color: "#e5d7be", kind: "lamp" },
  plant: { width: 0.48, depth: 0.48, height: 1.38, color: "#5e724d", kind: "plant" },
  rug: { width: 2.6, depth: 1.85, height: 0.025, color: "#ccbba2", kind: "rug" },
  tv_media_console: { width: 1.48, depth: 0.42, height: 0.62, color: "#6e503b", kind: "console" },
  ottoman_bench: { width: 0.92, depth: 0.48, height: 0.44, color: "#c2b29b", kind: "chair" },
});

const FINISH_COLOR_HINTS = [
  [/\b(?:cream|ivory|boucle|chalk|glacial|alabaster|white|pearl|milk)\b/i, "#dfd7c8"],
  [/\b(?:oat|oatmeal|sand|linen|almond|beige|natural|travertine|stone)\b/i, "#cdbba0"],
  [/\b(?:pale oak|light oak|white oak|honey oak|oak|ash|birch|maple|bamboo|teak)\b/i, "#b89066"],
  [/\b(?:walnut|umber|espresso|mahogany|chestnut|acacia|cognac|brown)\b/i, "#6d4b36"],
  [/\b(?:navy|indigo|cobalt)\b/i, "#3b5064"],
  [/\b(?:paloma|slate|blue|denim|sky)\b/i, "#748999"],
  [/\b(?:moss|olive|sage|forest|emerald|burgundy rubber|ficus|green)\b/i, "#667554"],
  [/\b(?:terracotta|rust|clay|ochre|amber|copper)\b/i, "#a8644c"],
  [/\b(?:charcoal|graphite|black|onyx|iron|matte black)\b/i, "#3a3834"],
  [/\b(?:brass|gold|champagne|bronze)\b/i, "#c59d5f"],
];

function collectSearchText(source = {}) {
  const tags = Array.isArray(source.tags)
    ? source.tags.join(" ")
    : typeof source.tags === "string"
      ? source.tags
      : "";
  const imageHint =
    source.imageUrl ||
    (Array.isArray(source.imageUrls) ? source.imageUrls[0] : "") ||
    source.photo ||
    source.product?.imageUrl ||
    "";
  return [
    source.title,
    source.name,
    source.merchantProduct,
    source.productType,
    source.category,
    tags,
    source.variantTitle,
    source.variant,
    source.description,
    imageHint,
  ]
    .filter((entry) => typeof entry === "string" && entry.trim())
    .join(" ")
    .toLowerCase();
}

export function inferProductColor(source = {}, fallbackColor = "#c5b69e") {
  if (
    typeof source.color === "string" &&
    /^#[\da-f]{3,8}$/i.test(source.color.trim()) &&
    source.color.toLowerCase() !== "#c5b69e"
  ) {
    return source.color.trim();
  }
  const text = collectSearchText(source);
  for (const [pattern, hex] of FINISH_COLOR_HINTS) {
    if (pattern.test(text)) return hex;
  }
  return (
    (typeof source.color === "string" && /^#[\da-f]{3,8}$/i.test(source.color.trim())
      ? source.color.trim()
      : null) || fallbackColor
  );
}

/**
 * Classify a product candidate or placed SceneObject into one of the 15+ distinct
 * 3D visual archetypes using title, productType, tags, description, dimensions, and image filename hints.
 *
 * @param {object} source
 * @param {string} [explicitKind]
 * @returns {string}
 */
export function classifyFurnitureArchetype(source = {}, explicitKind = "") {
  if (
    typeof source?.archetype === "string" &&
    Object.values(FURNITURE_ARCHETYPES).includes(source.archetype)
  ) {
    return source.archetype;
  }

  const text = collectSearchText(source);
  const kind = String(explicitKind || source?.kind || "").toLowerCase();
  const w = Number(source?.dimensions?.width ?? source?.width) || 0;
  const d = Number(source?.dimensions?.depth ?? source?.depth) || 0;
  const h = Number(source?.dimensions?.height ?? source?.height) || 0;

  if (/\b(?:rug|carpet|runner|flatweave|mat|8x10|5x8|9x12)\b/.test(text) || kind === "rug") {
    return FURNITURE_ARCHETYPES.RUG;
  }
  if (
    /\b(?:plant|tree|ficus|olive tree|bird of paradise|monstera|palm|fern|planter|succulent|greenery)\b/.test(
      text,
    ) ||
    kind === "plant"
  ) {
    return FURNITURE_ARCHETYPES.PLANT;
  }
  if (
    /\b(?:tv|television|media console|media stand|tv stand|entertainment center|credenza.*media|lowboard)\b/.test(
      text,
    ) ||
    kind === "tv"
  ) {
    return FURNITURE_ARCHETYPES.TV_MEDIA_CONSOLE;
  }
  if (/\b(?:bed|mattress|headboard|daybed|queen bed|king bed)\b/.test(text) || kind === "bed") {
    return FURNITURE_ARCHETYPES.BED;
  }
  if (/\b(?:sofa|couch|sectional|loveseat|settee|divan|2\.5 seater|3 seater)\b/.test(text) || kind === "sofa") {
    return FURNITURE_ARCHETYPES.SOFA;
  }
  if (/\b(?:desk|workstation|writing table|study table)\b/.test(text) || kind === "desk") {
    return FURNITURE_ARCHETYPES.DESK;
  }
  if (
    /\b(?:bookshelf|bookcase|shelving|etagere|open shelf| bookcase|tall shelf|union bookshelf)\b/.test(
      text,
    ) ||
    kind === "bookcase"
  ) {
    return FURNITURE_ARCHETYPES.BOOKSHELF;
  }
  if (/\b(?:table lamp|desk lamp|bedside lamp|accent lamp|sconce)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.TABLE_LAMP;
  }
  if (/\b(?:floor lamp|standing lamp|torchiere|arc lamp|lamp|lighting)\b/.test(text) || kind === "lamp") {
    return h > 0 && h <= 0.78
      ? FURNITURE_ARCHETYPES.TABLE_LAMP
      : FURNITURE_ARCHETYPES.FLOOR_LAMP;
  }
  if (/\b(?:nightstand|bedside table|night table|the block|cubby)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.NIGHTSTAND;
  }
  if (/\b(?:ottoman|pouf|bench|footstool)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.OTTOMAN_BENCH;
  }
  if (/\b(?:dining chair|side chair|cafe chair|kitchen chair|counter stool|barstool)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.DINING_CHAIR;
  }
  if (/\b(?:lounge chair|armchair|accent chair|club chair|recliner|swivel chair|reading chair)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.ARMCHAIR;
  }
  if (/\b(?:chair|seating)\b/.test(text) || kind === "chair") {
    if (w > 0 && w <= 0.62 && d > 0 && d <= 0.64) {
      return FURNITURE_ARCHETYPES.DINING_CHAIR;
    }
    return FURNITURE_ARCHETYPES.ARMCHAIR;
  }
  if (/\b(?:dining table|kitchen table|bistro table|conference table)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.DINING_TABLE;
  }
  if (/\b(?:coffee table|cocktail table|center table|side table|end table)\b/.test(text)) {
    return FURNITURE_ARCHETYPES.COFFEE_TABLE;
  }
  if (/\b(?:table)\b/.test(text) || kind === "table") {
    return h >= 0.65 || w >= 1.4
      ? FURNITURE_ARCHETYPES.DINING_TABLE
      : FURNITURE_ARCHETYPES.COFFEE_TABLE;
  }
  if (/\b(?:dresser|chest of drawers|cabinet|sideboard|buffet|credenza|wardrobe|storage|console)\b/.test(text)) {
    if (w > 0 && w <= 0.68 && h > 0 && h <= 0.68) {
      return FURNITURE_ARCHETYPES.NIGHTSTAND;
    }
    return FURNITURE_ARCHETYPES.DRESSER_CABINET;
  }

  // Fallback by dimension ratios + canonical kind
  if (kind === "console") {
    if (w > 0 && w <= 0.68 && h > 0 && h <= 0.68) return FURNITURE_ARCHETYPES.NIGHTSTAND;
    if (w >= 1.35 && h <= 0.66) return FURNITURE_ARCHETYPES.TV_MEDIA_CONSOLE;
    return FURNITURE_ARCHETYPES.DRESSER_CABINET;
  }
  return FURNITURE_ARCHETYPES.DRESSER_CABINET;
}

export function archetypeToCanonicalKind(archetype) {
  return ARCHETYPE_FALLBACK_DIMENSIONS[archetype]?.kind || "console";
}
