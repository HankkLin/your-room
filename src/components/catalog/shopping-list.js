import { shopifyRequest } from "../../shopify/shopify-client.js";
import { formatShopifyMoney, renderShopifyWarnings, shopifyHttpsUrl } from "./shopify-ui.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function externalLink(url, label, className) {
  const link = element("a", className, label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

export function createShoppingList({ root, intro, total, catalog, quotes, formatUsd, onRemove, onStockChange }) {
  const checkoutAttempts = new Map();
  const messages = element("div");
  messages.setAttribute("role", "status");
  messages.hidden = true;
  intro.after(messages);
  let current;
  let refreshing = false;

  function showLookupStatus({ loading = false, error, warnings } = {}) {
    refreshing = loading;
    messages.replaceChildren();
    messages.hidden = !loading && !error && !warnings?.length;
    if (loading || error)
      messages.append(element("p", "muted", loading ? "Refreshing Shopify prices and availability…" : error));
    if (warnings?.length) {
      const notice = element("div");
      renderShopifyWarnings(notice, warnings);
      messages.append(notice);
    }
  }

  function renderCheckout(attempt) {
    const panel = element("div", "shop-checkout");
    panel.setAttribute("role", "status");
    if (attempt.pending) panel.append(element("p", "muted", "Preparing checkout…"));
    if (attempt.error) panel.append(element("p", "muted", attempt.error));
    if (attempt.warnings?.length) {
      const warnings = element("div");
      renderShopifyWarnings(warnings, attempt.warnings);
      panel.append(warnings);
    }
    if (attempt.totals?.length) {
      const summary = element("dl", "shop-checkout-totals");
      for (const { label, amountMinor } of attempt.totals) {
        const formatted = formatShopifyMoney(amountMinor, attempt.currency);
        if (formatted) summary.append(element("dt", null, label), element("dd", null, formatted));
      }
      if (summary.childElementCount) panel.append(summary);
    }
    for (const { label, url } of attempt.links ?? []) {
      const href = shopifyHttpsUrl(url);
      if (href) panel.append(externalLink(href, label, "text-btn"));
    }
    if (attempt.continueUrl)
      panel.append(externalLink(attempt.continueUrl, "Continue to checkout", "primary"));
    return panel;
  }

  function makeCard(row, product) {
    const live = Boolean(row.shopify);
    const title = live
      ? product?.title || row.name || "Saved Shopify piece"
      : product?.name || row.name || "Saved piece";
    const merchant = live
      ? product?.merchant || row.shopify.sellerDomain
      : product?.store || product?.merchant || row.merchant || row.store || "Merchant";
    const variant = live ? product?.variantTitle : product?.variant || row.variant;
    const numericPrice = Number(product?.price ?? row.price);
    const price = live
      ? formatShopifyMoney(product?.priceMinor, product?.currency)
      : Number.isFinite(numericPrice)
        ? formatUsd(numericPrice)
        : null;
    const photoUrl = live ? shopifyHttpsUrl(product?.imageUrl) : (product?.photo || row.photo || null);
    const productUrl = live ? shopifyHttpsUrl(product?.productUrl) : (product?.url || row.url || null);
    const card = element("article", "shop-card");
    const photo = element("div", "shop-photo");
    if (photoUrl) {
      const image = element("img");
      image.src = photoUrl;
      image.alt = title;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      photo.append(image);
    }
    const body = element("div", "shop-card-body");
    body.append(element("span", "merchant", merchant), element("h2", null, title));
    if (variant && variant !== "Default Title") body.append(element("p", "variant", variant));
    if (price) body.append(element("strong", null, price));
    if (live) {
      const availability = product?.available === true
        ? "Available"
        : product?.available === false
          ? "Unavailable"
          : refreshing ? "Checking availability…" : "Availability unconfirmed";
      body.append(element("p", "variant", availability));
    }
    const footer = element("div", "shop-card-footer");
    const attempt = checkoutAttempts.get(row.id);
    if (live && product?.available && price) {
      const start = element("button", "primary", "Start checkout");
      start.type = "button";
      start.dataset.checkout = row.id;
      start.disabled = refreshing || Boolean(attempt?.pending || attempt?.continueUrl || attempt?.uncertain);
      footer.append(start);
    }
    if (productUrl)
      footer.append(externalLink(productUrl, `Shop at ${merchant} ↗`, live ? "text-btn" : "primary"));
    const remove = element("button", "text-btn", "Remove");
    remove.type = "button";
    remove.dataset.unsave = row.id;
    footer.append(remove);
    body.append(footer);
    if (attempt) body.append(renderCheckout(attempt));
    card.append(photo, body);
    return card;
  }

  function render(project = current) {
    if (!project) return;
    current = project;
    const saved = (project.savedProducts ?? []).flatMap((row) => {
      const product = row.shopify
        ? quotes.get(row.shopify)
        : catalog.find((piece) => piece.id === row.productId) ||
          (row.name && (row.merchant || row.store || row.url || Number.isFinite(Number(row.price)))
            ? row
            : null);
      return row.shopify || product ? [{ row, product }] : [];
    });
    intro.textContent = saved.length
      ? `Saved for ${project.roomName}. Models approximate each piece. The merchant confirms the final price and availability.`
      : "Save a piece while exploring, or save all the suggestions from your layout.";
    root.replaceChildren(...(saved.length
      ? saved.map(({ row, product }) => makeCard(row, product))
      : [element("div", "shop-empty", "Your saved products will appear here.")]));
    const knownMinor = saved.map(({ row, product }) => row.shopify
      ? product?.currency === "USD" && Number.isSafeInteger(product.priceMinor) ? product.priceMinor : null
      : Number.isFinite(Number(product?.price)) ? Math.round(Number(product.price) * 100) : null);
    const partial = knownMinor.includes(null);
    const subtotal = knownMinor.reduce((sum, amount) => sum + (amount ?? 0), 0);
    total.textContent = `${partial ? "Partial estimated subtotal" : "Estimated subtotal"} · ${formatUsd(subtotal / 100)}`;
  }

  function clearAttempt(id) {
    checkoutAttempts.get(id)?.controller?.abort();
    checkoutAttempts.delete(id);
  }

  async function startCheckout(row) {
    const previous = checkoutAttempts.get(row.id);
    if (refreshing || previous?.pending || previous?.continueUrl || previous?.uncertain ||
        !quotes.get(row.shopify)?.available) return;
    const controller = new AbortController();
    const attempt = { pending: true, controller };
    checkoutAttempts.set(row.id, attempt);
    render();
    try {
      const result = await shopifyRequest("checkout", { ref: row.shopify }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const continueUrl = shopifyHttpsUrl(result.continueUrl);
      checkoutAttempts.set(row.id, continueUrl
        ? { ...result, continueUrl }
        : { error: "The merchant did not provide a checkout link.", warnings: result.warnings, uncertain: true });
    } catch (error) {
      if (controller.signal.aborted) return;
      checkoutAttempts.set(row.id, {
        error: error.message,
        warnings: error.warnings,
        uncertain: error.uncertain,
      });
      if (error.status === 409) onStockChange();
    }
    render();
  }

  root.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-unsave]");
    if (remove) {
      clearAttempt(remove.dataset.unsave);
      onRemove(remove.dataset.unsave);
      return;
    }
    const button = event.target.closest("[data-checkout]");
    const row = button && current?.savedProducts?.find((item) => item.id === button.dataset.checkout);
    if (row?.shopify) void startCheckout(row);
  });

  return {
    render,
    showLookupStatus,
    close() {
      for (const id of checkoutAttempts.keys()) clearAttempt(id);
      current = null;
      showLookupStatus();
    },
  };
}
