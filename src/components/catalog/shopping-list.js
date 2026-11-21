import { productCandidateId } from "../../contracts/product.js";
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
  const excluded = new Set();
  let groups = new Map();
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
      panel.append(externalLink(attempt.continueUrl, "Continue to Shopify checkout", "primary"));
    return panel;
  }

  function makeCard(row, product) {
    const live = Boolean(row.shopify);
    const title = live
      ? product?.title || row.name || "Saved Shopify piece"
      : product?.name || row.name || "Saved piece";
    const merchant = live
      ? product?.merchant || row.merchant || row.shopify.sellerDomain
      : product?.store || product?.merchant || row.merchant || row.store || "Merchant";
    const variant = live ? product?.variantTitle ?? row.variant : product?.variant || row.variant;
    const numericPrice = Number(product?.price ?? row.price);
    const price = live
      ? formatShopifyMoney(product?.priceMinor, product?.currency)
      : Number.isFinite(numericPrice)
        ? formatUsd(numericPrice)
        : null;
    const photoUrl = shopifyHttpsUrl((live ? product?.imageUrl : product?.photo) ?? row.photo);
    const productUrl = shopifyHttpsUrl((live ? product?.productUrl : product?.url) ?? row.url);
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
    if (live && !price && !refreshing) body.append(element("p", "variant", "Price unconfirmed"));
    if (live && row.savedPrice && price &&
        (row.savedPrice.priceMinor !== product.priceMinor || row.savedPrice.currency !== product.currency)) {
      const original = formatShopifyMoney(row.savedPrice.priceMinor, row.savedPrice.currency);
      if (original) body.append(element("p", "variant", `Price changed since saving · previously ${original}`));
    }
    if (live) {
      const availability = product?.available === true
        ? "Available"
        : product?.available === false
          ? "Unavailable"
          : refreshing ? "Checking availability…" : "Availability unconfirmed";
      body.append(element("p", "variant", availability));
    }
    const footer = element("div", "shop-card-footer");
    if (live) {
      const label = element("label", "shop-include");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !excluded.has(row.id);
      input.disabled = !productCandidateId(row.shopify);
      input.dataset.include = row.id;
      input.setAttribute("aria-label", `Include ${title} in checkout`);
      label.append(input, ` Include · Qty ${row.quantity ?? 1}`);
      footer.append(label);
    }
    if (productUrl)
      footer.append(externalLink(productUrl, `View product at ${merchant} ↗`, "text-btn"));
    const remove = element("button", "text-btn", "Remove");
    remove.type = "button";
    remove.dataset.unsave = row.id;
    footer.append(remove);
    body.append(footer);
    card.append(photo, body);
    return card;
  }

  function checkoutGroup(entries) {
    const variants = new Map();
    let ready = true;
    for (const { row, product } of entries) {
      if (excluded.has(row.id)) continue;
      const { variantId } = row.shopify;
      const quantity = row.quantity ?? 1;
      let line = variants.get(variantId);
      if (!line) {
        line = { ref: row.shopify, quantity: 0, priceMinor: product?.priceMinor, currency: product?.currency };
        variants.set(variantId, line);
      }
      line.quantity += quantity;
      if (product?.available !== true || !formatShopifyMoney(line.priceMinor, line.currency) ||
          !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(line.quantity)) ready = false;
    }
    const lines = [...variants.values()];
    return { entries, lines, signature: JSON.stringify(lines), ready: ready && lines.length > 0 };
  }

  function canStart(domain, group) {
    const attempt = checkoutAttempts.get(domain);
    return !refreshing && group.ready && !attempt?.pending && !attempt?.continueUrl && !attempt?.uncertain;
  }

  function merchantSection(domain, group) {
    const section = element("section", "shop-merchant");
    section.setAttribute("aria-label", domain);
    section.append(element("h2", null, domain));
    const cards = element("div", "shop-merchant-cards");
    cards.append(...group.entries.map(({ row, product }) => makeCard(row, product)));
    section.append(cards);
    const start = element("button", "primary", "Start checkout");
    start.type = "button";
    start.dataset.checkout = domain;
    start.disabled = !canStart(domain, group);
    section.append(start);
    const attempt = checkoutAttempts.get(domain);
    if (attempt) section.append(renderCheckout(attempt));
    return section;
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
    const byMerchant = new Map();
    const catalogCards = [];
    for (const entry of saved) {
      if (!productCandidateId(entry.row.shopify)) {
        catalogCards.push(makeCard(entry.row, entry.product));
        continue;
      }
      const domain = entry.row.shopify.sellerDomain.toLowerCase();
      if (!byMerchant.has(domain)) byMerchant.set(domain, []);
      byMerchant.get(domain).push(entry);
    }
    groups = new Map([...byMerchant].map(([domain, entries]) => [domain, checkoutGroup(entries)]));
    for (const [domain, attempt] of checkoutAttempts) {
      const group = groups.get(domain);
      if (!group || (!attempt.error && (attempt.signature !== group.signature || !group.ready))) clearAttempt(domain);
    }
    const display = [];
    if (groups.size > 1) {
      const all = element("button", "primary shop-checkout-all", "Prepare all merchant checkouts");
      all.type = "button";
      all.dataset.checkoutAll = "";
      all.disabled = ![...groups].some(([domain, group]) => canStart(domain, group));
      display.push(all);
    }
    for (const [domain, group] of groups) display.push(merchantSection(domain, group));
    display.push(...catalogCards);
    root.replaceChildren(...(display.length ? display : [element("div", "shop-empty", "Your saved products will appear here.")]));
    const included = saved.filter(({ row }) => !row.shopify || !excluded.has(row.id));
    const knownMinor = included.map(({ row, product }) => row.shopify
      ? product?.currency === "USD" && Number.isSafeInteger(product.priceMinor) ? product.priceMinor * (row.quantity ?? 1) : null
      : Math.round(product.price * 100));
    const partial = knownMinor.includes(null);
    const subtotal = knownMinor.reduce((sum, amount) => sum + (amount ?? 0), 0);
    total.textContent = `${partial ? "Partial estimated subtotal" : "Estimated subtotal"} · ${formatUsd(subtotal / 100)}`;
  }

  function clearAttempt(id) {
    checkoutAttempts.get(id)?.controller?.abort();
    checkoutAttempts.delete(id);
  }

  async function startCheckout(domain, group) {
    if (!canStart(domain, group)) return;
    const { signature, lines } = group;
    const controller = new AbortController();
    checkoutAttempts.set(domain, { pending: true, signature, controller });
    render();
    try {
      const result = await shopifyRequest("checkout", { lines }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const continueUrl = shopifyHttpsUrl(result.continueUrl);
      checkoutAttempts.set(domain, continueUrl
        ? { ...result, continueUrl, signature }
        : { error: "The merchant did not provide a checkout link.", warnings: result.warnings, uncertain: true, signature });
    } catch (error) {
      if (controller.signal.aborted) return;
      checkoutAttempts.set(domain, {
        signature,
        error: error.message,
        warnings: error.warnings,
        uncertain: error.uncertain,
      });
      if (error.products?.length) error.products.forEach((product) => quotes.remember(product));
      else if (error.status === 409) onStockChange();
    }
    render();
  }

  root.addEventListener("change", (event) => {
    const input = event.target.closest("[data-include]");
    if (!input) return;
    const id = input.dataset.include;
    const row = current?.savedProducts?.find((item) => item.id === id);
    if (!productCandidateId(row?.shopify)) return;
    if (input.checked) excluded.delete(id);
    else excluded.add(id);
    clearAttempt(row.shopify.sellerDomain.toLowerCase());
    render();
  });

  root.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-unsave]");
    if (remove) {
      const id = remove.dataset.unsave;
      const row = current?.savedProducts?.find((item) => item.id === id);
      if (productCandidateId(row?.shopify)) clearAttempt(row.shopify.sellerDomain.toLowerCase());
      excluded.delete(id);
      onRemove(id);
      return;
    }
    if (event.target.closest("[data-checkout-all]")) {
      for (const [domain, group] of groups) void startCheckout(domain, group);
      return;
    }
    const domain = event.target.closest("[data-checkout]")?.dataset.checkout;
    if (groups.has(domain)) void startCheckout(domain, groups.get(domain));
  });

  return {
    render,
    showLookupStatus,
    close() {
      for (const id of checkoutAttempts.keys()) clearAttempt(id);
      groups.clear();
      excluded.clear();
      current = null;
      showLookupStatus();
    },
  };
}
