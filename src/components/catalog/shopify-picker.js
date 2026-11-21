import "./shopify-picker.css";
import { formatShopifyMoney, renderShopifyWarnings, shopifyHttpsUrl } from "./shopify-ui.js";

const quoteMaxAge = 10 * 60 * 1000;

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
  offer.textContent = [price ?? "Price unavailable", product.available ? "In stock" : "Unavailable"].join(" · ");

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

  content.append(title, details, offer, actions);
  card.append(content);
  return [card, place];
}

export function mountShopifyPicker(root, {
  swap,
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
    '</form><p class="muted">3D previews use approximate dimensions for the selected furniture type.</p>' +
    '<p class="shopify-picker-status muted" role="status"></p><div data-shopify-warnings hidden></div>' +
    '<ul class="shopify-picker-results"></ul></div>';
  const form = root.querySelector("form");
  const input = form.querySelector("input");
  const kindSelect = form.querySelector("select");
  const status = root.querySelector("[role=status]");
  const warningTarget = root.querySelector("[data-shopify-warnings]");
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
    actions = [];
    results.replaceChildren(...products.map((product, index) => {
      const [card, action] = createResult(product, actionLabel, () => selectProduct(index));
      actions.push(action);
      return card;
    }));
  }

  function expireResults() {
    clearTimeout(expiryTimer);
    pending?.abort();
    pending = undefined;
    products = [];
    searchWarnings = [];
    offerWithNotices = undefined;
    kindSelect.disabled = false;
    renderResults();
    renderShopifyWarnings(warningTarget);
    showStatus("Shopify results expired. Search again for current prices.");
  }

  function placeProduct(product, kind) {
    const placed = onPlace(product, kind);
    showStatus(placed ? "" : "This piece needs more clear space in the room.", !placed);
    return placed;
  }

  async function selectProduct(index) {
    const selected = products[index];
    if (disposed || pending || !selected?.available) return;
    if (Date.now() >= expiresAt) {
      expireResults();
      return;
    }
    const previewKind = kindSelect.value;
    if (selected === offerWithNotices) {
      placeProduct(selected, previewKind);
      return;
    }
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
      if (warnings?.length) {
        offerWithNotices = product;
        showStatus("Review the Shopify notices, then select " + actionLabel + " again.");
        warningTarget.scrollIntoView({ block: "nearest" });
        return;
      }
      placed = placeProduct(product, previewKind);
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

  async function search(event) {
    event.preventDefault();
    const query = input.value.trim();
    if (disposed || !query) return;
    clearTimeout(expiryTimer);
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
        expiresAt = Date.now() + quoteMaxAge;
        expiryTimer = setTimeout(expireResults, quoteMaxAge);
      }
      renderShopifyWarnings(warningTarget, searchWarnings);
      renderResults();
      showStatus(products.length ? "" : "No Shopify matches. Try a different search.");
    } catch (error) {
      if (isCurrent(controller)) showError(error);
    } finally {
      if (isCurrent(controller)) pending = undefined;
    }
  }

  form.addEventListener("submit", search);
  return () => {
    disposed = true;
    clearTimeout(expiryTimer);
    pending?.abort();
    form.removeEventListener("submit", search);
  };
}
