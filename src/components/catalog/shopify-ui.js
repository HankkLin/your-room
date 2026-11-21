import { shopifyHttpsUrl } from "../../contracts/product.js";
export { shopifyHttpsUrl };

export function formatShopifyMoney(amountMinor, currency) {
  if (!Number.isSafeInteger(amountMinor) || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return null;
  }
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amountMinor / 10 ** fractionDigits);
}

export function renderShopifyWarnings(container, warnings = []) {
  const list = document.createElement("ul");
  list.className = "shopify-warnings";
  for (const warning of warnings ?? []) {
    if (typeof warning?.text !== "string" || !warning.text.trim()) continue;
    const item = document.createElement("li");
    item.textContent = warning.text;
    for (const link of warning.links ?? []) {
      const href = shopifyHttpsUrl(link?.url);
      if (!href || !link.label) continue;
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = link.label;
      item.append(" ", anchor);
    }
    const imageUrl = shopifyHttpsUrl(warning.imageUrl);
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      item.append(image);
    }
    list.append(item);
  }
  container.hidden = !list.childElementCount;
  container.replaceChildren(list);
}
