import { furniturePreviewKinds, resolveBrief } from "../../../model.js";
import { parseStyleBrief } from "../../agents/style-brief.js";
import { searchProductsForDesign } from "../../shopify/design-search.js";
import { renderShopifyWarnings } from "./shopify-ui.js";
import { createResult } from "./shopify-picker.js";

export function mountDesignSearch(root, { getContext, session, onChange }) {
  const roomSelect = root.querySelector("[data-design-room]");
  const kindSelect = root.querySelector("[data-design-kind]");
  const query = root.querySelector("[data-item-query]");
  const status = root.querySelector("[role=status]");
  const results = root.querySelector("ul");
  const notices = root.querySelector("[data-notices]");
  const summary = root.querySelector("[data-intent]");
  for (const kind of furniturePreviewKinds) kindSelect.add(new Option(kind, kind));
  let controller;
  let brief;

  function clearResults() {
    controller?.abort();
    if (session.read()?.source === "design") session.clear();
    results.replaceChildren();
    status.textContent = "";
    renderShopifyWarnings(notices);
    onChange();
  }
  function reset() {
    clearResults();
    brief = null;
    summary.textContent = "";
  }
  function enter() {
    reset();
    query.value = "";
    kindSelect.value = "";
    roomSelect.replaceChildren(...getContext().rooms.map(room => new Option(room.name, room.id)));
  }

  async function discover(fromBrief) {
    clearResults();
    const pending = new AbortController();
    controller = pending;
    const { prompt, rooms, budgetOverride, budget, existingPieces } = getContext();
    const room = rooms.find(item => item.id === roomSelect.value);
    try {
      if (fromBrief) {
        brief = null;
        summary.textContent = "";
        status.textContent = "Reading your design brief…";
        const parsed = await parseStyleBrief({ prompt, rooms, budgetOverride }, { signal: pending.signal });
        if (pending.signal.aborted) return;
        brief = parsed;
        if (brief.budget && brief.budget.currency !== "USD") {
          brief = null;
          throw new Error("The catalog currently supports budgets in USD. You can search by item.");
        }
        summary.textContent = [...brief.styles, ...brief.materials, ...brief.colors, ...brief.priorities,
          ...(brief.budget ? [new Intl.NumberFormat("en-US", { style: "currency", currency: brief.budget.currency }).format(brief.budget.amount)] : [])].join(" · ");
      }
      const manual = fromBrief ? "" : query.value.trim();
      if (!fromBrief && !manual) throw new Error("Enter an item to search for.");
      status.textContent = "Searching Shopify…";
      const { products, warnings } = await searchProductsForDesign({ styleBrief: brief, room,
        constraints: { query: manual, kind: kindSelect.value, budget: { amount: budget, currency: "USD" }, existingPieces } },
      { signal: pending.signal });
      if (pending.signal.aborted) return;
      if (products.length) session.remember({ source: "design", query: manual || prompt, kind: products[0].kind, products, warnings });
      const cards = products.map(product => {
        const [card] = createResult(product, "", null);
        if (product.placed) {
          const tag = document.createElement("p");
          tag.className = "shopify-picker-room";
          tag.textContent = "In this room";
          card.append(tag);
        }
        return card;
      });
      results.replaceChildren(...cards);
      renderShopifyWarnings(notices, warnings, products);
      status.textContent = products.length ? products.length + (products.length === 1 ? " matching variant" : " matching variants") : "No matching variants. Try another item or budget.";
    } catch (error) {
      if (!pending.signal.aborted) status.textContent = error.message;
    }
  }
  root.querySelector("[data-search-brief]").onclick = () => discover(true);
  root.querySelector("form").onsubmit = event => { event.preventDefault(); void discover(false); };
  query.oninput = () => {
    clearResults();
    const inferred = resolveBrief({ brief: query.value }).prioritizeKinds[0];
    kindSelect.value = furniturePreviewKinds.includes(inferred) ? inferred : "";
  };
  kindSelect.onchange = roomSelect.onchange = clearResults;
  return { reset, enter, leave: () => controller?.abort(), getBrief: () => brief };
}
