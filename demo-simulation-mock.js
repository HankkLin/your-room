/**
 * ISOLATED DEMO MOCK ADAPTER — DEVELOPMENT / FALLBACK ONLY.
 *
 * This module supplies clearly labeled static placeholder simulation outputs
 * while the desktop simulation engine branch (`feat/life-simulation`) is
 * developed in parallel.
 *
 * To connect the real simulation engine later, pass external engine callbacks
 * and state into `demoControls.setState(...)` (with `isMockData: false`) or
 * call `window.__livingBlueprint.connectSimulationEngine(engine)`.
 */

export const mockBeforeScores = Object.freeze({
  movement: 64,
  privacy: 72,
  noise: 55,
  visibility: 68,
  safety: 88,
});

export const mockAfterScores = Object.freeze({
  movement: 91,
  privacy: 88,
  noise: 84,
  visibility: 96,
  safety: 94,
});

export const mockFindings = Object.freeze([
  {
    id: "mock-finding-congestion",
    type: "CONGESTION",
    severity: 0.72,
    level: "warning",
    title: "Kitchen congestion",
    summary: "3 people blocked the refrigerator walkway for 86 seconds.",
    location: "Kitchen",
  },
  {
    id: "mock-finding-noise",
    type: "WFH_NOISE",
    severity: 0.65,
    level: "warning",
    title: "WFH noise conflict",
    summary: "Living-room TV exceeds the preferred workspace noise threshold.",
    location: "Living Room",
  },
  {
    id: "mock-finding-clear",
    type: "CLEAR",
    severity: 0,
    level: "success",
    title: "Bedroom route clear",
    summary: "No doorway or walkway obstruction detected along bedroom path.",
    location: "Bedroom",
  },
]);

export const mockRedesignActions = Object.freeze([
  "Moved desk away from TV noise",
  "Replaced oversized chair",
  "Cleared kitchen walkway",
]);

const SCENARIO_MOCK_PRESETS = Object.freeze({
  "morning-routine": {
    runningTime: "07:42 AM",
    completedTime: "08:30 AM",
    findings: mockFindings,
    beforeScores: mockBeforeScores,
    afterScores: mockAfterScores,
    redesignActions: mockRedesignActions,
  },
  "normal-day": {
    runningTime: "02:15 PM",
    completedTime: "10:00 PM",
    findings: [
      ...mockFindings,
      {
        id: "mock-finding-glare",
        type: "GLARE",
        severity: 0.32,
        level: "info",
        title: "Afternoon window glare note",
        summary: "Direct west-window light crosses the desk surface around 15:30.",
        location: "Living Room",
      },
    ],
    beforeScores: mockBeforeScores,
    afterScores: mockAfterScores,
    redesignActions: mockRedesignActions,
  },
  "dinner-party-8-guests": {
    runningTime: "07:55 PM",
    completedTime: "09:45 PM",
    findings: [
      {
        id: "mock-finding-party-bottleneck",
        type: "CONGESTION",
        severity: 0.86,
        level: "critical",
        title: "Severe doorway bottleneck",
        summary: "Guests queuing between Living Room and Kitchen reduced clearance to 0.42 m.",
        location: "Kitchen",
      },
      {
        id: "mock-finding-bath-queue",
        type: "PRIVACY",
        severity: 0.58,
        level: "warning",
        title: "Bathroom sightline exposure",
        summary: "Direct line-of-sight from social seating to bathroom threshold.",
        location: "Bathroom",
      },
    ],
    beforeScores: {
      movement: 49,
      privacy: 58,
      noise: 46,
      visibility: 70,
      safety: 79,
    },
    afterScores: {
      movement: 86,
      privacy: 84,
      noise: 74,
      visibility: 92,
      safety: 91,
    },
    redesignActions: [
      "Rotated lounge chair to widen kitchen threshold to 1.04 m",
      "Shifted seating group away from bathroom sightline",
      "Replaced wide coffee table with compact oval table",
    ],
  },
  "fire-emergency": {
    runningTime: "00:18 elapsed",
    completedTime: "00:34 evacuated",
    findings: [
      {
        id: "mock-finding-egress",
        type: "EVACUATION",
        severity: 0.84,
        level: "critical",
        title: " Narrow egress pinch point",
        summary: "Accent chair narrows front-entry evacuation path during simultaneous exit.",
        location: "Living Room",
      },
      {
        id: "mock-finding-bedroom-exit",
        type: "CLEAR",
        severity: 0,
        level: "success",
        title: "Bedroom exit unobstructed",
        summary: "Clear 0.96 m doorway clearance into central living space.",
        location: "Bedroom",
      },
    ],
    beforeScores: {
      movement: 61,
      privacy: 72,
      noise: 70,
      visibility: 74,
      safety: 54,
    },
    afterScores: {
      movement: 90,
      privacy: 76,
      noise: 72,
      visibility: 89,
      safety: 95,
    },
    redesignActions: [
      "Cleared front entrance approach corridor",
      "Relocated accent chair out of primary egress lane",
    ],
  },
});

export const mockSimulationResult = Object.freeze({
  status: "COMPLETE",
  scenarioId: "morning-routine",
  speed: 1,
  currentTime: "08:30 AM",
  findings: mockFindings,
  scores: mockBeforeScores,
  beforeScores: mockBeforeScores,
  afterScores: mockAfterScores,
  redesignActions: mockRedesignActions,
  isMockData: true,
});

/**
 * Create an isolated mock simulation adapter that responds to UI intents
 * (`run`, `pause`, `reset`, `setSpeed`) without implementing any spatial physics.
 */
export function createMockSimulationAdapter({
  onStateChange = () => {},
  baseDelayMs = 280,
} = {}) {
  let timer = null;
  let speed = 1;
  let activeScenarioId = "morning-routine";
  let status = "READY";

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function finishRun(scenarioId) {
    timer = null;
    status = "COMPLETE";
    const preset =
      SCENARIO_MOCK_PRESETS[scenarioId] ??
      SCENARIO_MOCK_PRESETS["morning-routine"];
    onStateChange({
      status: "COMPLETE",
      scenarioId,
      speed,
      currentTime: preset.completedTime,
      findings: preset.findings.map((f) => ({ ...f, title: f.title.trim() })),
      scores: { ...preset.beforeScores },
      beforeScores: { ...preset.beforeScores },
      afterScores: { ...preset.afterScores },
      redesignActions: [...preset.redesignActions],
      isMockData: true,
    });
  }

  return {
    isMockAdapter: true,
    run(scenarioId = activeScenarioId) {
      clearTimer();
      activeScenarioId = scenarioId;
      status = "RUNNING";
      const preset =
        SCENARIO_MOCK_PRESETS[scenarioId] ??
        SCENARIO_MOCK_PRESETS["morning-routine"];
      onStateChange({
        status: "RUNNING",
        scenarioId,
        speed,
        currentTime: preset.runningTime,
        findings: [],
        scores: null,
        beforeScores: null,
        afterScores: null,
        redesignActions: [],
        isMockData: true,
      });
      const waitMs = Math.max(40, Math.round(baseDelayMs / Math.sqrt(speed)));
      timer = setTimeout(() => finishRun(scenarioId), waitMs);
    },
    pause() {
      if (status !== "RUNNING") return;
      clearTimer();
      status = "PAUSED";
      const preset =
        SCENARIO_MOCK_PRESETS[activeScenarioId] ??
        SCENARIO_MOCK_PRESETS["morning-routine"];
      onStateChange({
        status: "PAUSED",
        scenarioId: activeScenarioId,
        speed,
        currentTime: preset.runningTime,
        isMockData: true,
      });
    },
    reset() {
      clearTimer();
      status = "READY";
      onStateChange({
        status: "READY",
        scenarioId: activeScenarioId,
        speed,
        currentTime: null,
        findings: [],
        scores: null,
        beforeScores: null,
        afterScores: null,
        redesignActions: [],
        errorMessage: null,
        isMockData: false,
      });
    },
    setSpeed(multiplier) {
      speed = Number(multiplier) || 1;
      onStateChange({ speed });
    },
    dispose() {
      clearTimer();
    },
  };
}
