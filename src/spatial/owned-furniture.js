import { toSceneObject } from "../contracts/scene.js";
import { ASSET_REPRESENTATION_TIERS, resolveProduct3DRepresentation } from "./product-scene-object.js";
import { withFurnitureFootprint } from "./furniture-footprint.js";

const round2 = (n) => Math.round(n * 100) / 100;

export const OWNED_KIND_DEFAULTS = Object.freeze({
  sofa: { width: 2.22, depth: 0.88, height: 0.85, color: "#c8b99e", label: "Sofa" },
  bookcase: { width: 0.87, depth: 0.34, height: 1.54, color: "#9e6945", label: "Bookcase" },
  rug: { width: 2.45, depth: 1.75, height: 0.025, color: "#c8b9a2", label: "Rug" },
  table: { width: 0.96, depth: 0.6, height: 0.4, color: "#976441", label: "Table" },
  chair: { width: 0.7, depth: 0.73, height: 0.82, color: "#b6a88f", label: "Chair" },
  lamp: { width: 0.34, depth: 0.34, height: 1.48, color: "#e9d7b4", label: "Lamp" },
  plant: { width: 0.45, depth: 0.45, height: 1.3, color: "#677653", label: "Plant" },
  console: { width: 1.0, depth: 0.4, height: 0.8, color: "#9e6945", label: "Storage console" },
  desk: { width: 1.18, depth: 0.58, height: 0.74, color: "#a97f5a", label: "Desk" },
  bed: { width: 1.42, depth: 2.04, height: 0.8, color: "#d7c5b1", label: "Bed" },
});

const CLASS_ALIAS = Object.freeze({
  couch: "sofa",
  sofa: "sofa",
  chair: "chair",
  armchair: "chair",
  "dining table": "table",
  table: "table",
  desk: "desk",
  bed: "bed",
  "potted plant": "plant",
  plant: "plant",
  bookcase: "bookcase",
  lamp: "lamp",
  rug: "rug",
  console: "console",
});

function sanitizeColor(hex, fallback) {
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex.trim())
    ? hex.trim()
    : fallback;
}

function clampDim(val, min, max, fallback) {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return round2(Math.max(min, Math.min(max, num)));
}

/**
 * Pragmatic Photo / Detection → `OwnedFurnitureCandidate` builder (Phase 6).
 *
 * Does NOT claim single-image NeRF or verified physical measurements when estimated
 * from bounding-box aspect ratio: marks `dimensionSource: "estimated"` until the
 * user supplies explicit dimensions (`dimensionSource: "user_corrected"`).
 *
 * Always marks `owned: true` and `shopify: null` so checkout never attempts to purchase it.
 *
 * @param {object} detectionOrSpec
 */
export function createOwnedFurnitureCandidate(detectionOrSpec = {}) {
  const rawKind = String(
    detectionOrSpec.kind || detectionOrSpec.class || "chair",
  ).toLowerCase();
  const kind = CLASS_ALIAS[rawKind] || (OWNED_KIND_DEFAULTS[rawKind] ? rawKind : "console");
  const base = OWNED_KIND_DEFAULTS[kind] || OWNED_KIND_DEFAULTS.console;

  const hasExplicitDims =
    detectionOrSpec.dimensions &&
    Number(detectionOrSpec.dimensions.width) > 0 &&
    Number(detectionOrSpec.dimensions.depth) > 0 &&
    Number(detectionOrSpec.dimensions.height) > 0;

  let width = base.width;
  let depth = base.depth;
  let height = base.height;
  let dimensionSource = "estimated";

  if (hasExplicitDims) {
    width = clampDim(detectionOrSpec.dimensions.width, 0.15, 4.5, base.width);
    depth = clampDim(detectionOrSpec.dimensions.depth, 0.15, 4.5, base.depth);
    height = clampDim(detectionOrSpec.dimensions.height, 0.02, 2.6, base.height);
    dimensionSource =
      detectionOrSpec.dimensionSource === "user_corrected" ||
      detectionOrSpec.dimensionSource === "measured"
        ? detectionOrSpec.dimensionSource
        : "user_corrected";
  } else if (
    Number.isFinite(Number(detectionOrSpec.aspectRatio)) &&
    Number(detectionOrSpec.aspectRatio) > 0.25 &&
    kind !== "rug"
  ) {
    // Gentle aspect-ratio proportioning bounded tightly around realistic category sizes
    const ar = Math.max(0.45, Math.min(2.6, Number(detectionOrSpec.aspectRatio)));
    const expectedAr = base.width / Math.max(0.25, base.height);
    const ratio = Math.max(0.75, Math.min(1.35, ar / expectedAr));
    width = round2(base.width * ratio);
  }

  return {
    id: String(
      detectionOrSpec.id || `owned-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    ),
    kind,
    name: String(detectionOrSpec.name || `Owned ${base.label}`),
    owned: true,
    locked: Boolean(detectionOrSpec.locked),
    color: sanitizeColor(detectionOrSpec.color, base.color),
    dimensions: { width, height, depth },
    dimensionSource,
    dimensionsSource: dimensionSource,
    photoUrl: typeof detectionOrSpec.photoUrl === "string" ? detectionOrSpec.photoUrl : null,
    normalizedPhotoPoint:
      detectionOrSpec.position &&
      Number.isFinite(Number(detectionOrSpec.position.x)) &&
      Number.isFinite(Number(detectionOrSpec.position.y))
        ? {
            x: Number(detectionOrSpec.position.x),
            y: Number(detectionOrSpec.position.y),
          }
        : null,
  };
}

/**
 * Apply user-entered meter dimension corrections to an `OwnedFurnitureCandidate`
 * or placed owned `SceneObject`, upgrading `dimensionSource` to `"user_corrected"`
 * and recomputing its exact collision footprint.
 */
export function updateOwnedFurnitureDimensions(target, nextDimensions = {}) {
  if (!target || typeof target !== "object") {
    throw new Error("Owned furniture record is required.");
  }
  const curDims = target.dimensions || {
    width: target.width ?? 0.8,
    height: target.height ?? 0.8,
    depth: target.depth ?? 0.8,
  };
  const width = clampDim(nextDimensions.width ?? curDims.width, 0.15, 4.5, curDims.width);
  const depth = clampDim(nextDimensions.depth ?? curDims.depth, 0.15, 4.5, curDims.depth);
  const height = clampDim(nextDimensions.height ?? curDims.height, 0.015, 2.6, curDims.height);

  const updated = {
    ...target,
    owned: true,
    price: 0,
    shopify: undefined,
    productId: undefined,
    variantId: undefined,
    checkoutUrl: undefined,
    width,
    height,
    depth,
    dimensions: { width, height, depth },
    collisionDimensions: { width, height, depth },
    dimensionSource: "user_corrected",
    dimensionsSource: "user_corrected",
  };
  delete updated.shopify;
  delete updated.productId;
  delete updated.variantId;
  delete updated.checkoutUrl;

  if (Array.isArray(updated.position) || Number.isFinite(Number(updated.x))) {
    const sceneObj = withFurnitureFootprint(toSceneObject(updated));
    return {
      ...sceneObj,
      owned: true,
      price: 0,
      collisionDimensions: { width, height, depth },
      dimensionSource: "user_corrected",
      dimensionsSource: "user_corrected",
    };
  }
  return updated;
}

/**
 * Convert an `OwnedFurnitureCandidate` into a placement-validated Spatial `SceneObject`
 * with `owned: true`, `type: "existing"`, `price: 0`, and zero Shopify checkout references.
 */
export function ownedCandidateToSceneObject(candidate, options = {}) {
  const normalizedCand =
    candidate?.dimensions && candidate?.kind
      ? candidate
      : createOwnedFurnitureCandidate(candidate);

  const x = Array.isArray(options.position)
    ? Number(options.position[0]) || 0
    : Number(options.x ?? normalizedCand.x ?? 0);
  const y = Array.isArray(options.position)
    ? Number(options.position[1]) || 0
    : Number(options.y ?? 0);
  const z = Array.isArray(options.position)
    ? Number(options.position[2]) || 0
    : Number(options.z ?? normalizedCand.z ?? 0);
  const rotation = Number.isFinite(Number(options.rotation))
    ? Number(options.rotation)
    : 0;

  const { width, height, depth } = normalizedCand.dimensions;
  const dimensionSource =
    normalizedCand.dimensionSource || normalizedCand.dimensionsSource || "estimated";

  const base = toSceneObject({
    id: String(options.id || normalizedCand.id),
    type: "existing",
    kind: normalizedCand.kind,
    name: normalizedCand.name,
    color: normalizedCand.color,
    roomId: options.roomId ?? normalizedCand.roomId ?? null,
    owned: true,
    locked: Boolean(options.locked ?? normalizedCand.locked),
    passable: normalizedCand.kind === "rug",
    price: 0,
    x,
    y,
    elevation: y,
    z,
    rotation,
    width,
    height,
    depth,
    dimensions: { width, height, depth },
    dimensionSource,
    dimensionsSource: dimensionSource,
  });

  // Explicitly ensure no commerce checkout fields exist on owned furniture
  delete base.shopify;
  delete base.productId;
  delete base.variantId;
  delete base.checkoutUrl;
  delete base.offerSignature;

  const withFootprint = withFurnitureFootprint(base);
  const rep = resolveProduct3DRepresentation(withFootprint);

  return {
    ...withFootprint,
    owned: true,
    price: 0,
    collisionDimensions: { width, height, depth },
    dimensionSource,
    dimensionsSource: dimensionSource,
    assetRepresentation:
      rep.tier === ASSET_REPRESENTATION_TIERS.VERIFIED_3D_ASSET
        ? ASSET_REPRESENTATION_TIERS.REPRESENTATIVE_3D_ASSET
        : rep.tier,
    assetRepresentationLabel: rep.label,
  };
}

/**
 * Convert an array of `detectFurnishings()` photo groups (`{ kind, name, count, positions }`)
 * into individual `OwnedFurnitureCandidate[]` records ready for user dimension review & placement.
 */
export function buildOwnedCandidatesFromDetections(detectedGroups = []) {
  if (!Array.isArray(detectedGroups)) return [];
  const out = [];
  for (const group of detectedGroups) {
    if (!group?.kind) continue;
    const positions = Array.isArray(group.positions) && group.positions.length > 0
      ? group.positions
      : [{ color: group.color, aspectRatio: null }];
    const count = Math.max(1, Number(group.count) || positions.length);
    for (let i = 0; i < count; i += 1) {
      const sample = positions[i] || positions[0] || {};
      out.push(
        createOwnedFurnitureCandidate({
          id: `owned-${group.kind}-${i + 1}`,
          kind: group.kind,
          name: count > 1 ? `${group.name || group.kind} ${i + 1}` : `Owned ${group.name || group.kind}`,
          color: sample.color || group.color,
          aspectRatio: sample.aspectRatio,
          position: sample,
        }),
      );
    }
  }
  return out;
}
