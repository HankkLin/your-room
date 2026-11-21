import {
  buildReplaySuggestionInput, previewReplaySuggestion, requestReplaySuggestion,
} from "../../agents/replay-suggestion.js";
import { prepareHouseholdReplay } from "../../contracts/persona.js";
import { FINDING_TYPES } from "../../contracts/simulation.js";
import { captureStudioLayout, simulateStudioLayout } from "../../simulation/studio-replay.js";

import { mountEnvironmentPanel } from "../../environment/environment-panel.js";
import { formatLocalTime } from "../../environment/environment-context.js";

const replayMeasures = [
  ["pathFailures", "Path failures"],
  ["collisions", "Collisions"],
  ["congestionEvents", "Congestion events"],
];

function replaySignature({ house, personas, rooms }) {
  if (!house) return null;
  const { houseId, id, walls, doors, windows, fixtures, ceilingHeight } = house;
  return JSON.stringify([houseId ?? id, house.rooms, walls, doors, windows, fixtures, ceilingHeight, rooms, personas]);
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

const firstBlocked = (run) => run.findings.find(({ type }) => type === FINDING_TYPES.NO_PATH);
const clockTime = (seconds) => {
  const minute = Math.floor(seconds / 60);
  return String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
};

function blockedRoute(finding, layout, roomNames) {
  if (!finding) return null;
  const start = roomNames.get(finding.fromRoomId) ?? finding.fromRoomId;
  const end = roomNames.get(finding.toRoomId) ?? finding.toRoomId;
  const route = start && end
    ? layout + " route blocked from " + start + " to " + end + "."
    : layout + " replay recorded a blocked route.";
  return route + " Trip time " + clockTime(finding.evidence.timestampSeconds) + ".";
}

function completedTrip(run, finding) {
  return run.routes.some((route) =>
    route.agentId === finding.agentId && route.activity === finding.activity &&
    route.fromRoomId === finding.fromRoomId && route.toRoomId === finding.toRoomId &&
    route.startTimestamp === finding.evidence.timestampSeconds && Number.isFinite(route.endTimestamp));
}

function describePosition(item, roomNames) {
  const room = roomNames.get(item.roomId) ?? item.roomId ?? "Room";
  return room + " (" + item.position.map((value) => Number(value.toFixed(2))).join(", ") + " m)";
}

export function createStudioReplayPanel(container, { getContext, commitItems, commitEnvironment }) {
  const environment = mountEnvironmentPanel(container.querySelector("#studio-environment"), commitEnvironment);
  const capture = container.querySelector("#studio-replay-capture");
  const compare = container.querySelector("#studio-replay-compare");
  const resetButton = container.querySelector("#studio-replay-reset");
  const emptyHousehold = container.querySelector("#studio-replay-empty-household");
  const status = container.querySelector("#studio-replay-status");
  const summary = container.querySelector("#studio-replay-summary");
  const afterHeading = container.querySelector("#studio-replay-results thead th:last-child");
  const metricsTable = container.querySelector("#studio-replay-results tbody");
  const findings = container.querySelector("#studio-replay-findings");
  const suggest = container.querySelector("#studio-replay-suggest");
  const review = container.querySelector("#studio-replay-proposal");
  const explanation = container.querySelector("#studio-replay-explanation");
  const proposedMove = container.querySelector("#studio-replay-move");
  const approve = container.querySelector("#studio-replay-approve");
  const dismiss = container.querySelector("#studio-replay-dismiss");

  let baseline = null;
  let activeRun = null;
  let comparison = null;
  let pending = null;
  let proposal = null;

  function announce(message = "", isError = false) {
    status.textContent = message;
    status.toggleAttribute("data-error", isError);
  }

  function clearSuggestion() {
    pending?.abort();
    pending = null;
    proposal = null;
    review.hidden = true;
  }

  function renderResults(rooms) {
    const before = baseline?.result;
    const after = comparison?.result;
    summary.hidden = !before;
    afterHeading.hidden = !after;
    metricsTable.replaceChildren();
    findings.replaceChildren();
    if (!before) return;

    for (const [key, label] of replayMeasures) {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = label;
      row.append(name);
      for (const run of after ? [before, after] : [before]) {
        const value = document.createElement("td");
        value.textContent = String(run.summary[key]);
        row.append(value);
      }
      metricsTable.append(row);
    }

    const roomNames = new Map(rooms.map(({ id, name }) => [id, name]));
    const messages = [blockedRoute(baseline.finding, "Baseline", roomNames)];
    if (before.environment) {
      const sharedTime = formatLocalTime(before.environment);
      messages.push((after ? "Both layouts used " : "Baseline conditions used ") + before.environment.location.label + " · " + sharedTime + ".");
    }
    if (after) {
      messages.push(blockedRoute(firstBlocked(after), "Current layout", roomNames));
      if (baseline.finding && after.summary.pathFailures === 0) {
        messages.push("No blocked routes were recorded in the current layout.");
      }
      if (comparison.selectedFinding) {
        messages.push(completedTrip(after, comparison.selectedFinding)
          ? "The replay recorded the selected trip arriving at its destination."
          : "The replay did not record the selected trip arriving at its destination.");
      }
    }
    for (const message of messages.filter(Boolean)) {
      const item = document.createElement("li");
      item.textContent = message;
      findings.append(item);
    }
    findings.hidden = !findings.childElementCount;
  }

  function clearBaseline(context, message) {
    baseline = null;
    activeRun = null;
    comparison = null;
    clearSuggestion();
    renderResults(context.rooms);
    announce(message);
  }

  function update(context = getContext()) {
    const { house, items, personas } = context;
    environment.show(house?.environment?.snapshot ?? null);
    const signature = replaySignature(context);
    container.hidden = !house;
    if (baseline && baseline.signature !== signature) {
      clearBaseline(context, house ? "The saved household or floorplan changed. Capture a new baseline." : "");
    }
    if (activeRun && activeRun.items !== items) {
      activeRun = null;
      if (!baseline?.result) clearBaseline(context, "The layout changed. Capture a new baseline.");
      else announce("The layout changed. Compare again to update the results.");
    }
    if (comparison && comparison.items !== items) {
      comparison = null;
      renderResults(context.rooms);
      announce("The layout changed. Compare again to update the results.");
    }
    if ((pending || proposal) && baseline?.items !== items) {
      clearSuggestion();
      announce("The layout changed. Capture a new baseline to get a new suggestion.");
    }

    const hasSchedule = personas.some(({ schedule }) => schedule.length > 0);
    emptyHousehold.hidden = hasSchedule;
    capture.disabled = !house || !hasSchedule || Boolean(activeRun);
    compare.disabled = capture.disabled || !baseline?.result;
    resetButton.disabled = !baseline;
    suggest.hidden = !baseline?.finding || baseline.items !== items;
    suggest.disabled = Boolean(pending || proposal || activeRun);
  }

  function reset() {
    environment.reset();
    clearBaseline(getContext());
    update();
  }

  capture.addEventListener("click", async () => {
    const context = getContext();
    update(context);
    if (capture.disabled) return;
    clearBaseline(context);
    const run = { items: context.items };
    activeRun = run;
    try {
      const household = prepareHouseholdReplay(context.personas, context.rooms);
      const scene = captureStudioLayout(context.house, context.items);
      baseline = { items: context.items, signature: replaySignature(context), household, environment: scene.environment?.snapshot ?? null };
      announce("Running baseline…");
      update(context);
      const result = await simulateStudioLayout(scene, household, baseline.environment);
      const latest = getContext();
      update(latest);
      if (activeRun !== run) return;
      baseline.result = result;
      baseline.finding = firstBlocked(result);
      renderResults(latest.rooms);
      announce("Baseline captured.");
    } catch (error) {
      if (activeRun === run) {
        clearBaseline(getContext());
        announce(error.message || "The baseline could not be captured.", true);
      }
    } finally {
      if (activeRun === run) activeRun = null;
      update();
    }
  });

  async function compareCurrent(context, selectedFinding) {
    const run = { items: context.items };
    activeRun = run;
    comparison = null;
    clearSuggestion();
    renderResults(context.rooms);
    announce("Comparing layouts…");
    update(context);
    try {
      const scene = captureStudioLayout(context.house, context.items);
      const result = await simulateStudioLayout(scene, baseline.household, baseline.environment);
      const latest = getContext();
      update(latest);
      if (activeRun === run) {
        comparison = { ...run, result, selectedFinding };
        renderResults(latest.rooms);
        announce(comparisonMessage(baseline.result, result));
      }
    } catch (error) {
      if (activeRun === run) announce(error.message || "The replay could not be completed.", true);
    } finally {
      if (activeRun === run) activeRun = null;
      update();
    }
  }

  compare.addEventListener("click", () => {
    const context = getContext();
    update(context);
    if (!compare.disabled) void compareCurrent(context);
  });

  suggest.addEventListener("click", async () => {
    const context = getContext();
    update(context);
    if (suggest.hidden || suggest.disabled) return;
    const request = new AbortController();
    pending = request;
    announce("Asking Gemini for a move…");
    update(context);
    try {
      const input = buildReplaySuggestionInput(baseline.finding, context.house, context.items);
      const suggested = await requestReplaySuggestion(input, request.signal);
      const latest = getContext();
      update(latest);
      if (pending !== request) return;

      const { before, after } = previewReplaySuggestion(suggested, latest.house, latest.items);
      const roomNames = new Map(latest.rooms.map(({ id, name }) => [id, name]));
      explanation.textContent = suggested.explanation;
      proposedMove.textContent = (before.name || before.kind) + " · " +
        describePosition(before, roomNames) + " → " + describePosition(after, roomNames);
      proposal = suggested;
      review.hidden = false;
      announce("Review the proposed move before approving.");
    } catch (error) {
      if (pending === request) announce(error.message || "Gemini could not suggest a move. Try again.", true);
    } finally {
      if (pending === request) pending = null;
      update();
    }
  });

  approve.addEventListener("click", () => {
    const context = getContext();
    update(context);
    if (!proposal || activeRun) return;
    try {
      const { items } = previewReplaySuggestion(proposal, context.house, context.items);
      const finding = baseline.finding;
      clearSuggestion();
      commitItems(items);
      void compareCurrent(getContext(), finding);
    } catch (error) {
      clearSuggestion();
      announce(error.message || "The proposed move could not be applied.", true);
      update();
    }
  });
  dismiss.addEventListener("click", () => {
    clearSuggestion();
    announce();
    update();
  });
  resetButton.addEventListener("click", reset);

  return { update, reset };
}
