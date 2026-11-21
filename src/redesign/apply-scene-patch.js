import { catalog } from "../../model.js";
import { toSceneObject } from "../contracts/scene.js";
import { productCandidateId } from "../contracts/product.js";
import { pointInPolygon } from "../spatial/floorplan-geometry.js";

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

export function parsePositionTriple(rawPos, fallback = [0, 0, 0]) {
  if (!Array.isArray(rawPos) || rawPos.length < 2) return null;
  if (rawPos.length === 2) {
    const x = Number(rawPos[0]);
    const z = Number(rawPos[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return [round3(x), round3(fallback[1] ?? 0), round3(z)];
  }
  const x = Number(rawPos[0]);
  const y = Number(rawPos[1]);
  const z = Number(rawPos[2]);
  if (![x, y, z].every(Number.isFinite)) return null;
  return [round3(x), round3(y), round3(z)];
}

export function parseRotationTriple(rawRot) {
  if (Array.isArray(rawRot)) {
    if (rawRot.length < 3) return null;
    const rx = Number(rawRot[0]);
    const ry = Number(rawRot[1]);
    const rz = Number(rawRot[2]);
    if (![rx, ry, rz].every(Number.isFinite)) return null;
    return [round3(rx, 4), round3(ry, 4), round3(rz, 4)];
  }
  if (typeof rawRot === "number" && Number.isFinite(rawRot)) {
    const yawRad =
      Math.abs(rawRot) > Math.PI * 2 + 0.01
        ? (rawRot * Math.PI) / 180
        : rawRot;
    return [0, round3(yawRad, 4), 0];
  }
  return null;
}

export function lookupCandidateProduct(productId, candidateProducts = []) {
  if (!productId) return null;
  const fromCandidates = (
    Array.isArray(candidateProducts) ? candidateProducts : []
  ).find((p) => p && (p.id === productId || p.productId === productId));
  if (fromCandidates) return fromCandidates;
  return catalog.find((p) => p.id === productId) ?? null;
}

export function livePatchError(op, candidate) {
  const spec = op.object ?? {};
  const productId = op.productId ?? spec.productId;
  if (!candidate?.offerSignature) {
    if ((!candidate && String(productId ?? "").startsWith("gid://shopify/")) ||
        [op, spec].some(source => source.shopify != null || source.sellerDomain != null || source.variantId != null ||
          source.modelUrl != null || source.product != null || source.savedPrice != null)) {
      return "A Shopify placement must reference a registered product. The merchant supplies its metadata.";
    }
    return null;
  }
  if (candidate.id !== productCandidateId(candidate.shopify) || productId !== candidate.id ||
      (spec.productId != null && spec.productId !== candidate.id) ||
      (spec.id != null && spec.id !== op.objectId)) return "The Shopify variant or placement identity does not match.";
  const placementKeys = ["id", "position", "rotation", "roomId", "productId"];
  const operationKeys = ["type", "objectId", "productId", "position", "rotation", "object"];
  if (Object.entries(spec).some(([key, value]) => value != null && !placementKeys.includes(key)) ||
      Object.entries(op).some(([key, value]) => value != null && !operationKeys.includes(key))) {
    return "A live Shopify patch can set only placement. The merchant supplies the product details.";
  }
  return null;
}

function placeLiveProduct(op, candidate, previous, rooms) {
  const spec = op.object ?? {};
  const origin = previous?.position ?? [0, 0, 0];
  const position = parsePositionTriple(op.position ?? spec.position, origin) ?? origin;
  const rotation = parseRotationTriple(op.rotation ?? spec.rotation) ?? previous?.rotationRadians ?? [0, 0, 0];
  const { offerSignature, ...placed } = candidate;
  return toSceneObject({
    ...placed, id: op.objectId, type: "shopify", locked: false, owned: false, productId: candidate.product.productId,
    shopify: { ...candidate.shopify }, product: { ...candidate.product }, savedPrice: { ...candidate.savedPrice },
    roomId: resolveRoomIdForPoint(rooms, position[0], position[2], spec.roomId ?? previous?.roomId),
    x: position[0], y: position[1], elevation: position[1], z: position[2], position, rotation,
  });
}

function clearPreviousOffer(target) {
  const next = { ...target };
  for (const key of ["productId", "variantId", "variant", "shopify", "merchant", "store", "price", "url", "photo",
    "product", "merchantProduct", "modelUrl", "modelScope", "savedPrice", "deliveryEstimate", "dimensionSource", "dimensionsSource"]) {
    delete next[key];
  }
  return next;
}

function resolveRoomIdForPoint(rooms, x, z, fallbackRoomId = null) {
  if (!Array.isArray(rooms)) return fallbackRoomId;
  const hit = rooms.find(
    (r) => Array.isArray(r.polygon) && pointInPolygon([x, z], r.polygon),
  );
  return hit?.id ?? fallbackRoomId;
}

function mergeProductFields(target, productSource) {
  if (!productSource || typeof productSource !== "object") return target;
  const merged = { ...target };

  const productId =
    productSource.productId ?? productSource.id ?? target.productId ?? null;
  if (productId) merged.productId = productId;

  for (const field of [
    "variantId",
    "variant",
    "merchant",
    "store",
    "price",
    "modelUrl",
    "url",
    "photo",
    "merchantProduct",
    "color",
    "shopify",
    "dimensionSource",
    "dimensionsSource",
  ]) {
    if (productSource[field] !== undefined) {
      merged[field] = productSource[field];
    }
  }

  if (productSource.product && typeof productSource.product === "object") {
    merged.product = structuredClone(productSource.product);
  } else if (productId || productSource.merchant || productSource.store) {
    merged.product = {
      ...(merged.product || {}),
      ...(productId ? { productId } : {}),
      ...(productSource.variantId ? { variantId: productSource.variantId } : {}),
      ...(productSource.merchant || productSource.store
        ? { merchant: productSource.merchant || productSource.store }
        : {}),
      ...(productSource.price !== undefined
        ? { price: productSource.price }
        : {}),
      ...(productSource.modelUrl ? { modelUrl: productSource.modelUrl } : {}),
      ...(productSource.url ? { url: productSource.url } : {}),
    };
  }

  return merged;
}

/**
 * Deterministically apply a `ScenePatch` to a `House JSON` without mutating
 * the original `house` or `patch`.
 *
 * Preserves IDs, locked fixtures, room assignments, and Shopify product metadata.
 *
 * @param {object} house
 * @param {object} patch
 * @param {object} [options]
 * @param {Array<object>} [options.candidateProducts=[]]
 * @returns {object} New modified House JSON
 */
export function applyScenePatch(house, patch, options = {}) {
  if (!house || typeof house !== "object") {
    throw new Error("applyScenePatch requires a valid House JSON object.");
  }
  const candidateProducts = options.candidateProducts || [];
  const nextHouse = structuredClone(house);
  const rooms = Array.isArray(nextHouse.rooms) ? nextHouse.rooms : [];
  let objects = (Array.isArray(nextHouse.objects) ? nextHouse.objects : []).map(
    (obj) => toSceneObject(obj),
  );

  for (const op of Array.isArray(patch?.operations) ? patch.operations : []) {
    if (!op || typeof op !== "object") continue;

    if (op.type === "add" || op.type === "replace") {
      const candidate = lookupCandidateProduct(op.productId ?? op.object?.productId, candidateProducts);
      const error = livePatchError(op, candidate);
      if (error) throw new Error(error);
      if (candidate?.offerSignature) {
        if (op.type === "add") objects.push(placeLiveProduct(op, candidate, null, rooms));
        else objects = objects.map(obj => obj.id === op.objectId ? placeLiveProduct(op, candidate, obj, rooms) : obj);
        continue;
      }
    }

    switch (op.type) {
      case "move": {
        objects = objects.map((obj) => {
          if (obj.id !== op.objectId) return obj;
          const pos = parsePositionTriple(op.position, obj.position) ?? obj.position;
          const rot = op.rotation
            ? (parseRotationTriple(op.rotation) ?? obj.rotationRadians ?? obj.rotation)
            : (obj.rotationRadians ?? obj.rotation);
          const roomId = resolveRoomIdForPoint(rooms, pos[0], pos[2], obj.roomId);
          return toSceneObject({
            ...obj,
            x: pos[0],
            y: pos[1],
            elevation: pos[1],
            z: pos[2],
            roomId,
            position: pos,
            rotation: rot,
          });
        });
        break;
      }

      case "rotate": {
        objects = objects.map((obj) => {
          if (obj.id !== op.objectId) return obj;
          const rot =
            parseRotationTriple(op.rotation) ?? obj.rotationRadians ?? obj.rotation;
          return toSceneObject({
            ...obj,
            rotation: rot,
          });
        });
        break;
      }

      case "remove": {
        objects = objects.filter((obj) => obj.id !== op.objectId);
        break;
      }

      case "replace": {
        const matchedProduct = lookupCandidateProduct(
          op.productId ?? op.object?.productId,
          candidateProducts,
        );
        const spec = op.object || {};

        objects = objects.map((obj) => {
          if (obj.id !== op.objectId) return obj;

          const pos = op.position
            ? (parsePositionTriple(op.position, obj.position) ?? obj.position)
            : spec.position
              ? (parsePositionTriple(spec.position, obj.position) ?? obj.position)
              : obj.position;
          const baseRot = obj.rotationRadians ?? obj.rotation;
          const rot = op.rotation
            ? (parseRotationTriple(op.rotation) ?? baseRot)
            : spec.rotation
              ? (parseRotationTriple(spec.rotation) ?? baseRot)
              : baseRot;

          const dimensions = {
            width: Number(
              spec.dimensions?.width ??
                spec.width ??
                matchedProduct?.dimensions?.width ??
                matchedProduct?.width ??
                obj.dimensions.width,
            ),
            height: Number(
              spec.dimensions?.height ??
                spec.height ??
                matchedProduct?.dimensions?.height ??
                matchedProduct?.height ??
                obj.dimensions.height,
            ),
            depth: Number(
              spec.dimensions?.depth ??
                spec.depth ??
                matchedProduct?.dimensions?.depth ??
                matchedProduct?.depth ??
                obj.dimensions.depth,
            ),
          };

          const roomId = resolveRoomIdForPoint(rooms, pos[0], pos[2], obj.roomId);
          const hasProductRef = Boolean(
            op.productId || spec.productId || matchedProduct,
          );

          let replaced = {
            ...clearPreviousOffer(obj),
            id: spec.id || obj.id,
            kind: spec.kind || matchedProduct?.kind || obj.kind,
            name: spec.name || matchedProduct?.name || obj.name,
            type: hasProductRef ? "shopify" : (spec.type || obj.type || "existing"),
            owned: hasProductRef ? false : Boolean(spec.owned ?? false),
            locked: false,
            roomId,
            x: pos[0],
            y: pos[1],
            elevation: pos[1],
            z: pos[2],
            width: dimensions.width,
            height: dimensions.height,
            depth: dimensions.depth,
            position: pos,
            rotation: rot,
            dimensions,
          };

          if (matchedProduct) {
            replaced = mergeProductFields(replaced, matchedProduct);
          }
          replaced = mergeProductFields(replaced, {
            ...spec,
            ...(op.productId ? { productId: op.productId } : {}),
          });

          return toSceneObject(replaced);
        });
        break;
      }

      case "add": {
        const matchedProduct = lookupCandidateProduct(
          op.productId ?? op.object?.productId,
          candidateProducts,
        );
        const spec = op.object || {};
        const pos =
          parsePositionTriple(op.position ?? spec.position, [0, 0, 0]) ?? [
            0, 0, 0,
          ];
        const rot =
          parseRotationTriple(op.rotation ?? spec.rotation) ?? [0, 0, 0];
        const dimensions = {
          width: Number(
            spec.dimensions?.width ??
              spec.width ??
              matchedProduct?.dimensions?.width ??
              matchedProduct?.width ??
              0.7,
          ),
          height: Number(
            spec.dimensions?.height ??
              spec.height ??
              matchedProduct?.dimensions?.height ??
              matchedProduct?.height ??
              0.8,
          ),
          depth: Number(
            spec.dimensions?.depth ??
              spec.depth ??
              matchedProduct?.dimensions?.depth ??
              matchedProduct?.depth ??
              0.7,
          ),
        };
        const roomId =
          spec.roomId ||
          resolveRoomIdForPoint(
            rooms,
            pos[0],
            pos[2],
            rooms[0]?.id ?? null,
          );
        const hasProductRef = Boolean(
          op.productId || spec.productId || matchedProduct,
        );

        let added = {
          id: op.objectId || spec.id || `added-object-${objects.length + 1}`,
          kind: spec.kind || matchedProduct?.kind || "chair",
          name: spec.name || matchedProduct?.name || "Added Furniture",
          type: hasProductRef ? "shopify" : "existing",
          owned: !hasProductRef,
          locked: false,
          roomId,
          position: pos,
          rotation: rot,
          dimensions,
        };
        if (matchedProduct) {
          added = mergeProductFields(added, matchedProduct);
        }
        added = mergeProductFields(added, {
          ...spec,
          ...(op.productId ? { productId: op.productId } : {}),
        });

        objects.push(toSceneObject(added));
        break;
      }

      default:
        break;
    }
  }

  nextHouse.objects = objects;
  return nextHouse;
}

/**
 * Format human-readable action summaries from a ScenePatch for Demo UI display.
 */
export function describePatchActions(house, patch, options = {}) {
  if (!patch || !Array.isArray(patch.operations)) return [];
  const beforeObjects = new Map(
    (house?.objects || []).map((o) => [o.id, toSceneObject(o)]),
  );

  return patch.operations.map((op) => {
    const prev = beforeObjects.get(op.objectId);
    const label = prev?.name || op.object?.name || op.objectId;

    switch (op.type) {
      case "move": {
        const nextPos = parsePositionTriple(op.position, prev?.position);
        if (prev && nextPos) {
          const dist = Math.hypot(
            nextPos[0] - prev.position[0],
            nextPos[2] - prev.position[2],
          );
          return `Moved ${label} ${round2(dist)} m to [${round2(nextPos[0])}, ${round2(nextPos[2])}] m.`;
        }
        return `Moved ${label}.`;
      }
      case "rotate": {
        const rot = parseRotationTriple(op.rotation);
        const deg = rot ? Math.round((rot[1] * 180) / Math.PI) : 0;
        return `Rotated ${label} to ${deg}°.`;
      }
      case "remove":
        return `Removed ${label} to open floor circulation.`;
      case "replace": {
        const product = lookupCandidateProduct(
          op.productId ?? op.object?.productId,
          options.candidateProducts,
        );
        const nextName = op.object?.name || product?.name || op.productId || "compact alternative";
        return `Replaced ${label} with ${nextName}.`;
      }
      case "add": {
        const addedName = op.object?.name || op.objectId;
        return `Added ${addedName} in ${op.object?.roomId || "room"}.`;
      }
      default:
        return `${op.type} ${label}`;
    }
  });
}
