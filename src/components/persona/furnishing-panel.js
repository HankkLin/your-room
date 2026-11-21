import { furnishingPath } from "../../agents/furnishing-contract.js";
import { previewFurnishing } from "../../persona/furnishing.js";

const money = (minor) => (minor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function mountFurnishingPanel(root, { getContext, onApprove }) {
  const requestButton = root.querySelector("[data-propose]");
  const status = root.querySelector("[role=status]");
  const preview = root.querySelector("[data-preview]");
  const list = root.querySelector("ul");
  const approve = root.querySelector("[data-approve]");
  let pending;
  let review;

  function reset() {
    pending?.abort();
    pending = undefined;
    review = undefined;
    requestButton.disabled = false;
    preview.hidden = true;
    status.textContent = "";
    list.replaceChildren();
  }
  // Rebuild the preview from the current brief, source prices, and geometry on approval.
  function signature(context, result) {
    return JSON.stringify([context.input, context.items, context.room, context.house, result]);
  }
  requestButton.onclick = async () => {
    reset();
    const controller = new AbortController();
    pending = controller;
    requestButton.disabled = true;
    try {
      const context = getContext();
      status.textContent = "Preparing a proposal for your household…";
      const response = await fetch(furnishingPath, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context.input), signal: controller.signal });
      const proposal = await response.json();
      if (pending !== controller) return;
      if (!response.ok) throw new Error(proposal.error || "Gemini is unavailable. You can still auto-style the room.");
      const result = previewFurnishing(context, proposal);
      if (signature(getContext(), result) !== signature(context, result)) throw new Error("The design brief changed. Request a new proposal.");
      review = { proposal, signature: signature(context, result) };
      for (const { item, priceMinor, source, operation } of result.additions) {
        const person = context.input.personas.find(({ id }) => id === operation.personaId);
        const room = context.input.rooms.find(({ id }) => id === operation.roomId);
        const row = document.createElement("li");
        row.textContent = item.name + " · " + room.name + " · " + money(priceMinor) + " (" + source + "). " +
          person.name + " · " + operation.need + ". " + operation.reason;
        list.append(row);
      }
      status.textContent = context.input.style + " · Estimated furniture total " + money(result.totalMinor) + " of " + money(context.input.budgetMinor) + ".";
      preview.hidden = false;
    } catch (error) {
      if (pending === controller) status.textContent = error.message;
    } finally {
      if (pending === controller) {
        pending = undefined;
        requestButton.disabled = false;
      }
    }
  };
  approve.onclick = () => {
    if (!review) return;
    try {
      const context = getContext();
      const result = previewFurnishing(context, review.proposal);
      if (signature(context, result) !== review.signature) throw new Error("The room or brief changed. Request a fresh proposal.");
      reset();
      onApprove(result.additions.map(({ item }) => item), context.input);
    } catch (error) {
      reset();
      status.textContent = error.message;
    }
  };
  root.querySelector("[data-discard]").onclick = reset;
  return reset;
}
