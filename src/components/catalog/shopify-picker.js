import "./shopify-picker.css";
import { productCandidateId, canAdoptCandidate, offerSignature, validCandidateRow } from "../../contracts/product.js";
import { formatShopifyMoney, renderShopifyWarnings, shopifyHttpsUrl } from "./shopify-ui.js";
import { productDestination } from "../../shopify/destinations.js";

function readCandidates(value) {
  if (!Array.isArray(value)) throw new Error("Shopify returned invalid product details. Search again.");
  const products = value.filter(validCandidateRow);
  if (value.length && !products.length) throw new Error("Shopify returned invalid product details. Search again.");
  return products;
}

export function createResult(product, label, onSelect) {
  const card = document.createElement("li");
  card.className = "shopify-picker-card";
  card.__candidateProduct = product;
  const heading = document.createElement("div");
  heading.className = "shopify-picker-card-heading";
  const imageUrl = shopifyHttpsUrl(product.imageUrl);
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove(), { once: true });
    heading.append(image);
  }

  const content = document.createElement("div");
  content.className = "shopify-picker-identity";
  const title = document.createElement("h3");
  title.textContent = product.title;
  const details = document.createElement("p");
  details.className = "muted";
  const variant = product.variantTitle !== product.title ? product.variantTitle : "";
  details.textContent = [product.merchant, variant].filter(Boolean).join(" · ");
  content.append(title, details);
  heading.append(content);

  const offer = document.createElement("p");
  offer.className = "shopify-picker-offer";
  const price = formatShopifyMoney(product.priceMinor, product.currency);
  const amount = document.createElement("strong");
  amount.textContent = price ?? "Price unavailable";
  const stock = document.createElement("span");
  stock.className = "shopify-picker-stock";
  stock.dataset.available = String(product.available === true);
  stock.textContent = product.available == null ? "Stock unknown" : product.available ? "In stock" : "Unavailable";
  offer.append(amount, " ", stock);

  const specs = document.createElement("div");
  specs.className = "shopify-picker-specs muted";
  const delivery = document.createElement("p");
  delivery.textContent = product.deliveryEstimate ? "Delivery " + product.deliveryEstimate : "Delivery unknown";

  const size = document.createElement("p");
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
  if (onSelect) place.addEventListener("click", onSelect);
  else place.hidden = true;
  actions.append(place);

  const productUrl = productDestination(product.productUrl, product);
  if (productUrl) {
    const link = document.createElement("a");
    link.href = productUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View at merchant";
    actions.append(link);
  } else actions.append(document.createTextNode("Product link unverified"));

  const preview = document.createElement("p");
  preview.textContent = product.modelUrl ? "Merchant 3D model" : "Furniture type preview";
  specs.append(delivery, size, preview);
  card.append(heading, offer, specs, actions);
  return [card, place];
}

export function mountShopifyPicker(root, {
  swap,
  browseOnly = false,
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
    '<label><input type="checkbox" name="modelsOnly"> With 3D models</label></form>' +
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
  let source;
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
    renderShopifyWarnings(warningTarget, [...searchWarnings, ...(error?.warnings ?? [])], products);
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
    recommend.hidden = browseOnly || !products.length;
    recommend.disabled = Boolean(pending) || !products.some(canAdoptCandidate);
    actions = [];
    results.replaceChildren(...products.map((product, index) => {
      const chosen = Boolean(recommendedId && productCandidateId(product) === recommendedId);
      const label = chosen ? (swap ? "Approve replacement" : "Approve addition") : actionLabel;
      const [card, action] = createResult(product, label, () => selectProduct(index, chosen));
      action.hidden = browseOnly;
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
    candidateSession.remember({ query: searchQuery, kind, products, warnings: searchWarnings, source }, expiresAt);
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
    const previewKind = selected.kind ?? kindSelect.value;
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
      renderShopifyWarnings(warningTarget, [...searchWarnings, ...(warnings ?? [])], products);
      if (!validCandidateRow(product) || productCandidateId(product) !== productCandidateId(ref)) {
        showStatus("This Shopify variant could not be verified.", true);
        return;
      }
      products[index] = selected.kind ? { ...product, kind: selected.kind, placed: selected.placed } : product;
      onQuote?.(product);
      if (!product.available) {
        showStatus("This variant is no longer available.", true);
        return;
      }
      if (formatShopifyMoney(product.priceMinor, product.currency) === null) {
        showStatus("Shopify could not confirm the price for this variant.", true);
        return;
      }
      const changed = offerSignature(product) !== offerSignature(selected);
      if (approved && changed) {
        showStatus("This offer changed. Review the updated details before approving.");
        return;
      }
      if (warnings?.length && !acknowledged) {
        offerWithNotices = products[index];
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
      const eligible = products.filter(row => !row.kind || row.kind === kindSelect.value);
      if (!eligible.length) throw new Error("Choose a furniture type from the shortlist.");
      const refs = eligible.map(({ variantId, sellerDomain }) => ({ variantId, sellerDomain }));
      const data = await shopifyRequest("recommend", {
        mode, ...(swap ? { objectId } : {}), instruction: searchQuery, kind: kindSelect.value, refs,
      }, { signal: controller.signal });
      if (!isCurrent(controller)) return;
      const op = data.scenePatch?.operations?.[0];
      const requested = new Set(eligible.map(productCandidateId));
      const fresh = readCandidates(data.products).filter((product) => requested.has(productCandidateId(product)));
      if (data.scenePatch?.operations?.length !== 1 || op?.type !== mode || (swap && op.objectId !== objectId) ||
          !fresh.some((product) => canAdoptCandidate(product) && productCandidateId(product) === op.productId)) {
        throw new Error("Gemini could not confirm a matching variant. Choose one directly.");
      }
      const byId = new Map(fresh.map((product) => [productCandidateId(product), product]));
      products = products.map(previous => {
        const key = productCandidateId(previous);
        if (!requested.has(key)) return previous;
        const next = byId.get(key);
        if (!next) return { ...previous, available: null, availableForSale: null, price: null, priceMinor: null, deliveryEstimate: null };
        return previous.kind ? { ...next, kind: previous.kind, placed: previous.placed } : next;
      });
      recommendedId = op.productId;
      candidateSession.remember({ query: searchQuery, kind: kindSelect.value, products, warnings: searchWarnings, source }, expiresAt);
      renderShopifyWarnings(warningTarget, [...searchWarnings, ...(data.warnings ?? [])], products);
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
    source = undefined;
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
      const data = await shopifyRequest("search", { query, ...(form.elements.modelsOnly.checked ? { modelsOnly: true } : {}) }, { signal: controller.signal });
      if (!isCurrent(controller)) return;
      products = readCandidates(data.products);
      searchWarnings = Array.isArray(data.warnings) ? data.warnings : [];
      if (products.length) {
        ({ expiresAt } = candidateSession.remember({ query, kind: kindSelect.value, products, warnings: searchWarnings }));
        expiryTimer = setTimeout(expireResults, expiresAt - Date.now());
      }
      renderShopifyWarnings(warningTarget, searchWarnings, products);
      renderResults();
      if (browseOnly && products.length) {
        const count = products.filter(canAdoptCandidate).length;
        showStatus(count + (count === 1 ? " variant available" : " variants available") + " for a furnishing proposal.");
      } else {
        showStatus(products.length ? "" : "No Shopify matches. Try a different search.");
      }
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
    source = previous.source;
    searchQuery = input.value = previous.query;
    products = [...previous.products];
    searchWarnings = previous.warnings;
    expiresAt = previous.expiresAt;
    if (!swap && kinds.some(({ value }) => value === previous.kind)) kindSelect.value = previous.kind;
    renderShopifyWarnings(warningTarget, searchWarnings, products);
    renderResults();
    expiryTimer = setTimeout(expireResults, Math.max(0, expiresAt - Date.now()));
  }

  recommend.addEventListener("click", requestRecommendation);
  kindSelect.addEventListener("change", () => {
    if (products.length) candidateSession.remember({ query: searchQuery, kind: kindSelect.value, products, warnings: searchWarnings, source }, expiresAt);
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
