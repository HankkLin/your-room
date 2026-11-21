import { catalog, createItem, furniturePreviewKinds } from "../../model.js";
import { toSceneObject } from "../contracts/scene.js";
import { productCandidateId, shopifyHttpsUrl } from "../contracts/product.js";
import { glbUrl } from "../shopify/product-assets.js";
import { createCandidatePlacement } from "../shopify/scene-candidate.js";
import {
  ARCHETYPE_FALLBACK_DIMENSIONS,
  archetypeToCanonicalKind,
  classifyFurnitureArchetype,
  FURNITURE_ARCHETYPES,
  inferProductColor,
} from "./furniture-archetypes.js";
import { withFurnitureFootprint } from "./furniture-footprint.js";

export const ASSET_REPRESENTATION_TIERS = Object.freeze({
  VERIFIED_3D_ASSET: "verified_3d_asset",
  REPRESENTATIVE_3D_ASSET: "representative_3d_asset",
  PROCEDURAL_APPROXIMATION: "procedural_approximation",
});

export const REPRESENTATIVE_MODEL_KINDS = Object.freeze(new Set(["sofa", "chair"]));

const KIND_FALLBACK_DIMENSIONS = Object.freeze({
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
  tv: { width: 1.24, depth: 0.18, height: 0.78, color: "#2e3135" },
});

function inferFurnitureKind(candidate, explicitKind) {
  if (explicitKind && (furniturePreviewKinds.includes(explicitKind) || explicitKind === "tv")) {
    return explicitKind;
  }
  const archetype = classifyFurnitureArchetype(candidate);
  const archetypeKind = archetypeToCanonicalKind(archetype);
  const text = `${candidate?.title || ""} ${candidate?.name || ""} ${candidate?.productType || ""} ${candidate?.variantTitle || ""}`.toLowerCase();
  const hasStrongTitleSignal =
    /\b(?:sofa|couch|sectional|loveseat|bed|mattress|headboard|desk|workstation|bookshelf|bookcase|shelving|rug|carpet|flatweave|lamp|sconce|lighting|plant|tree|ficus|planter|chair|armchair|stool|recliner|table|nightstand|dresser|cabinet|console|tv|television)\b/.test(
      text,
    );
  if (hasStrongTitleSignal && (furniturePreviewKinds.includes(archetypeKind) || archetypeKind === "tv")) {
    return archetypeKind;
  }
  if (candidate?.kind && (furniturePreviewKinds.includes(candidate.kind) || candidate.kind === "tv")) {
    return candidate.kind;
  }
  return archetypeKind;
}

function hasValidAxes(dims) {
  return Boolean(
    dims &&
      Number.isFinite(Number(dims.width)) &&
      Number(dims.width) > 0 &&
      Number.isFinite(Number(dims.height)) &&
      Number(dims.height) > 0 &&
      Number.isFinite(Number(dims.depth)) &&
      Number(dims.depth) > 0,
  );
}

/**
 * Determine the 3D asset representation tier for a placed or candidate SceneObject
 * without ever claiming procedural geometry is a photorealistic 3D scan:
 *
 * Priority:
 * 1. `verified_3d_asset`: valid HTTPS `.glb` `modelUrl` that did not fail loading.
 * 2. `representative_3d_asset`: mapped bundled 3D GLB template by furniture `kind` (`sofa`, `chair`).
 * 3. `procedural_approximation`: deterministic parametric 3D proxy scaled to exact meter dimensions.
 *
 * Regardless of visual tier, `collisionDimensions` and `footprint` ALWAYS reflect
 * the exact physical meter dimensions used by deterministic simulation & pathfinding.
 *
 * @param {object} item
 * @param {{ modelLoadFailed?: boolean, representativeKinds?: Set<string> }} [options]
 */
const round4 = (n) => Math.round(n * 10000) / 10000;

export function resolveProduct3DRepresentation(item = {}, options = {}) {
  const validGlb = glbUrl(item?.modelUrl);
  const failed = Boolean(options.modelLoadFailed);
  const repKinds = options.representativeKinds ?? REPRESENTATIVE_MODEL_KINDS;

  const width = round4(Math.max(0.05, Number(item?.dimensions?.width ?? item?.width) || 0.6));
  const height = round4(Math.max(0.008, Number(item?.dimensions?.height ?? item?.height) || 0.75));
  const depth = round4(Math.max(0.05, Number(item?.dimensions?.depth ?? item?.depth) || 0.6));
  const dimensionSource =
    item?.dimensionSource || item?.dimensionsSource || "estimated";

  if (validGlb && !failed) {
    return {
      tier: ASSET_REPRESENTATION_TIERS.VERIFIED_3D_ASSET,
      label: "Verified 3D product asset",
      modelUrl: validGlb,
      isApproximateVisual: false,
      dimensionSource,
      collisionDimensions: { width, height, depth },
    };
  }

  const archetype = classifyFurnitureArchetype(item, item?.kind);
  const usesRepGlb =
    repKinds.has(item?.kind) &&
    archetype !== FURNITURE_ARCHETYPES.DINING_CHAIR &&
    archetype !== FURNITURE_ARCHETYPES.OTTOMAN_BENCH;

  if (usesRepGlb) {
    return {
      tier: ASSET_REPRESENTATION_TIERS.REPRESENTATIVE_3D_ASSET,
      label: "Representative 3D category model (scaled to product dimensions)",
      modelUrl: null,
      fallbackReason: validGlb && failed ? "model_url_load_failed" : "no_product_glb",
      isApproximateVisual: true,
      dimensionSource,
      collisionDimensions: { width, height, depth },
    };
  }

  return {
    tier: ASSET_REPRESENTATION_TIERS.PROCEDURAL_APPROXIMATION,
    label: "Procedural 3D proxy (exact simulation dimensions)",
    modelUrl: null,
    fallbackReason: validGlb && failed ? "model_url_load_failed" : "no_category_glb",
    isApproximateVisual: true,
    dimensionSource,
    collisionDimensions: { width, height, depth },
  };
}

/**
 * Canonical single adapter: `ProductCandidate` (or catalog offer) → Spatial `SceneObject`.
 *
 * Consumes Hank's canonical `ProductCandidate` (`src/contracts/product.js`) without
 * inventing a second candidate schema, preserving all commerce/provenance metadata:
 * - `productId`, `variantId`, `merchant`, `price`, `productUrl`, `checkoutUrl`,
 *   `dimensions`, `dimensionSource` (and `dimensionsSource`), `modelUrl`
 * and generating complete spatial geometry for deterministic simulation & validators:
 * - `position`, `rotation`, `rotationRadians`, `footprint`, `localFootprint`,
 *   `collisionDimensions`, `roomId`, `locked: false`, `owned: false`, `passable`.
 *
 * @param {object} candidate - Canonical `ProductCandidate` or catalog entry
 * @param {object} [options]
 * @param {string} [options.id] - SceneObject instance ID
 * @param {string} [options.kind] - Furniture semantic kind (`sofa`, `table`, `chair`, ...)
 * @param {string | null} [options.roomId]
 * @param {[number, number, number]} [options.position=[0, 0, 0]]
 * @param {[number, number, number] | number} [options.rotation=0] - Radians triple `[0, yaw, 0]` or degrees
 */
export function productCandidateToSceneObject(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("productCandidateToSceneObject requires a valid ProductCandidate object.");
  }

  const kind = inferFurnitureKind(candidate, options.kind);
  const archetype = classifyFurnitureArchetype(
    options.kind ? { ...candidate, title: "", name: "" } : candidate,
    kind,
  );
  const semanticArchetype = classifyFurnitureArchetype(candidate, kind);
  const resolvedArchetype =
    options.kind && archetypeToCanonicalKind(semanticArchetype) !== options.kind
      ? archetype
      : semanticArchetype;
  const archetypeDefaults = ARCHETYPE_FALLBACK_DIMENSIONS[resolvedArchetype];
  const defaults =
    archetypeDefaults || KIND_FALLBACK_DIMENSIONS[kind] || KIND_FALLBACK_DIMENSIONS.console;

  const x = Array.isArray(options.position)
    ? Number(options.position[0]) || 0
    : Number(options.x ?? candidate.x ?? candidate.position?.[0]) || 0;
  const y = Array.isArray(options.position)
    ? Number(options.position[1]) || 0
    : Number(options.y ?? candidate.y ?? candidate.position?.[1]) || 0;
  const z = Array.isArray(options.position)
    ? Number(options.position[2]) || 0
    : Number(options.z ?? candidate.z ?? candidate.position?.[2]) || 0;

  let rotationDeg = 0;
  if (Array.isArray(options.rotation)) {
    rotationDeg = ((Number(options.rotation[1]) || 0) * 180) / Math.PI;
  } else if (options.rotation != null && Number.isFinite(Number(options.rotation))) {
    rotationDeg = Number(options.rotation);
  } else if (Array.isArray(candidate.rotation)) {
    rotationDeg = ((Number(candidate.rotation[1]) || 0) * 180) / Math.PI;
  } else if (Number.isFinite(Number(candidate.rotation))) {
    rotationDeg = Number(candidate.rotation);
  }

  const roomId = options.roomId ?? candidate.roomId ?? null;
  const objectId = String(
    options.id ||
      candidate.sceneObjectId ||
      `${kind}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // Path A: Live Shopify `ProductCandidate` (`variantId` + `sellerDomain`)
  const candidateCompositeId = productCandidateId(candidate);
  let rawItem = null;

  if (candidateCompositeId && furniturePreviewKinds.includes(kind)) {
    rawItem = createCandidatePlacement(candidate, kind, {
      id: objectId,
      x,
      z,
      rotation: rotationDeg,
    });
  }

  // Path B: Catalog item or non-adoptable/custom ProductCandidate with explicit fields
  if (!rawItem) {
    const catalogMatch = catalog.find(
      (c) => c.id === candidate.id || c.id === candidate.productId,
    );
    if (catalogMatch) {
      rawItem = createItem(catalogMatch, {
        id: objectId,
        x,
        z,
        rotation: rotationDeg,
      });
    } else {
      rawItem = {
        id: objectId,
        kind,
        name: String(candidate.title || candidate.name || `Shopify ${kind}`),
        color: candidate.color || defaults.color,
        width: defaults.width,
        depth: defaults.depth,
        height: defaults.height,
        x,
        z,
        rotation: rotationDeg,
        owned: false,
      };
    }
  }

  // Apply explicit candidate dimensions (whether merchant-verified or estimated)
  const suppliedDims = hasValidAxes(candidate.dimensions)
    ? candidate.dimensions
    : hasValidAxes({
          width: candidate.width,
          height: candidate.height,
          depth: candidate.depth,
        })
      ? {
          width: Number(candidate.width),
          height: Number(candidate.height),
          depth: Number(candidate.depth),
        }
      : null;

  const dimensions = suppliedDims
    ? {
        width: round4(Number(suppliedDims.width)),
        height: round4(Number(suppliedDims.height)),
        depth: round4(Number(suppliedDims.depth)),
      }
    : {
        width: round4(Number(rawItem.width) || defaults.width),
        height: round4(Number(rawItem.height) || defaults.height),
        depth: round4(Number(rawItem.depth) || defaults.depth),
      };

  const dimensionSource =
    candidate.dimensionSource ||
    candidate.dimensionsSource ||
    rawItem.dimensionsSource ||
    (suppliedDims && candidate.dimensionsSource === "merchant" ? "merchant" : "estimated");

  const validModelUrl = glbUrl(candidate.modelUrl ?? rawItem.modelUrl);
  const validProductUrl =
    shopifyHttpsUrl(candidate.productUrl ?? candidate.url ?? rawItem.url) ||
    candidate.url ||
    rawItem.url ||
    null;
  const validCheckoutUrl =
    shopifyHttpsUrl(candidate.checkoutUrl) || null;

  const resolvedPrice =
    Number.isSafeInteger(candidate.priceMinor) && candidate.currency === "USD"
      ? candidate.priceMinor / 100
      : Number.isFinite(Number(candidate.price))
        ? Number(candidate.price)
        : Number(rawItem.price ?? 0);

  const validImageUrls = [
    ...(Array.isArray(candidate.imageUrls) ? candidate.imageUrls : []),
    candidate.imageUrl,
    candidate.photo,
    rawItem.photo,
  ]
    .map(shopifyHttpsUrl)
    .filter(Boolean);
  const uniqueImageUrls = [...new Set(validImageUrls)];
  const primaryPhoto = uniqueImageUrls[0] ?? candidate.photo ?? rawItem.photo ?? null;
  const resolvedColor = inferProductColor(
    { ...rawItem, ...candidate },
    rawItem.color || defaults.color,
  );

  const merged = {
    ...rawItem,
    id: objectId,
    type: "shopify",
    kind,
    archetype: resolvedArchetype,
    color: resolvedColor,
    name: String(candidate.title || candidate.name || rawItem.name || kind),
    title: String(candidate.title || candidate.name || rawItem.name || kind),
    roomId,
    locked: false,
    owned: false,
    passable: kind === "rug" || Boolean(candidate.passable),
    x,
    y,
    elevation: y,
    z,
    rotation: rotationDeg,
    width: dimensions.width,
    height: dimensions.height,
    depth: dimensions.depth,
    dimensions,
    collisionDimensions: { ...dimensions },
    dimensionSource,
    dimensionsSource: dimensionSource,
    productId:
      candidate.productId ??
      rawItem.productId ??
      candidateCompositeId ??
      candidate.id ??
      null,
    variantId: candidate.variantId ?? rawItem.variantId ?? null,
    merchant:
      candidate.merchant ??
      rawItem.merchant ??
      candidate.store ??
      candidate.sellerDomain ??
      rawItem.store ??
      null,
    price: resolvedPrice,
    productUrl: validProductUrl,
    url: validProductUrl,
    checkoutUrl: validCheckoutUrl,
    imageUrls: uniqueImageUrls,
    imageUrl: primaryPhoto,
    photo: primaryPhoto,
    modelUrl: validModelUrl,
    ...(candidate.modelScope || rawItem.modelScope
      ? { modelScope: candidate.modelScope || rawItem.modelScope }
      : {}),
    ...(candidateCompositeId
      ? {
          shopify: {
            variantId: candidate.variantId,
            sellerDomain: candidate.sellerDomain,
          },
        }
      : {}),
    product: {
      candidateId: candidateCompositeId ?? candidate.id ?? null,
      productId: candidate.productId ?? rawItem.productId ?? null,
      variantId: candidate.variantId ?? rawItem.variantId ?? null,
      title: String(candidate.title || candidate.name || rawItem.name || kind),
      sellerDomain:
        candidate.sellerDomain ?? rawItem.shopify?.sellerDomain ?? null,
      merchant:
        candidate.merchant ??
        rawItem.merchant ??
        candidate.store ??
        candidate.sellerDomain ??
        null,
      price: resolvedPrice,
      priceMinor: Number.isSafeInteger(candidate.priceMinor)
        ? candidate.priceMinor
        : Math.round(resolvedPrice * 100),
      currency: candidate.currency || "USD",
      ...(typeof candidate.available === "boolean"
        ? { available: candidate.available }
        : {}),
      productUrl: validProductUrl,
      checkoutUrl: validCheckoutUrl,
      imageUrls: uniqueImageUrls,
      imageUrl: primaryPhoto,
      dimensions: { ...dimensions },
      dimensionSource,
      modelUrl: validModelUrl,
    },
  };

  const sceneObj = withFurnitureFootprint(toSceneObject(merged));
  const representation = resolveProduct3DRepresentation(sceneObj);

  return {
    ...sceneObj,
    collisionDimensions: { ...sceneObj.dimensions },
    assetRepresentation: representation.tier,
    assetRepresentationLabel: representation.label,
  };
}
