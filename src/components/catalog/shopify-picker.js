import "./shopify-picker.css";
import { productCandidateId, canAdoptCandidate } from "../../contracts/product.js";
import { formatShopifyMoney, renderShopifyWarnings, shopifyHttpsUrl } from "./shopify-ui.js";

function createResult(product, label, onSelect) {
  const card = document.createElement("li");
  card.className = "shopify-picker-card";
  const imageUrl = shopifyHttpsUrl(product.imageUrl);
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    card.append(image);
  }

  const content = document.createElement("div");
  content.className = "shopify-picker-card-body";
  const title = document.createElement("h3");
  title.textContent = product.title;
  const details = document.createElement("p");
  details.className = "muted";
  const variant = product.variantTitle !== product.title ? product.variantTitle : "";
  details.textContent = [product.merchant, variant].filter(Boolean).join(" · ");
  const offer = document.createElement("p");
  offer.className = "shopify-picker-offer";
  const price = formatShopifyMoney(product.priceMinor, product.currency);
  const stock = product.available == null ? "Stock unknown" : product.available ? "In stock" : "Unavailable";
  offer.textContent = [price ?? "Price unavailable", stock, product.deliveryEstimate ? "Delivery " + product.deliveryEstimate : "Delivery unknown"].join(" · ");

  const size = document.createElement("p");
  size.className = "muted";
  const dimensions = product.dimensions;
  if (dimensions && product.dimensionsSource === "merchant") {
    const meters = (value) => Number(value.toPrecision(6)).toString();
    size.textContent = `Merchant dimensions (W × D × H) · ${meters(dimensions.width)} × ${meters(dimensions.depth)} × ${meters(dimensions.height)} m`;
  } else {
    size.textContent = "Estimated preview size";
  }

  const actions = document.createElement("div");
  actions.className = "shopify-picker-actions";
  const place = document.createElement("button");
  place.className = "secondary";
  place.type = "button";
  place.textContent = label;
  place.disabled = !product.available || price === null;
  place.addEventListener("click", onSelect);
  actions.append(place);

  const productUrl = shopifyHttpsUrl(product.productUrl);
  if (productUrl) {
    const link = document.createElement("a");
    link.href = productUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View at merchant";
    actions.append(link);
  }

  content.append(title, details, offer, size, actions);
  card.append(content);
  return [card, place];
}

export function mountShopifyPicker(root, {
  swap,
  objectId,
  candidateSession,
  initialKind,
  kinds,
  shopifyRequest,
  onPlace,
  onQuote,
}) {
  root.innerHTML =
    '<div class="shopify-picker"><form class="shopify-picker-form">' +
    '<label class="field">Search Shopify<input type="search" placeholder="Compact walnut side table" required></label>' +
    '<button class="primary" type="submit">Search</button>' +
    '<label class="field shopify-picker-kind">Preview type<select></select></label>' +
    '</form>' +
    '<button type="button" class="secondary" data-recommend hidden>Ask Gemini to choose</button>' +
    '<p class="shopify-picker-status muted" role="status"></p><div data-shopify-warnings hidden></div>' +
    '<ul class="shopify-picker-results"></ul></div>';
  const form = root.querySelector("form");
  const input = form.querySelector("input");
  const kindSelect = form.querySelector("select");
  const status = root.querySelector("[role=status]");
  const warningTarget = root.querySelector("[data-shopify-warnings]");
  const recommend = root.querySelector("[data-recommend]");
  const results = root.querySelector(".shopify-picker-results");
  for (const { value, label } of kinds) kindSelect.add(new Option(label, value));
  if (kinds.some(({ value }) => value === initialKind)) kindSelect.value = initialKind;

  let pending;
  let expiresAt = 0;
  let expiryTimer;
  let products = [];
  let actions = [];
  let searchWarnings = [];
  let offerWithNotices;
  let recommendedId;
  let searchQuery = "";
  let disposed = false;
  const actionLabel = swap ? "Swap piece" : "Add to room";

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.error = isError ? "true" : "false";
  }

  function showError(error) {
    const retry = Number.isFinite(error?.retryAfter) && error.retryAfter > 0
      ? " Try again in " + Math.ceil(error.retryAfter) + " seconds."
      : "";
    showStatus((error?.message || "Shopify is temporarily unavailable.") + retry, true);
    renderShopifyWarnings(warningTarget, [...searchWarnings, ...(error?.warnings ?? [])]);
  }

  function beginRequest() {
    pending?.abort();
    pending = new AbortController();
    return pending;
  }

  function isCurrent(controller) {
    return !disposed && pending === controller && !controller.signal.aborted;
  }

  function renderResults() {
    recommend.hidden = !products.length;
    recommend.disabled = Boolean(pending) || !products.some(canAdoptCandidate);
    actions = [];
    results.replaceChildren(...products.map((product, index) => {
      const chosen = Boolean(recommendedId && productCandidateId(product) === recommendedId);
      const label = chosen ? (swap ? "Approve replacement" : "Approve addition") : actionLabel;
      const [card, action] = createResult(product, label, () => selectProduct(index, chosen));
      actions.push(action);
      return card;
    }));
  }

  function expireResults() {
    clearTimeout(expiryTimer);
    candidateSession.clear();
    pending?.abort();
    pending = undefined;
    products = [];
    recommendedId = undefined;
    searchWarnings = [];
    offerWithNotices = undefined;
    kindSelect.disabled = false;
    renderResults();
    renderShopifyWarnings(warningTarget);
    showStatus("Shopify results expired. Search again for current prices.");
  }

  function placeProduct(product, kind, approved) {
    candidateSession.remember({ query: searchQuery, kind, products, warnings: searchWarnings }, expiresAt);
    const placed = onPlace(product, kind, approved);
    showStatus(placed ? "" : "This piece needs more clear space in the room.", !placed);
    return placed;
  }

  async function selectProduct(index, approved = false) {
    const selected = products[index];
    if (disposed || pending || !selected?.available) return;
    if (Date.now() >= expiresAt) {
      expireResults();
      return;
    }
    const previewKind = kindSelect.value;
    if (selected === offerWithNotices && !approved) {
      placeProduct(selected, previewKind, false);
      return;
    }
    const acknowledged = selected === offerWithNotices;
    offerWithNotices = undefined;
    const ref = { variantId: selected.variantId, sellerDomain: selected.sellerDomain };
    const controller = beginRequest();
    kindSelect.disabled = true;
    actions.forEach((action) => { action.disabled = true; });
    showStatus("Checking variant…");
    let placed = false;
    try {
      const { product, warnings } = await shopifyRequest("variant", { ref }, { signal: controller.signal });
      if (!isCurrent(controller)) return;
      renderShopifyWarnings(warningTarget, [...searchWarnings, ...(warnings ?? [])]);
      if (product?.variantId !== ref.variantId || product?.sellerDomain !== ref.sellerDomain) {
        showStatus("This Shopify variant could not be verified.", true);
        return;
      }
      products[index] = product;
      onQuote?.(product);
      if (!product.available) {
        showStatus("This variant is no longer available.", true);
        return;
      }
      if (formatShopifyMoney(product.priceMinor, product.currency) === null) {
        showStatus("Shopify could not confirm the price for this variant.", true);
        return;
      }
      const changed = product.priceMinor !== selected.priceMinor || product.currency !== selected.currency ||
        JSON.stringify(product.dimensions ?? null) !== JSON.stringify(selected.dimensions ?? null) ||
        product.deliveryEstimate !== selected.deliveryEstimate;
      if (approved && changed) {
        showStatus("This offer changed. Review the updated details before approving.");
        return;
      }
      if (warnings?.length && !acknowledged) {
        offerWithNotices = product;
        showStatus("Review the Shopify notices, then select " + actionLabel + " again.");
        warningTarget.scrollIntoView({ block: "nearest" });
        return;
      }
      placed = placeProduct(product, previewKind, approved);
    } catch (error) {
      if (isCurrent(controller)) showError(error);
    } finally {
      if (isCurrent(controller)) {
        pending = undefined;
        kindSelect.disabled = false;
        if (!placed) {
          renderResults();
          if (!actions[index]?.disabled) actions[index]?.focus({ preventScroll: true });
        }
      }
    }
  }

  async function requestRecommendation() {
    if (disposed || pending || !products.length) return;
    if (Date.now() >= expiresAt) return expireResults();
    const mode = swap ? "replace" : "add";
    const controller = beginRequest();
    recommendedId = undefined;
    offerWithNotices = undefined;
    renderResults();
    kindSelect.disabled = true;
    showStatus("Comparing current Shopify variants…");
    try {
      const refs = products.map(({ variantId, sellerDomain }) => ({ variantId, sellerDomain }));
      const data = await shopifyRequest("recommend", {
        mode, ...(swap ? { objectId } : {}), instruction: searchQuery, kind: kindSelect.value, refs,
      }, { signal: controller.signal });
      if (!isCurrent(controller)) return;
      const op = data.scenePatch?.operations?.[0];
      const requested = new Set(products.map(productCandidateId));
      const fresh = (data.products ?? []).filter((product) => requested.has(productCandidateId(product)));
      if (data.scenePatch?.operations?.length !== 1 || op?.type !== mode || (swap && op.objectId !== objectId) ||
          !fresh.some((product) => canAdoptCandidate(product) && productCandidateId(product) === op.productId)) {
        throw new Error("Gemini could not confirm a matching variant. Choose one directly.");
      }
      const byId = new Map(fresh.map((product) => [productCandidateId(product), product]));
      products = products.map((product) => byId.get(productCandidateId(product)) ??
        { ...product, available: null, priceMinor: null, deliveryEstimate: null });
      recommendedId = op.productId;
      candidateSession.remember({ query: searchQuery, kind: kindSelect.value, products, warnings: searchWarnings }, expiresAt);
      renderShopifyWarnings(warningTarget, [...searchWarnings, ...(data.warnings ?? [])]);
      showStatus("Review Gemini’s selection and approve it to save it to your layout and shopping list.");
    } catch (error) {
      if (isCurrent(controller)) showError(error);
    } finally {
      if (isCurrent(controller)) {
        pending = undefined;
        kindSelect.disabled = false;
        renderResults();
      }
    }
  }

  async function search(event) {
    event.preventDefault();
    const query = input.value.trim();
    if (disposed || !query) return;
    clearTimeout(expiryTimer);
    candidateSession.clear();
    searchQuery = query;
    recommendedId = undefined;
    const controller = beginRequest();
    kindSelect.disabled = false;
    products = [];
    searchWarnings = [];
    offerWithNotices = undefined;
    renderResults();
    renderShopifyWarnings(warningTarget, []);
    showStatus("Searching Shopify…");
    try {
      const data = await shopifyRequest("search", { query }, { signal: controller.signal });
      if (!isCurrent(controller)) return;
      products = data.products;
      searchWarnings = data.warnings ?? [];
      if (products.length) {
        ({ expiresAt } = candidateSession.remember({ query, kind: kindSelect.value, products, warnings: searchWarnings }));
        expiryTimer = setTimeout(expireResults, expiresAt - Date.now());
      }
      renderShopifyWarnings(warningTarget, searchWarnings);
      renderResults();
      showStatus(products.length ? "" : "No Shopify matches. Try a different search.");
    } catch (error) {
      if (isCurrent(controller)) showError(error);
    } finally {
      if (isCurrent(controller)) {
        pending = undefined;
        renderResults();
      }
    }
  }

  const previous = candidateSession.read();
  if (previous) {
    searchQuery = input.value = previous.query;
    products = [...previous.products];
    searchWarnings = previous.warnings;
    expiresAt = previous.expiresAt;
    if (!swap && kinds.some(({ value }) => value === previous.kind)) kindSelect.value = previous.kind;
    renderShopifyWarnings(warningTarget, searchWarnings);
    renderResults();
    expiryTimer = setTimeout(expireResults, Math.max(0, expiresAt - Date.now()));
  }

  recommend.addEventListener("click", requestRecommendation);
  kindSelect.addEventListener("change", () => {
    recommendedId = undefined;
    renderResults();
  });
  form.addEventListener("submit", search);
  return () => {
    disposed = true;
    clearTimeout(expiryTimer);
    pending?.abort();
    form.removeEventListener("submit", search);
  };
}
