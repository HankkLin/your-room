import { furnishingPath } from "../../agents/furnishing-contract.js";
import { previewFurnishing } from "../../persona/furnishing.js";

const money = (minor) => (minor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const AI_DESIGN_STAGES = Object.freeze([
  "Understanding your household",
  "Reading your style",
  "Matching existing furniture",
  "Searching Shopify",
  "Planning clearances",
  "Checking accessibility",
  "Designing your home",
]);

export function renderAiDesignStagesMarkup(activeIndex = -1, { completed = false, failed = false } = {}) {
  const items = AI_DESIGN_STAGES.map((label, idx) => {
    const state = completed
      ? "done"
      : failed && idx === activeIndex
        ? "failed"
        : idx < activeIndex
          ? "done"
          : idx === activeIndex
            ? "active"
            : "idle";
    return `<li class="bp-ai-stage" data-ai-stage="${idx}" data-stage-state="${state}">
      <span class="bp-ai-pip" aria-hidden="true">${state === "done" ? "✓" : idx + 1}</span>
      <span>${label}</span>
    </li>`;
  }).join("");
  return `<ol class="bp-ai-stages" aria-label="AI design pipeline stages">${items}</ol>`;
}

export function mountFurnishingPanel(root, { getContext, refreshRetained, refreshSelected, onApprove }) {
  const requestButton = root.querySelector("[data-propose]");
  const status = root.querySelector("[role=status]");
  const preview = root.querySelector("[data-preview]");
  const list = root.querySelector("ul");
  const approve = root.querySelector("[data-approve]");
  const stageHost = root.querySelector("[data-ai-stages]");
  let pending;
  let review;
  let stageTimer;

  function clearStageTimer() {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = undefined;
    }
  }

  function showStages(index = -1, opts = {}) {
    if (!stageHost) return;
    if (index < 0 && !opts.completed && !opts.failed) {
      stageHost.hidden = true;
      stageHost.innerHTML = "";
      return;
    }
    stageHost.hidden = false;
    stageHost.innerHTML = renderAiDesignStagesMarkup(index, opts);
  }

  function reset() {
    clearStageTimer();
    pending?.abort();
    pending = undefined;
    review = undefined;
    requestButton.disabled = false;
    approve.disabled = false;
    preview.hidden = true;
    status.textContent = "";
    list.replaceChildren();
    showStages(-1);
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
    let currentStage = 0;
    showStages(0);
    try {
      currentStage = 2;
      showStages(currentStage);
      await refreshRetained(controller.signal);
      if (pending !== controller) return;
      const context = getContext();
      currentStage = 3;
      showStages(currentStage);
      status.textContent = "Preparing a proposal for your household…";
      stageTimer = setInterval(() => {
        if (currentStage < AI_DESIGN_STAGES.length - 1) {
          currentStage += 1;
          showStages(currentStage);
        }
      }, 420);
      const response = await fetch(furnishingPath, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context.input), signal: controller.signal });
      const proposal = await response.json();
      clearStageTimer();
      if (pending !== controller) return;
      if (!response.ok) throw new Error(proposal.error || "Gemini is unavailable. You can still auto-style the room.");
      showStages(5);
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
      showStages(AI_DESIGN_STAGES.length - 1, { completed: true });
      status.textContent = context.input.style + " · Estimated furniture total " + money(result.totalMinor) + " of " + money(context.input.budgetMinor) + ".";
      preview.hidden = false;
    } catch (error) {
      clearStageTimer();
      if (pending === controller) {
        showStages(currentStage, { failed: true });
        status.textContent = error.message;
      }
    } finally {
      clearStageTimer();
      if (pending === controller) {
        pending = undefined;
        requestButton.disabled = false;
      }
    }
  };
  approve.onclick = async () => {
    if (!review || pending) return;
    const controller = new AbortController();
    pending = controller;
    approve.disabled = true;
    requestButton.disabled = true;
    try {
      const context = getContext();
      const proposed = previewFurnishing(context, review.proposal);
      if (signature(context, proposed) !== review.signature) throw new Error("The room or brief changed. Request a fresh proposal.");
      status.textContent = "Checking the current proposal…";
      await refreshRetained(controller.signal);
      if (pending !== controller) return;
      await refreshSelected(proposed.additions.map(({ item }) => item), controller.signal);
      if (pending !== controller) return;
      const fresh = getContext();
      const result = previewFurnishing(fresh, review.proposal);
      if (signature(fresh, result) !== review.signature) throw new Error("The room, prices, or brief changed. Request a fresh proposal.");
      reset();
      onApprove(result.additions.map(({ item }) => item), fresh.input);
    } catch (error) {
      if (pending !== controller) return;
      reset();
      status.textContent = error.message;
    }
  };
  root.querySelector("[data-discard]").onclick = reset;
  return reset;
}
