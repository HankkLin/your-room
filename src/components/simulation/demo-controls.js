import {
  DEMO_SCENARIOS,
  SCORE_CATEGORIES,
  SIMULATION_SPEEDS,
  normalizeSimulationViewState,
} from "../../contracts/simulation.js";
import { formatFindingEvidenceChips } from "../avatar/simulation-scene-layer.js";

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

  const scrubberMarkup = state.hasTimeline
    ? `<div class="twin-scrubber-bar" id="sim-timeline-wrap">
        <label class="twin-scrubber-label" for="sim-scrubber">
          <span class="section-label">Timeline</span>
          <span class="twin-route-toggle-wrap">
            <input type="checkbox" id="sim-toggle-routes" ${state.showAllRoutes ? "checked" : ""} />
            <span>Show all paths</span>
          </span>
        </label>
        <input
          type="range"
          id="sim-scrubber"
          aria-label="Simulation timeline scrubber"
          min="${state.startSecond}"
          max="${state.endSecond}"
          step="1"
          value="${Math.round(state.currentSecond)}"
        />
      </div>`
    : "";

  const redesignButtonMarkup =
    state.canRedesign || state.redesignPending
      ? `<div class="twin-redesign-cta">
          <button type="button" class="primary twin-propose-btn" id="sim-propose-redesign-btn" ${state.redesignPending || isRunning ? "disabled" : ""}>
            ${state.redesignPending ? "Gemini is redesigning…" : "Propose Gemini Redesign"}
          </button>
        </div>`
      : "";

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
      <select id="sim-scenario" aria-label="Simulation scenario" ${isRunning || state.redesignPending ? "disabled" : ""}>
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
      <button type="button" class="primary" id="sim-run-btn" ${isRunning || state.redesignPending ? "disabled" : ""}>${escapeHtml(runLabel)}</button>
      <button type="button" class="secondary" id="sim-pause-btn" ${isRunning ? "" : "disabled"}>Pause</button>
      <button type="button" class="secondary" id="sim-reset-btn" ${hasOutput && !state.redesignPending ? "" : "disabled"}>Reset</button>
    </div>
    ${redesignButtonMarkup}
    <div class="twin-speed-bar">
      <span class="section-label">Speed</span>
      <div class="twin-speed-group" role="group" aria-label="Simulation speed">
        ${SIMULATION_SPEEDS.map(
          (mult) =>
            `<button type="button" data-sim-speed="${mult}" aria-pressed="${state.speed === mult}">${mult}×</button>`,
        ).join("")}
      </div>
    </div>
    ${scrubberMarkup}
    <div class="twin-status-row" id="sim-status" data-status="${escapeHtml(state.status)}" role="status" aria-live="polite">
      <span class="twin-status-indicator"><span class="twin-dot" aria-hidden="true"></span><span>${escapeHtml(statusText)}</span></span>
      <span class="twin-clock" id="sim-clock">${state.currentTime ? escapeHtml(state.currentTime) : ""}</span>
    </div>
    ${renderPersonaQuickViewMarkup(personas)}
  </div>`;
}

function householdImpact(finding, personas) {
  const evidence = finding.evidence || {};
  const person = personas.find(({ id }) => id === finding.agentId);
  if (finding.type === "NOISE_CONFLICT" && person && evidence.workerAgentId === person.id && evidence.overlapMinutes > 0) {
    return `${person.name}’s quiet work overlaps a modeled noise source for ${evidence.overlapMinutes} minutes.`;
  }
  if (finding.type === "NO_PATH" && person && finding.toRoomId && evidence.reason) {
    return `${person.name} could not reach ${finding.toRoomId.replace(/[-_]+/g, " ")} during the simulated routine.`;
  }
  if (finding.type === "CONGESTION" && Array.isArray(evidence.agentIds) && evidence.durationSeconds > 0) {
    const affected = personas.filter(({ id }) => evidence.agentIds.includes(id)).map(({ name }) => name);
    if (affected.length) {
      const names = new Intl.ListFormat("en", { type: "conjunction" }).format(affected);
      return `${names} encountered congestion during a ${evidence.durationSeconds}-second episode.`;
    }
  }
  if (finding.type === "NO_EVACUATION_PATH" && person && evidence.reason) {
    return `${person.name} could not reach an exterior exit in the simulated evacuation.`;
  }
  return "";
}

export function renderFindingsMarkup(viewState, personas = []) {
  const state = normalizeSimulationViewState(viewState);
  if (state.status === "RUNNING" && state.findings.length === 0) {
    return `<div class="twin-empty" id="sim-findings-empty">Running scenario simulation… evaluating walkways, sightlines, and room schedules.</div>`;
  }
  if (state.status === "ERROR") {
    return `<div class="twin-finding" data-level="critical"><span class="twin-finding-icon" aria-hidden="true">⛔</span><div><strong>Simulation failed</strong><p>${escapeHtml(state.errorMessage || "Unable to complete simulation run.")}</p></div></div>`;
  }
  if (state.findings.length === 0) {
    if (state.status === "COMPLETE") {
      return `<div class="twin-finding" id="sim-findings-clear" data-level="success"><span class="twin-finding-icon" aria-hidden="true">✓</span><div><strong>All measured spatial checks clear</strong><p>No congestion, blocked paths, sightline, noise, or evacuation bottlenecks detected in this scenario.</p></div></div>`;
    }
    return `<div class="twin-empty" id="sim-findings-empty">No findings yet. Choose a scenario and click <strong>Run Simulation</strong> to inspect spatial issues.</div>`;
  }
  return `<div class="twin-findings-list" id="sim-findings-list">${state.findings
    .map((finding) => {
      const glyph = LEVEL_GLYPHS[finding.level] || LEVEL_GLYPHS.info;
      const isSelected = state.selectedFindingId === finding.id;
      const chips = formatFindingEvidenceChips(finding);
      const impact = state.isMockData ? "" : householdImpact(finding, personas);
      const chipsMarkup =
        chips.length > 0
          ? `<div class="twin-evidence-chips">${chips
              .map((c) => `<span class="twin-evidence-chip">${escapeHtml(c)}</span>`)
              .join("")}</div>`
          : "";
      return `<article class="twin-finding twin-finding-interactive" tabindex="0" role="button" aria-pressed="${isSelected}" data-finding-id="${escapeHtml(finding.id)}" data-level="${escapeHtml(finding.level)}" data-finding-type="${escapeHtml(finding.type)}">
        <span class="twin-finding-icon" aria-label="${escapeHtml(finding.level)}">${glyph}</span>
        <div>
          <div class="twin-finding-head">
            <strong>${escapeHtml(finding.title)}</strong>
            ${finding.location ? `<span class="twin-finding-loc">${escapeHtml(finding.location)}</span>` : ""}
          </div>
          ${finding.summary ? `<p>${escapeHtml(finding.summary)}</p>` : ""}
          ${impact ? `<p class="twin-household-impact">${escapeHtml(impact)}</p>` : ""}
          ${chipsMarkup}
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

export function renderBeforeAfterMarkup(
  beforeScores,
  afterScores,
  { overallBefore = null, overallAfter = null } = {},
) {
  if (!beforeScores && !afterScores) {
    return `<div class="twin-empty" id="sim-before-after-empty">Run a simulation to compare baseline layout metrics against a redesigned layout.</div>`;
  }
  const hasOverallBefore =
    typeof overallBefore === "number" && Number.isFinite(overallBefore);
  const hasOverallAfter =
    typeof overallAfter === "number" && Number.isFinite(overallAfter);
  const overallDelta =
    hasOverallBefore && hasOverallAfter ? overallAfter - overallBefore : null;
  const overallRow =
    hasOverallBefore || hasOverallAfter
      ? `<div class="twin-compare-row twin-compare-overall" data-compare-category="overall">
          <span><strong>Overall</strong></span>
          <span class="twin-compare-before">${hasOverallBefore ? overallBefore : "—"}</span>
          <span class="twin-compare-arrow" aria-hidden="true">→</span>
          <span class="twin-compare-after">${hasOverallAfter ? overallAfter : "—"}</span>
          <span class="twin-compare-delta"${overallDelta !== null && overallDelta < 0 ? ' data-negative="true"' : ""}>${overallDelta === null ? "—" : overallDelta > 0 ? `+${overallDelta}` : String(overallDelta)}</span>
        </div>`
      : "";

  return `<div class="twin-comparison-table" id="sim-before-after" aria-label="Before and after layout scores">
    <div class="twin-compare-header">
      <span>Metric</span>
      <span style="text-align:right">Before</span>
      <span></span>
      <span style="text-align:right">After</span>
      <span style="text-align:right">Delta</span>
    </div>
    ${overallRow}
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

export function renderFindingsDiffMarkup(viewState) {
  const state = normalizeSimulationViewState(viewState);
  const { resolvedFindings, remainingFindings, introducedFindings } = state;
  if (
    resolvedFindings.length === 0 &&
    introducedFindings.length === 0 &&
    !state.afterScores
  ) {
    return "";
  }

  const resolvedList = resolvedFindings
    .map(
      (f) =>
        `<li class="twin-diff-item" data-diff="resolved"><span aria-hidden="true">✓</span><span>${escapeHtml(f.title)} resolved</span></li>`,
    )
    .join("");

  const introducedList = introducedFindings
    .map(
      (f) =>
        `<li class="twin-diff-item" data-diff="introduced"><span aria-hidden="true">⚠</span><span>New: ${escapeHtml(f.title)}</span></li>`,
    )
    .join("");

  const remainingList = remainingFindings
    .map(
      (f) =>
        `<li class="twin-diff-item" data-diff="remaining"><span aria-hidden="true">•</span><span>Remaining: ${escapeHtml(f.title)}</span></li>`,
    )
    .join("");

  return `<div class="twin-findings-diff" id="sim-findings-diff" aria-label="Findings comparison">
    <span class="section-label">Findings comparison</span>
    <ul class="twin-diff-list">
      ${resolvedList || '<li class="twin-diff-item" data-diff="info"><span>•</span><span>No findings eliminated yet</span></li>'}
      ${introducedList}
      ${remainingList}
    </ul>
  </div>`;
}

export function renderAttemptTrailMarkup(attemptSummaries = []) {
  if (!Array.isArray(attemptSummaries) || attemptSummaries.length === 0) {
    return "";
  }
  return `<div class="twin-attempt-trail" id="sim-attempt-trail" aria-label="Validator self-correction log">
    <span class="section-label">Validator verification</span>
    <ol class="twin-attempt-list">
      ${attemptSummaries
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}
    </ol>
  </div>`;
}

export function renderRedesignMarkup(redesignActions = [], viewState = {}) {
  const state = normalizeSimulationViewState({
    ...viewState,
    redesignActions,
  });

  if (state.redesignPending) {
    return `<div class="twin-redesign-box" id="sim-redesign-panel" role="status" aria-live="polite">
      <span class="section-label">Gemini redesign</span>
      <p class="twin-redesign-working" id="sim-redesign-working">Gemini is redesigning… validating candidate ScenePatch and replaying household life.</p>
    </div>`;
  }

  if (
    state.redesignMessage &&
    (state.redesignStatus === "FAILED" || state.redesignStatus === "NO_IMPROVEMENT")
  ) {
    return `<div class="twin-redesign-box" id="sim-redesign-panel">
      <span class="section-label">Gemini redesign</span>
      <p class="twin-redesign-rejected" id="sim-redesign-rejected">${escapeHtml(state.redesignMessage)}</p>
      ${renderAttemptTrailMarkup(state.attemptSummaries)}
    </div>`;
  }

  if (!Array.isArray(redesignActions) || redesignActions.length === 0) {
    const cta = state.canRedesign
      ? `<button type="button" class="primary twin-propose-inline-btn" id="sim-propose-redesign-inline">Propose Gemini Redesign</button>`
      : "";
    return `<div class="twin-redesign-box" id="sim-redesign-panel">
      <span class="section-label">Gemini redesign</span>
      <p class="muted" style="margin-top:6px">Proposed ScenePatch improvements will appear here after simulation analysis.</p>
      ${cta}
    </div>`;
  }

  const fallbackBadge = state.isFallbackRedesign
    ? '<span class="twin-fallback-pill" title="Deterministic ScenePatch generated when Gemini was unavailable">Deterministic fallback</span>'
    : "";

  return `<div class="twin-redesign-box" id="sim-redesign-panel">
    <div class="twin-redesign-head">
      <span class="section-label">Gemini redesign</span>
      ${fallbackBadge}
    </div>
    ${state.redesignMessage ? `<p class="twin-redesign-note">${escapeHtml(state.redesignMessage)}</p>` : ""}
    <ul class="twin-redesign-list" id="sim-redesign-list">
      ${redesignActions
        .map(
          (action) =>
            `<li><span class="twin-redesign-check" aria-hidden="true">✓</span><span>${escapeHtml(action)}</span></li>`,
        )
        .join("")}
    </ul>
    ${renderAttemptTrailMarkup(state.attemptSummaries)}
    ${state.redesignStatus === "REVIEW" ? `<div class="studio-replay-actions">
      <button type="button" class="primary" id="sim-approve-redesign">Approve layout changes</button>
      <button type="button" class="secondary" id="sim-dismiss-redesign">Dismiss layout changes</button>
    </div>` : ""}
  </div>`;
}

export function renderResultsDeckMarkup(viewState, personas = []) {
  const state = normalizeSimulationViewState(viewState);
  const layoutToggleMarkup = state.hasLayoutToggle
    ? `<div class="twin-layout-toggle" role="group" aria-label="3D layout preview">
        <button type="button" data-layout-view="before" aria-pressed="${state.activeLayoutView === "before"}">Before layout</button>
        <button type="button" data-layout-view="after" aria-pressed="${state.activeLayoutView === "after"}">After layout</button>
      </div>`
    : "";

  const headerRedesignBtn =
    state.canRedesign && !state.afterScores
      ? `<button type="button" class="primary twin-propose-deck-btn" id="sim-propose-redesign-deck" ${state.redesignPending ? "disabled" : ""}>${state.redesignPending ? "Gemini is redesigning…" : "Propose Gemini Redesign"}</button>`
      : "";

  return `<div class="twin-results-deck">
    <section class="twin-deck-card" id="sim-findings-panel" aria-labelledby="sim-findings-heading">
      <div class="twin-deck-head">
        <div>
          <p class="eyebrow">Spatial validation</p>
          <h3 id="sim-findings-heading">Findings &amp; scorecard</h3>
        </div>
        ${state.isMockData ? '<span class="twin-mock-badge">Mock preview</span>' : ""}
      </div>
      ${renderFindingsMarkup(state, personas)}
      ${renderScorecardMarkup(state.scores)}
    </section>
    <section class="twin-deck-card" id="sim-comparison-panel" aria-labelledby="sim-compare-heading">
      <div class="twin-deck-head">
        <div>
          <p class="eyebrow">Measurable impact</p>
          <h3 id="sim-compare-heading">Before / After redesign</h3>
        </div>
        <div class="twin-deck-head-actions">
          ${headerRedesignBtn}
          ${layoutToggleMarkup}
          ${state.isMockData && state.afterScores ? '<span class="twin-mock-badge">Mock preview</span>' : ""}
        </div>
      </div>
      ${renderBeforeAfterMarkup(state.beforeScores, state.afterScores, {
        overallBefore: state.overallBeforeScore,
        overallAfter: state.overallAfterScore,
      })}
      ${renderFindingsDiffMarkup(state)}
      ${renderRedesignMarkup(state.redesignActions, state)}
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
  onSeekTimeline = () => {},
  onToggleRoutes = () => {},
  onSelectFinding = () => {},
  onSelectLayoutView = () => {},
  onProposeRedesign = () => {},
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
      if (state.status === "RUNNING" || state.redesignPending) return;
      onRunSimulation(state.scenarioId);
    },
    triggerPause() {
      if (state.status !== "RUNNING") return;
      onPauseSimulation();
    },
    triggerReset() {
      if (state.redesignPending) return;
      onResetSimulation();
    },
    triggerRedesign() {
      if (state.redesignPending || state.status === "RUNNING") return;
      onProposeRedesign(state.scenarioId);
    },
    selectSpeed(multiplier) {
      const numeric = Number(multiplier);
      if (!SIMULATION_SPEEDS.includes(numeric)) return state;
      state = normalizeSimulationViewState({ ...state, speed: numeric });
      onSimulationSpeedChange(state.speed);
      emit();
      return state;
    },
    seekTimeline(second) {
      const numeric = Number(second);
      if (!Number.isFinite(numeric)) return state;
      state = normalizeSimulationViewState({ ...state, currentSecond: numeric });
      onSeekTimeline(numeric);
      return state;
    },
    toggleShowAllRoutes(checked) {
      const flag = Boolean(checked);
      state = normalizeSimulationViewState({ ...state, showAllRoutes: flag });
      onToggleRoutes(flag);
      emit();
      return state;
    },
    selectFinding(findingId) {
      const finding = state.findings.find((f) => f.id === findingId) || null;
      const nextId = state.selectedFindingId === findingId ? null : findingId;
      state = normalizeSimulationViewState({ ...state, selectedFindingId: nextId });
      onSelectFinding(nextId ? finding : null);
      emit();
      return state;
    },
    selectLayoutView(mode) {
      const view = mode === "after" ? "after" : "before";
      state = normalizeSimulationViewState({ ...state, activeLayoutView: view });
      onSelectLayoutView(view);
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
  onSeekTimeline = () => {},
  onToggleRoutes = () => {},
  onSelectFinding = () => {},
  onSelectLayoutView = () => {},
  onProposeRedesign = () => {},
  onApproveRedesign = () => {},
  onDismissRedesign = () => {},
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
        resultsHost.innerHTML = renderResultsDeckMarkup(state, personas);
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
    onSeekTimeline,
    onToggleRoutes,
    onSelectFinding,
    onSelectLayoutView,
    onProposeRedesign,
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
    else if (btn.id === "sim-propose-redesign-btn") controller.triggerRedesign();
  }

  function handleControlChange(event) {
    if (event.target?.id === "sim-scenario") {
      controller.selectScenario(event.target.value);
    } else if (event.target?.id === "sim-toggle-routes") {
      controller.toggleShowAllRoutes(event.target.checked);
    }
  }

  function handleControlInput(event) {
    if (event.target?.id === "sim-scrubber") {
      controller.seekTimeline(Number(event.target.value));
    }
  }

  function handleResultsClick(event) {
    if (event.target.closest("#sim-approve-redesign")) return onApproveRedesign();
    if (event.target.closest("#sim-dismiss-redesign")) return onDismissRedesign();
    const redesignBtn = event.target.closest(
      "#sim-propose-redesign-deck, #sim-propose-redesign-inline",
    );
    if (redesignBtn) {
      controller.triggerRedesign();
      return;
    }
    const layoutBtn = event.target.closest("[data-layout-view]");
    if (layoutBtn) {
      controller.selectLayoutView(layoutBtn.dataset.layoutView);
      return;
    }
    const findingCard = event.target.closest("[data-finding-id]");
    if (findingCard) {
      controller.selectFinding(findingCard.dataset.findingId);
    }
  }

  function handleResultsKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const findingCard = event.target.closest?.("[data-finding-id]");
    if (!findingCard) return;
    event.preventDefault();
    controller.selectFinding(findingCard.dataset.findingId);
  }

  controlHost?.addEventListener("click", handleControlClick);
  controlHost?.addEventListener("change", handleControlChange);
  controlHost?.addEventListener("input", handleControlInput);
  resultsHost?.addEventListener("click", handleResultsClick);
  resultsHost?.addEventListener("keydown", handleResultsKeydown);
  renderDOM(controller.getState(), controller.getPersonas());

  return {
    ...controller,
    /**
     * Fast in-place clock + scrubber update during 60fps animation frames.
     * Avoids replacing `controlHost.innerHTML` while buttons are being clicked.
     */
    updateClockAndProgress({ currentTime, currentSecond, startSecond, endSecond } = {}) {
      if (!visible || !controlHost) return;
      const clockEl = controlHost.querySelector("#sim-clock");
      if (clockEl && typeof currentTime === "string") {
        clockEl.textContent = currentTime;
      }
      const scrubber = controlHost.querySelector("#sim-scrubber");
      if (scrubber && Number.isFinite(Number(currentSecond))) {
        if (Number.isFinite(Number(startSecond))) scrubber.min = String(startSecond);
        if (Number.isFinite(Number(endSecond))) scrubber.max = String(endSecond);
        scrubber.value = String(Math.round(Number(currentSecond)));
      }
    },
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
      controlHost?.removeEventListener("input", handleControlInput);
      resultsHost?.removeEventListener("click", handleResultsClick);
      resultsHost?.removeEventListener("keydown", handleResultsKeydown);
    },
  };
}
