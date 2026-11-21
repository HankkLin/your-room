import { formatShopifyMoney, shopifyHttpsUrl } from "./shopify-ui.js";

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

function formatMeter(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toPrecision(4)).toString();
}

function resolveDimensionsLabel(source) {
  const dims = source?.dimensions;
  const w = formatMeter(dims?.width ?? source?.width);
  const d = formatMeter(dims?.depth ?? source?.depth);
  const h = formatMeter(dims?.height ?? source?.height);
  if (!w || !d) return null;
  return h ? `${w} × ${d} × ${h} m` : `${w} × ${d} m`;
}

function resolveRawImageUrl(source, quote, catalogMatch) {
  const candidates = [
    Array.isArray(source?.imageUrls) ? source.imageUrls.find(Boolean) : null,
    Array.isArray(quote?.imageUrls) ? quote.imageUrls.find(Boolean) : null,
    quote?.imageUrl,
    source?.imageUrl,
    source?.product?.imageUrl,
    Array.isArray(source?.product?.imageUrls)
      ? source.product.imageUrls.find(Boolean)
      : null,
    source?.photo,
    catalogMatch?.photo,
  ];
  for (const candidate of candidates) {
    const clean = shopifyHttpsUrl(candidate);
    if (clean) return clean;
  }
  return null;
}

export function resolveProductDetails(
  source,
  { catalog = [], quotes = null, formatUsd = null, isLocked = false } = {},
) {
  if (!source || typeof source !== "object") return null;

  const quote =
    source.shopify && quotes?.get ? quotes.get(source.shopify) : null;
  const catalogMatch = Array.isArray(catalog)
    ? catalog.find(
        (entry) =>
          (source.productId && entry.id === source.productId) ||
          entry.id === source.id,
      )
    : null;

  const isFixed = Boolean(source.type === "fixed" || source.fromHouseFixture);
  const isOwned = Boolean(!isFixed && source.owned);
  const locked = Boolean(isFixed || isLocked || source.locked);

  const name =
    quote?.title ||
    source.title ||
    source.name ||
    catalogMatch?.name ||
    "Furniture piece";

  const imageUrl = resolveRawImageUrl(source, quote, catalogMatch);

  let priceLabel = "Price unavailable";
  if (isFixed) {
    priceLabel = "Fixed fixture";
  } else if (isOwned) {
    priceLabel = "Owned";
  } else if (typeof source.priceMinor === "number" && source.currency) {
    priceLabel =
      formatShopifyMoney(source.priceMinor, source.currency) ??
      "Price unavailable";
  } else if (source.shopify) {
    priceLabel =
      formatShopifyMoney(quote?.priceMinor, quote?.currency) ??
      "Price unconfirmed";
  } else if (Number.isFinite(Number(source.price))) {
    priceLabel = formatUsd
      ? formatUsd(Number(source.price))
      : `$${Math.round(Number(source.price)).toLocaleString("en-US")}`;
  } else if (Number.isFinite(Number(catalogMatch?.price))) {
    priceLabel = formatUsd
      ? formatUsd(Number(catalogMatch.price))
      : `$${Math.round(Number(catalogMatch.price)).toLocaleString("en-US")}`;
  }

  let avail = null;
  if (quote && typeof quote.available === "boolean") {
    avail = quote.available;
  } else if (typeof source.available === "boolean") {
    avail = source.available;
  } else if (typeof source.product?.available === "boolean") {
    avail = source.product.available;
  }

  let stockLabel = "Availability unknown";
  let stockState = "unknown";
  if (isFixed) {
    stockLabel = "Fixed fixture · Locked";
    stockState = "fixed";
  } else if (isOwned) {
    stockLabel = "Owned furniture";
    stockState = "owned";
  } else if (avail === true) {
    stockLabel = "✓ In stock";
    stockState = "in-stock";
  } else if (avail === false) {
    stockLabel = "Unavailable";
    stockState = "unavailable";
  }

  const rawMerchant =
    quote?.merchant ||
    source.merchant ||
    source.product?.merchant ||
    source.store ||
    catalogMatch?.store ||
    source.shopify?.sellerDomain ||
    null;
  const merchant = isFixed
    ? "Built-in architecture"
    : isOwned
      ? "Household item"
      : rawMerchant || null;

  const rawVariant =
    quote?.variantTitle ||
    source.variantTitle ||
    source.variant ||
    catalogMatch?.variant ||
    null;
  const variant =
    rawVariant &&
    rawVariant !== "Default Title" &&
    rawVariant.toLowerCase() !== String(name).toLowerCase()
      ? rawVariant
      : null;

  const dimensionsLabel = resolveDimensionsLabel(source);

  return {
    id: source.id || source.productId || name,
    name,
    imageUrl,
    priceLabel,
    stockLabel,
    stockState,
    hasKnownAvailability: typeof avail === "boolean",
    merchant,
    variant,
    dimensionsLabel,
    isOwned,
    isFixed,
    locked,
  };
}

export function renderProductPreviewMarkup(
  details,
  { fallbackGlyphHtml = "", pinned = false } = {},
) {
  if (!details) return "";
  const mediaHtml = details.imageUrl
    ? `<div class="bp-preview-media">
        <img src="${escapeHtml(details.imageUrl)}" alt="${escapeHtml(details.name)}" loading="lazy" referrerpolicy="no-referrer" />
      </div>`
    : `<div class="bp-preview-media bp-preview-fallback">${fallbackGlyphHtml}</div>`;

  const metaParts = [details.variant, details.dimensionsLabel].filter(Boolean);

  return `<div class="bp-preview-inner" data-stock-state="${escapeHtml(details.stockState)}">
    ${pinned ? '<button type="button" class="bp-preview-close" data-close-preview aria-label="Close product details">×</button>' : ""}
    ${mediaHtml}
    <div class="bp-preview-body">
      <strong class="bp-preview-title">${escapeHtml(details.name)}</strong>
      <div class="bp-preview-price-row">
        <span class="bp-preview-price">${escapeHtml(details.priceLabel)}</span>
        <span class="bp-preview-stock" data-stock="${escapeHtml(details.stockState)}">${escapeHtml(details.stockLabel)}</span>
      </div>
      ${details.merchant ? `<div class="bp-preview-merchant">${escapeHtml(details.merchant)}</div>` : ""}
      ${metaParts.length ? `<div class="bp-preview-meta">${metaParts.map(escapeHtml).join(" · ")}</div>` : ""}
    </div>
  </div>`;
}
