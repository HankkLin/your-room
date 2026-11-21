import {
  DEMO_SCENARIOS,
  SCORE_CATEGORIES,
  SIMULATION_SPEEDS,
  normalizeSimulationViewState,
} from "../../contracts/simulation.js";

const escapeHtml = (value) =>
  String(value ?? "").replace(
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

const LEVEL_GLYPHS = Object.freeze({
  critical: "⛔",
  warning: "⚠",
  success: "✓",
  info: "ℹ",
});

const STATUS_LABELS = Object.freeze({
  READY: "Ready",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETE: "Simulation complete",
  ERROR: "Simulation error",
});

function summarizePersona(persona) {
  if (Array.isArray(persona?.preferences) && persona.preferences.length > 0) {
    return persona.preferences.slice(0, 2).join(" • ");
  }
  const traits = [];
  if (Number(persona?.needs?.quiet) >= 0.75) traits.push("Quiet preferred");
  if (Number(persona?.needs?.privacy) >= 0.75) traits.push("High privacy");
  if (Number(persona?.needs?.daylight) >= 0.7) traits.push("Likes daylight");
  if (Number(persona?.needs?.social) >= 0.7) traits.push("Social host");
  return traits.join(" • ") || "Household member";
}

export function renderPersonaQuickViewMarkup(personas = []) {
  if (!Array.isArray(personas) || personas.length === 0) {
    return `<div class="twin-personas" id="sim-persona-summary"><span class="section-label">Household</span><p class="muted" style="margin-top:5px">No household personas set yet. Use step 2 (Household) to add members.</p></div>`;
  }
  const items = personas
    .map(
      (p) =>
        `<div class="twin-persona-item"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(summarizePersona(p))}</span></div>`,
    )
    .join("");
  return `<div class="twin-personas" id="sim-persona-summary"><span class="section-label">Household</span><div class="twin-persona-list">${items}</div></div>`;
}

export function renderControlPanelMarkup(
  viewState,
  { scenarios = DEMO_SCENARIOS, personas = [] } = {},
) {
  const state = normalizeSimulationViewState(viewState);
  const activeScenario =
    scenarios.find((s) => s.id === state.scenarioId) ?? scenarios[0];
  const isRunning = state.status === "RUNNING";
  const isPaused = state.status === "PAUSED";
  const hasOutput =
    state.status !== "READY" ||
    state.findings.length > 0 ||
    Boolean(state.scores) ||
    Boolean(state.beforeScores);

  const runLabel = isRunning
    ? "Running…"
    : isPaused
      ? "Resume"
      : state.status === "COMPLETE" || state.status === "ERROR"
        ? "Run Again"
        : "Run Simulation";

  const statusText =
    state.status === "ERROR" && state.errorMessage
      ? state.errorMessage
      : STATUS_LABELS[state.status] || "Ready";

  return `<div class="twin-control-card" aria-label="Household Digital Twin controls">
    <div class="twin-card-head">
      <div>
        <p class="eyebrow">Household Digital Twin</p>
        <h2>Simulate life</h2>
      </div>
      ${state.isMockData ? '<span class="twin-mock-badge" title="Placeholder mock output while simulation engine is external">Demo mock</span>' : ""}
    </div>
    <label class="twin-field" for="sim-scenario">
      <span class="section-label">Scenario</span>
      <select id="sim-scenario" aria-label="Simulation scenario" ${isRunning ? "disabled" : ""}>
        ${scenarios
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}"${s.id === state.scenarioId ? " selected" : ""}>${escapeHtml(s.name)}</option>`,
          )
          .join("")}
      </select>
    </label>
    <p class="twin-scenario-desc" id="sim-scenario-desc">${escapeHtml(activeScenario?.description || "")}</p>
    <div class="twin-actions">
      <button type="button" class="primary" id="sim-run-btn" ${isRunning ? "disabled" : ""}>${escapeHtml(runLabel)}</button>
      <button type="button" class="secondary" id="sim-pause-btn" ${isRunning ? "" : "disabled"}>Pause</button>
      <button type="button" class="secondary" id="sim-reset-btn" ${hasOutput ? "" : "disabled"}>Reset</button>
    </div>
    <div class="twin-speed-bar">
      <span class="section-label">Speed</span>
      <div class="twin-speed-group" role="group" aria-label="Simulation speed">
        ${SIMULATION_SPEEDS.map(
          (mult) =>
            `<button type="button" data-sim-speed="${mult}" aria-pressed="${state.speed === mult}">${mult}×</button>`,
        ).join("")}
      </div>
    </div>
    <div class="twin-status-row" id="sim-status" data-status="${escapeHtml(state.status)}" role="status" aria-live="polite">
      <span class="twin-status-indicator"><span class="twin-dot" aria-hidden="true"></span><span>${escapeHtml(statusText)}</span></span>
      <span class="twin-clock" id="sim-clock">${state.currentTime ? escapeHtml(state.currentTime) : ""}</span>
    </div>
    ${renderPersonaQuickViewMarkup(personas)}
  </div>`;
}

export function renderFindingsMarkup(viewState) {
  const state = normalizeSimulationViewState(viewState);
  if (state.status === "RUNNING" && state.findings.length === 0) {
    return `<div class="twin-empty" id="sim-findings-empty">Running scenario simulation… evaluating walkways, sightlines, and room schedules.</div>`;
  }
  if (state.status === "ERROR") {
    return `<div class="twin-finding" data-level="critical"><span class="twin-finding-icon" aria-hidden="true">⛔</span><div><strong>Simulation failed</strong><p>${escapeHtml(state.errorMessage || "Unable to complete simulation run.")}</p></div></div>`;
  }
  if (state.findings.length === 0) {
    return `<div class="twin-empty" id="sim-findings-empty">No findings yet. Choose a scenario and click <strong>Run Simulation</strong> to inspect spatial issues.</div>`;
  }
  return `<div class="twin-findings-list" id="sim-findings-list">${state.findings
    .map((finding) => {
      const glyph = LEVEL_GLYPHS[finding.level] || LEVEL_GLYPHS.info;
      return `<article class="twin-finding" data-level="${escapeHtml(finding.level)}" data-finding-type="${escapeHtml(finding.type)}">
        <span class="twin-finding-icon" aria-label="${escapeHtml(finding.level)}">${glyph}</span>
        <div>
          <div class="twin-finding-head">
            <strong>${escapeHtml(finding.title)}</strong>
            ${finding.location ? `<span class="twin-finding-loc">${escapeHtml(finding.location)}</span>` : ""}
          </div>
          ${finding.summary ? `<p>${escapeHtml(finding.summary)}</p>` : ""}
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

export function renderScorecardMarkup(scores) {
  return `<div class="twin-scorecard" id="sim-scorecard" aria-label="Household scorecard">
    <span class="section-label">Household scorecard</span>
    ${SCORE_CATEGORIES.map(({ key, label }) => {
      const value = scores?.[key];
      const hasVal = typeof value === "number" && Number.isFinite(value);
      const pct = hasVal ? Math.max(0, Math.min(100, value)) : 0;
      return `<div class="twin-score-row" data-score-category="${key}">
        <span>${escapeHtml(label)}</span>
        <div class="twin-score-track" aria-hidden="true"><div class="twin-score-fill" style="width:${pct}%"></div></div>
        <span class="twin-score-value">${hasVal ? value : "—"}</span>
      </div>`;
    }).join("")}
  </div>`;
}

export function renderBeforeAfterMarkup(beforeScores, afterScores) {
  if (!beforeScores && !afterScores) {
    return `<div class="twin-empty" id="sim-before-after-empty">Run a simulation to compare baseline layout metrics against a redesigned layout.</div>`;
  }
  return `<div class="twin-comparison-table" id="sim-before-after" aria-label="Before and after layout scores">
    <div class="twin-compare-header">
      <span>Metric</span>
      <span style="text-align:right">Before</span>
      <span></span>
      <span style="text-align:right">After</span>
      <span style="text-align:right">Delta</span>
    </div>
    ${SCORE_CATEGORIES.map(({ key, label }) => {
      const before = beforeScores?.[key];
      const after = afterScores?.[key];
      const hasBefore = typeof before === "number" && Number.isFinite(before);
      const hasAfter = typeof after === "number" && Number.isFinite(after);
      const delta = hasBefore && hasAfter ? after - before : null;
      const deltaText =
        delta === null ? "—" : delta > 0 ? `+${delta}` : String(delta);
      return `<div class="twin-compare-row" data-compare-category="${key}">
        <span>${escapeHtml(label)}</span>
        <span class="twin-compare-before">${hasBefore ? before : "—"}</span>
        <span class="twin-compare-arrow" aria-hidden="true">→</span>
        <span class="twin-compare-after">${hasAfter ? after : "—"}</span>
        <span class="twin-compare-delta"${delta !== null && delta < 0 ? ' data-negative="true"' : ""}>${deltaText}</span>
      </div>`;
    }).join("")}
  </div>`;
}

export function renderRedesignMarkup(redesignActions = []) {
  if (!Array.isArray(redesignActions) || redesignActions.length === 0) {
    return `<div class="twin-redesign-box" id="sim-redesign-panel">
      <span class="section-label">Gemini redesign</span>
      <p class="muted" style="margin-top:6px">Proposed ScenePatch improvements will appear here after simulation analysis.</p>
    </div>`;
  }
  return `<div class="twin-redesign-box" id="sim-redesign-panel">
    <span class="section-label">Gemini redesign</span>
    <ul class="twin-redesign-list" id="sim-redesign-list">
      ${redesignActions
        .map(
          (action) =>
            `<li><span class="twin-redesign-check" aria-hidden="true">✓</span><span>${escapeHtml(action)}</span></li>`,
        )
        .join("")}
    </ul>
  </div>`;
}

export function renderResultsDeckMarkup(viewState) {
  const state = normalizeSimulationViewState(viewState);
  return `<div class="twin-results-deck">
    <section class="twin-deck-card" id="sim-findings-panel" aria-labelledby="sim-findings-heading">
      <div class="twin-deck-head">
        <div>
          <p class="eyebrow">Spatial validation</p>
          <h3 id="sim-findings-heading">Findings &amp; scorecard</h3>
        </div>
        ${state.isMockData ? '<span class="twin-mock-badge">Mock preview</span>' : ""}
      </div>
      ${renderFindingsMarkup(state)}
      ${renderScorecardMarkup(state.scores)}
    </section>
    <section class="twin-deck-card" id="sim-comparison-panel" aria-labelledby="sim-compare-heading">
      <div class="twin-deck-head">
        <div>
          <p class="eyebrow">Measurable impact</p>
          <h3 id="sim-compare-heading">Before / After redesign</h3>
        </div>
        ${state.isMockData && state.afterScores ? '<span class="twin-mock-badge">Mock preview</span>' : ""}
      </div>
      ${renderBeforeAfterMarkup(state.beforeScores, state.afterScores)}
      ${renderRedesignMarkup(state.redesignActions)}
    </section>
  </div>`;
}

/**
 * Headless controller for Demo Controls state & intent callbacks (unit-testable in Node).
 */
export function createDemoControlsController({
  scenarios = DEMO_SCENARIOS,
  initialState = {},
  onRunSimulation = () => {},
  onPauseSimulation = () => {},
  onResetSimulation = () => {},
  onSimulationSpeedChange = () => {},
  onScenarioChange = () => {},
  onChange = () => {},
} = {}) {
  let state = normalizeSimulationViewState(initialState);
  let personas = [];

  function emit() {
    onChange(state, personas);
  }

  return {
    getScenarios: () => scenarios,
    getState: () => ({ ...state }),
    getPersonas: () => [...personas],
    setState(patch = {}) {
      state = normalizeSimulationViewState({ ...state, ...patch });
      emit();
      return state;
    },
    setPersonas(nextPersonas = []) {
      personas = Array.isArray(nextPersonas) ? [...nextPersonas] : [];
      emit();
    },
    selectScenario(scenarioId) {
      if (!scenarios.some((s) => s.id === scenarioId)) return state;
      state = normalizeSimulationViewState({ ...state, scenarioId });
      onScenarioChange(state.scenarioId);
      emit();
      return state;
    },
    triggerRun() {
      if (state.status === "RUNNING") return;
      onRunSimulation(state.scenarioId);
    },
    triggerPause() {
      if (state.status !== "RUNNING") return;
      onPauseSimulation();
    },
    triggerReset() {
      onResetSimulation();
    },
    selectSpeed(multiplier) {
      const numeric = Number(multiplier);
      if (!SIMULATION_SPEEDS.includes(numeric)) return state;
      state = normalizeSimulationViewState({ ...state, speed: numeric });
      onSimulationSpeedChange(state.speed);
      emit();
      return state;
    },
  };
}

/**
 * Mount the Demo Controls panel and Findings / Before-After results deck into the DOM.
 */
export function mountDemoControls({
  controlHost,
  resultsHost,
  scenarios = DEMO_SCENARIOS,
  initialState = {},
  onRunSimulation = () => {},
  onPauseSimulation = () => {},
  onResetSimulation = () => {},
  onSimulationSpeedChange = () => {},
  onScenarioChange = () => {},
} = {}) {
  let visible = false;

  function renderDOM(state, personas) {
    if (controlHost) {
      controlHost.hidden = !visible;
      if (visible) {
        controlHost.innerHTML = renderControlPanelMarkup(state, {
          scenarios,
          personas,
        });
      }
    }
    if (resultsHost) {
      resultsHost.hidden = !visible;
      if (visible) {
        resultsHost.innerHTML = renderResultsDeckMarkup(state);
      }
    }
  }

  const controller = createDemoControlsController({
    scenarios,
    initialState,
    onRunSimulation,
    onPauseSimulation,
    onResetSimulation,
    onSimulationSpeedChange,
    onScenarioChange,
    onChange: renderDOM,
  });

  function handleControlClick(event) {
    const speedBtn = event.target.closest("[data-sim-speed]");
    if (speedBtn) {
      controller.selectSpeed(Number(speedBtn.dataset.simSpeed));
      return;
    }
    const btn = event.target.closest("button");
    if (!btn) return;
    if (btn.id === "sim-run-btn") controller.triggerRun();
    else if (btn.id === "sim-pause-btn") controller.triggerPause();
    else if (btn.id === "sim-reset-btn") controller.triggerReset();
  }

  function handleControlChange(event) {
    if (event.target?.id === "sim-scenario") {
      controller.selectScenario(event.target.value);
    }
  }

  controlHost?.addEventListener("click", handleControlClick);
  controlHost?.addEventListener("change", handleControlChange);
  renderDOM(controller.getState(), controller.getPersonas());

  return {
    ...controller,
    setVisible(nextVisible) {
      const bool = Boolean(nextVisible);
      if (visible === bool) return;
      visible = bool;
      renderDOM(controller.getState(), controller.getPersonas());
    },
    isVisible: () => visible,
    destroy() {
      controlHost?.removeEventListener("click", handleControlClick);
      controlHost?.removeEventListener("change", handleControlChange);
    },
  };
}
