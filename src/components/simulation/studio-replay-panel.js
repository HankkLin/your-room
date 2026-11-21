import { FINDING_TYPES } from "../../contracts/simulation.js";
import { captureStudioLayout, runStudioReplay } from "../../simulation/studio-replay.js";

const replayMeasures = [
  ["pathFailures", "Path failures"],
  ["collisions", "Collisions"],
  ["congestionEvents", "Congestion events"],
];

function householdSignature({ house, personas, rooms }) {
  const roomIds = rooms.map(({ id }) => id).sort();
  return JSON.stringify([house.houseId ?? house.id, roomIds, personas]);
}

function comparisonMessage(before, after) {
  const changes = replayMeasures.map(([key]) => after.summary[key] - before.summary[key]);
  const improved = changes.some((change) => change < 0);
  const worsened = changes.some((change) => change > 0);
  if (improved && worsened) return "The replay measured both improvements and regressions.";
  if (improved) return "The current layout improved one or more replay measures.";
  if (worsened) return "The current layout had more issues on one or more replay measures.";
  return "No change in path failures, collisions, or congestion events.";
}

function blockedRoute(run, layout, roomNames) {
  const finding = run.findings.find(({ type }) => type === FINDING_TYPES.NO_PATH);
  if (!finding) return null;
  const start = roomNames.get(finding.fromRoomId) ?? finding.fromRoomId;
  const end = roomNames.get(finding.toRoomId) ?? finding.toRoomId;
  if (!start || !end) return `${layout} replay recorded a blocked route.`;
  return `${layout} route blocked from ${start} to ${end}.`;
}

export function createStudioReplayPanel(container, { getContext }) {
  const capture = container.querySelector("#studio-replay-capture");
  const compare = container.querySelector("#studio-replay-compare");
  const resetButton = container.querySelector("#studio-replay-reset");
  const emptyHousehold = container.querySelector("#studio-replay-empty-household");
  const status = container.querySelector("#studio-replay-status");
  const summary = container.querySelector("#studio-replay-summary");
  const metricsTable = container.querySelector("#studio-replay-results tbody");
  const findings = container.querySelector("#studio-replay-findings");
  let baseline = null;
  let activeRun = null;
  let comparedItems = null;

  function announce(message = "", isError = false) {
    status.textContent = message;
    status.toggleAttribute("data-error", isError);
  }

  function clearComparison() {
    comparedItems = null;
    summary.hidden = true;
    metricsTable.replaceChildren();
    findings.replaceChildren();
  }

  function clearBaseline(message) {
    baseline = null;
    activeRun = null;
    clearComparison();
    announce(message);
  }

  function update(context = getContext()) {
    const { house, items, personas } = context;
    container.hidden = !house;
    if (!house && baseline) clearBaseline();
    if (house && baseline && baseline.signature !== householdSignature(context)) {
      clearBaseline("The saved household or destinations changed. Capture a new baseline.");
    }
    const replayItems = activeRun?.items ?? comparedItems;
    if (replayItems && replayItems !== items) {
      activeRun = null;
      clearComparison();
      announce("The layout changed. Compare again to update the results.");
    }
    const hasSchedule = personas.some(({ schedule }) => schedule.length > 0);
    emptyHousehold.hidden = hasSchedule;
    capture.disabled = !house || !hasSchedule || Boolean(activeRun);
    compare.disabled = capture.disabled || !baseline;
    resetButton.disabled = !baseline;
  }

  function reset() {
    clearBaseline();
    update();
  }

  function showComparison({ before, after }, rooms) {
    const rows = replayMeasures.map(([key, label]) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = label;
      row.append(name);
      for (const run of [before, after]) {
        const value = document.createElement("td");
        value.textContent = String(run.summary[key]);
        row.append(value);
      }
      return row;
    });
    const roomNames = new Map(rooms.map(({ id, name }) => [id, name]));
    const beforeBlocked = blockedRoute(before, "Baseline", roomNames);
    const afterBlocked = blockedRoute(after, "Current layout", roomNames);
    const messages = [beforeBlocked, afterBlocked];
    if (beforeBlocked && after.summary.pathFailures === 0) {
      messages.push("No blocked routes were recorded in the current layout.");
    }
    const items = messages.filter(Boolean).map((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    });
    metricsTable.replaceChildren(...rows);
    findings.replaceChildren(...items);
    findings.hidden = !items.length;
    summary.hidden = false;
    announce(comparisonMessage(before, after));
  }

  capture.addEventListener("click", () => {
    const context = getContext();
    update(context);
    if (capture.disabled) return;
    try {
      baseline = {
        scene: captureStudioLayout(context.house, context.items),
        signature: householdSignature(context),
      };
      clearComparison();
      announce("Baseline captured. Change the layout, then compare.");
      update(context);
    } catch (error) {
      announce(error.message || "The baseline could not be captured.", true);
    }
  });

  compare.addEventListener("click", async () => {
    const context = getContext();
    update(context);
    if (compare.disabled) return;
    const run = { items: context.items };
    activeRun = run;
    clearComparison();
    announce("Comparing layouts…");
    update(context);
    try {
      const result = await runStudioReplay({
        beforeScene: baseline.scene,
        afterScene: captureStudioLayout(context.house, context.items),
        personas: structuredClone(context.personas),
        rooms: structuredClone(context.rooms),
      });
      const latestContext = getContext();
      update(latestContext);
      if (activeRun === run) {
        showComparison(result, latestContext.rooms);
        comparedItems = run.items;
      }
    } catch (error) {
      if (activeRun === run) announce(error.message || "The replay could not be completed.", true);
    } finally {
      if (activeRun === run) {
        activeRun = null;
        update();
      }
    }
  });
  resetButton.addEventListener("click", reset);

  return { update, reset };
}
