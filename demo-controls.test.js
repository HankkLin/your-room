import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_SCENARIOS,
  resolveFindingLevel,
} from "./src/contracts/simulation.js";
import {
  createDemoControlsController,
  renderBeforeAfterMarkup,
  renderControlPanelMarkup,
  renderFindingsMarkup,
  renderResultsDeckMarkup,
  renderScorecardMarkup,
} from "./src/components/simulation/demo-controls.js";
import {
  createMockSimulationAdapter,
  mockAfterScores,
  mockBeforeScores,
  mockFindings,
  mockRedesignActions,
  mockSimulationResult,
} from "./demo-simulation-mock.js";

test("Test 1 — Scenario selector renders all four required demo scenarios", () => {
  const html = renderControlPanelMarkup({});
  for (const scenario of DEMO_SCENARIOS) {
    assert(
      html.includes(scenario.name),
      `Expected scenario "${scenario.name}" to render`,
    );
    assert(html.includes(`value="${scenario.id}"`));
  }
  assert.deepEqual(
    DEMO_SCENARIOS.map((s) => s.name),
    [
      "Morning Routine",
      "Normal Day",
      "Dinner Party — 8 Guests",
      "Fire Emergency",
    ],
  );
});

test("Test 2 — Run, Pause, and Reset actions emit external callbacks without embedding simulation logic", () => {
  const events = [];
  const controller = createDemoControlsController({
    onRunSimulation: (id) => events.push(["run", id]),
    onPauseSimulation: () => events.push(["pause"]),
    onResetSimulation: () => events.push(["reset"]),
  });

  controller.selectScenario("fire-emergency");
  controller.triggerRun();
  assert.deepEqual(events, [["run", "fire-emergency"]]);

  // Pause is ignored when not RUNNING
  controller.triggerPause();
  assert.equal(events.length, 1);

  // When external engine sets RUNNING, Pause fires and duplicate Run is ignored
  controller.setState({ status: "RUNNING", currentTime: "07:42 AM" });
  controller.triggerRun();
  assert.equal(events.length, 1);
  controller.triggerPause();
  assert.deepEqual(events.at(-1), ["pause"]);

  controller.triggerReset();
  assert.deepEqual(events.at(-1), ["reset"]);
});

test("Test 3 — Speed selection updates state and emits multiplier callback", () => {
  const speeds = [];
  const controller = createDemoControlsController({
    onSimulationSpeedChange: (mult) => speeds.push(mult),
  });

  for (const mult of [5, 20, 1]) {
    controller.selectSpeed(mult);
    assert.equal(controller.getState().speed, mult);
    const html = renderControlPanelMarkup(controller.getState());
    assert(html.includes(`data-sim-speed="${mult}" aria-pressed="true"`));
  }
  assert.deepEqual(speeds, [5, 20, 1]);
});

test("Test 4 — Findings render from provided data across critical, warning, info, and success severities", () => {
  assert.equal(resolveFindingLevel({ severity: 0.9 }), "critical");
  assert.equal(resolveFindingLevel({ severity: 0.6 }), "warning");
  assert.equal(resolveFindingLevel({ severity: 0.2 }), "info");
  assert.equal(resolveFindingLevel({ type: "CLEAR", severity: 0 }), "success");

  const html = renderFindingsMarkup({
    status: "COMPLETE",
    findings: [
      ...mockFindings,
      {
        type: "EVACUATION",
        severity: 0.92,
        title: "No evacuation path",
        summary: "Primary exit blocked.",
        location: "Hallway",
      },
      {
        type: "DAYLIGHT",
        severity: 0.2,
        title: "Soft morning light",
        summary: "Balanced east illumination.",
        location: "Kitchen",
      },
    ],
  });

  assert(html.includes("Kitchen congestion"));
  assert(html.includes("WFH noise conflict"));
  assert(html.includes("Bedroom route clear"));
  assert(html.includes("No evacuation path"));
  assert(html.includes('data-level="warning"'));
  assert(html.includes('data-level="success"'));
  assert(html.includes('data-level="critical"'));
  assert(html.includes('data-level="info"'));
});

test("Test 5 — Scorecard, Before / After comparison, and Redesign actions render exact external numbers", () => {
  const scorecardHtml = renderScorecardMarkup(mockBeforeScores);
  assert(scorecardHtml.includes("Movement"));
  assert(scorecardHtml.includes(">64<"));
  assert(scorecardHtml.includes(">88<"));

  const compareHtml = renderBeforeAfterMarkup(mockBeforeScores, mockAfterScores);
  assert(compareHtml.includes(">64<"));
  assert(compareHtml.includes(">91<"));
  assert(compareHtml.includes("+27"));
  assert(compareHtml.includes(">55<"));
  assert(compareHtml.includes(">84<"));
  assert(compareHtml.includes("+29"));

  const deckHtml = renderResultsDeckMarkup(mockSimulationResult);
  for (const action of mockRedesignActions) {
    assert(deckHtml.includes(action));
  }
});

test("Test 6 — Empty findings, empty before/after, and persona quick view states render cleanly", () => {
  const emptyFindings = renderFindingsMarkup({ status: "READY", findings: [] });
  assert(emptyFindings.includes("No findings yet"));

  const emptyCompare = renderBeforeAfterMarkup(null, null);
  assert(emptyCompare.includes("Run a simulation to compare"));

  const withPersonas = renderControlPanelMarkup(
    {},
    {
      personas: [
        { name: "Kevin", preferences: ["WFH", "Quiet preferred"] },
        { name: "Alice", preferences: ["Early schedule", "Likes daylight"] },
      ],
    },
  );
  assert(withPersonas.includes("Kevin"));
  assert(withPersonas.includes("WFH • Quiet preferred"));
  assert(withPersonas.includes("Alice"));
  assert(withPersonas.includes("Early schedule • Likes daylight"));
});

test("Test 7 — Running/loading, Paused, Complete, and Error status states render accurately", async () => {
  const runningHtml = renderControlPanelMarkup({
    status: "RUNNING",
    currentTime: "07:42 AM",
  });
  assert(runningHtml.includes("Running…"));
  assert(runningHtml.includes("07:42 AM"));
  assert(runningHtml.includes('id="sim-run-btn" disabled'));
  assert(!runningHtml.includes('id="sim-pause-btn" disabled'));

  const loadingFindings = renderFindingsMarkup({
    status: "RUNNING",
    findings: [],
  });
  assert(loadingFindings.includes("Running scenario simulation"));

  const errorHtml = renderControlPanelMarkup({
    status: "ERROR",
    errorMessage: "Engine disconnected",
  });
  assert(errorHtml.includes("Engine disconnected"));
  assert(errorHtml.includes("Run Again"));

  // Verify isolated mock adapter transitions READY -> RUNNING -> COMPLETE
  const transitions = [];
  await new Promise((resolve) => {
    const adapter = createMockSimulationAdapter({
      baseDelayMs: 45,
      onStateChange(patch) {
        transitions.push(patch.status);
        if (patch.status === "COMPLETE") resolve();
      },
    });
    adapter.run("morning-routine");
  });
  assert.deepEqual(transitions, ["RUNNING", "COMPLETE"]);
});
