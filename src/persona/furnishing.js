import { productCandidateId } from "../contracts/product.js";
import { createCandidatePlacement } from "../shopify/scene-candidate.js";
import { catalog, createItem, fitItem, furniturePreviewKinds, ROOM } from "../../model.js";
import { fitItemInHouse, mergeHouseFixturesIntoItems, normalizeHouse } from "../../house-model.js";
import { listPersonaRooms } from "./rooms.js";
import { validateFurnishingInput, validateFurnishingProposal } from "../agents/furnishing-contract.js";

/** Supply liveCandidates: furnishingCandidatesFromSession(candidateSession.read()) at the design boundary. */
export function furnishingCandidatesFromSession(snapshot, now = Date.now()) {
  if (!snapshot || (snapshot.expiresAt != null && snapshot.expiresAt <= now) ||
      !furniturePreviewKinds.includes(snapshot.kind) || !Array.isArray(snapshot.products)) return [];
  return snapshot.products.map((product) => ({ ...product, kind: snapshot.kind }));
}

function liveOption(candidate) {
  if (candidate.currency !== "USD" || !candidate.title || !furniturePreviewKinds.includes(candidate.kind)) return null;
  const item = createCandidatePlacement(candidate, candidate.kind, {});
  if (!item) return null;
  return { id: productCandidateId(candidate), item, priceMinor: candidate.priceMinor, source: "Shopify",
    merchant: candidate.merchant || candidate.sellerDomain, variant: candidate.variantTitle, deliveryEstimate: candidate.deliveryEstimate };
}

export function prepareFurnishing({ project, style, brief, budget, reference = null, liveCandidates = [], getQuote = () => null }) {
  const rooms = listPersonaRooms(project);
  const rawHouse = project.importedHouse || project.house;
  const house = rawHouse ? normalizeHouse(rawHouse) : null;
  const items = house ? mergeHouseFixturesIntoItems(house, project.items) : project.items;
  let retainedMinor = 0;
  for (const item of items) {
    if (item.owned || item.type === "fixed") continue;
    const quote = item.shopify && getQuote(item.shopify);
    const amount = item.shopify ? (quote?.currency === "USD" ? quote.priceMinor : null) :
      (Number.isFinite(item.price) ? Math.round(item.price * 100) : null);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Refresh the existing furniture prices before requesting a proposal.");
    retainedMinor += amount;
  }
  const options = new Map();
  for (const product of catalog) {
    options.set(product.id, { id: product.id, item: createItem(product), style: product.style,
      priceMinor: Math.round(product.price * 100), source: "Saved catalog estimate" });
  }
  for (const candidate of liveCandidates) {
    const option = liveOption(candidate);
    if (option) options.set(option.id, option);
  }
  const candidates = Array.from(options.values(), ({ id, item, priceMinor, source, merchant, variant, deliveryEstimate, style: productStyle }) => ({
    id, name: item.name, kind: item.kind, priceMinor, source, style: productStyle,
    ...(merchant ? { merchant, variant, deliveryEstimate, dimensionsSource: item.dimensionsSource } : {}),
    dimensions: { width: item.width, height: item.height, depth: item.depth },
  }));
  const input = { personas: project.personas, rooms, style, brief, budgetMinor: Math.round(budget * 100),
    retainedMinor, reference, candidates, existingPieces: items.map(({ name, kind, roomId, locked, owned }) => ({ name, kind, roomId, locked, owned })) };
  validateFurnishingInput(input);
  if (retainedMinor > input.budgetMinor) throw new Error("The existing furniture already exceeds this budget.");
  return { input, options, items, room: project.room || ROOM, house };
}

export function previewFurnishing(context, proposal) {
  const { input, options, items, room, house } = context;
  const totalMinor = validateFurnishingProposal(proposal, input);
  const occupied = [...items];
  const additions = [];
  const ids = new Set(occupied.map(({ id }) => id));
  let serial = 0;
  for (const operation of proposal.operations) {
    const option = options.get(operation.candidateId);
    let id;
    do { id = "household-add-" + ++serial; } while (ids.has(id));
    ids.add(id);
    const target = house?.rooms.find(({ id }) => id === operation.roomId);
    const piece = { ...option.item, id, roomId: operation.roomId, x: target?.bounds.centerX ?? 0, z: target?.bounds.centerZ ?? 0 };
    const placed = house ? fitItemInHouse(piece, house, occupied, operation.roomId) : fitItem(piece, room, occupied);
    if (!placed || placed.roomId !== operation.roomId) throw new Error("There is no valid placement for " + piece.name + " in the proposed room.");
    occupied.push(placed);
    additions.push({ item: placed, priceMinor: option.priceMinor, source: option.source, operation });
  }
  return { additions, totalMinor };
}
