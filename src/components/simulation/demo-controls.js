import {
  DEMO_SCENARIOS,
  SCORE_CATEGORIES,
  SIMULATION_SPEEDS,
  SUPPORTED_FRIEND_COUNTS,
  normalizeSimulationViewState,
} from "../../contracts/simulation.js";
import {
  formatAvatarActivityStatus,
  formatFindingEvidenceChips,
} from "../avatar/simulation-scene-layer.js";

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

const DEFAULT_PERSONA_COLORS = Object.freeze([
  "#3d6b82",
  "#b55d3f",
  "#5a7d5a",
  "#8a638e",
  "#2f6b8a",
  "#b4823e",
]);

const PRIMARY_SCENARIO_CARDS = Object.freeze([
  {
    id: "morning-routine",
    icon: "☀️",
    shortLabel: "Morning",
    title: "Morning Routine",
    subtitle: "Everyday family life",
    badge: "4 family",
  },
  {
    id: "friends-arrival",
    icon: "🎉",
    shortLabel: "Friends",
    title: "Friends Are Coming",
    subtitle: "Staged crowd waves",
    badge: "Crowd test",
  },
  {
    id: "grandparents-visit",
    icon: "♿",
    shortLabel: "Grandparents",
    title: "Grandparents Staying Over",
    subtitle: "Accessibility test (0.90 m)",
    badge: "♿ 0.90 m",
  },
  {
    id: "fire-emergency",
    icon: "🔥",
    shortLabel: "Fire",
    title: "Fire Emergency",
    subtitle: "Emergency egress check",
    badge: "Safety",
  },
  {
    id: "normal-day",
    icon: "🏠",
    shortLabel: "Normal Day",
    title: "Normal Day",
    subtitle: "Full daily schedule",
    badge: "All day",
  },
]);

const FRIEND_PRESETS = SUPPORTED_FRIEND_COUNTS;

function summarizePersona(persona) {
  if (Array.isArray(persona?.preferences) && persona.preferences.length > 0) {
    return persona.preferences.slice(0, 2).join(" • ");
  }
  const traits = [];
  if (persona?.wheelchair || Number(persona?.needs?.accessibility) >= 0.75) {
    traits.push("Wheelchair • 0.90 m route");
  }
  if (Number(persona?.needs?.quiet) >= 0.75) traits.push("Quiet preferred");
  if (Number(persona?.needs?.privacy) >= 0.75) traits.push("High privacy");
  if (Number(persona?.needs?.daylight) >= 0.7) traits.push("Likes daylight");
  if (Number(persona?.needs?.social) >= 0.7) traits.push("Social host");
  return traits.join(" • ") || "Household member";
}

function summarizeScheduleSpan(persona) {
  const sched = Array.isArray(persona?.schedule) ? persona.schedule : [];
  if (sched.length === 0) return "Flexible guest";
  return `${sched.length} ${sched.length === 1 ? "activity" : "activities"}`;
}

function resolvePersonaHeightBadge(persona) {
  if (Number.isFinite(Number(persona?.heightMeters))) {
    return `${Number(persona.heightMeters).toFixed(2)} m`;
  }
  if (persona?.heightLabel) return String(persona.heightLabel);
  if (persona?.wheelchair) return "♿ Wheelchair";
  switch (persona?.ageGroup) {
    case "child":
      return "1.30 m";
    case "teen":
      return "1.74 m";
    case "olderAdult":
      return "1.65 m";
    default:
      return null;
  }
}

function resolvePersonaRoleBadge(persona) {
  if (persona?.role) {
    const r = String(persona.role).toLowerCase();
    if (r === "brother") return "Older Brother";
    if (r === "sister") return "Younger Sister";
    return r[0].toUpperCase() + r.slice(1);
  }
  if (persona?.wheelchair) return "Wheelchair";
  return null;
}

export function renderPersonaQuickViewMarkup(personas = []) {
  if (!Array.isArray(personas) || personas.length === 0) {
    return `<div class="twin-personas" id="sim-persona-summary"><span class="section-label">Step 6 · Your Household</span><p class="muted" style="margin-top:5px">No household personas set yet. Open Step 6 (Your Household) to customize members.</p></div>`;
  }
  const items = personas
    .map((p, idx) => {
      const color = p.color || DEFAULT_PERSONA_COLORS[idx % DEFAULT_PERSONA_COLORS.length];
      const heightText = resolvePersonaHeightBadge(p);
      const roleText = resolvePersonaRoleBadge(p);
      const schedSummary = summarizeScheduleSpan(p);
      const isWheelchair =
        Boolean(p?.wheelchair) || Number(p?.needs?.accessibility) >= 0.8;
      return `<div class="twin-persona-item" data-persona-id="${escapeHtml(p.id || `p-${idx}`)}"${isWheelchair ? ' data-wheelchair="true"' : ""}>
        <div class="twin-persona-top">
          <span class="twin-persona-ident">
            <span class="twin-persona-dot" style="background:${escapeHtml(color)}" aria-hidden="true">${isWheelchair ? "♿" : ""}</span>
            <strong>${escapeHtml(p.name)}</strong>
            ${roleText && !String(p.name || "").toLowerCase().includes(roleText.toLowerCase()) ? `<em class="twin-persona-role">${escapeHtml(roleText)}</em>` : ""}
          </span>
          <span class="twin-persona-metrics">
            ${heightText ? `<span class="twin-persona-height">${escapeHtml(heightText)}</span>` : ""}
            <small class="twin-persona-sched">${escapeHtml(schedSummary)}</small>
          </span>
        </div>
        <span data-persona-live-activity>${escapeHtml(summarizePersona(p))}</span>
      </div>`;
    })
    .join("");
  return `<div class="twin-personas" id="sim-persona-summary">
    <div class="twin-personas-head">
      <span class="section-label">Step 6 · Your Household (${personas.length})</span>
      <span class="bp-dim-tag">SCALE 1:1 m</span>
    </div>
    <div class="twin-persona-list">${items}</div>
  </div>`;
}

function renderScenarioCardsMarkup(state, disabled) {
  const cards = PRIMARY_SCENARIO_CARDS.map((card) => {
    const active = state.scenarioId === card.id;
    return `<button type="button" class="twin-scenario-card twin-scenario-icon-btn" data-scenario-card="${escapeHtml(card.id)}" aria-label="${escapeHtml(card.title)}" title="${escapeHtml(`${card.title} — ${card.subtitle}`)}" aria-pressed="${active}" ${disabled ? "disabled" : ""}>
      <span class="twin-sc-icon" aria-hidden="true">${card.icon}</span>
      <span class="twin-sc-short">${escapeHtml(card.shortLabel)}</span>
    </button>`;
  }).join("");

  const friendControl =
    state.scenarioId === "friends-arrival"
      ? `<div class="twin-friends-control" id="sim-friends-control" aria-label="Friends count control">
          <div class="twin-friends-stepper">
            <span class="section-label">Friends</span>
            <div class="twin-stepper-box">
              <button type="button" id="sim-friends-dec" aria-label="Decrease friends" ${disabled || state.friendCount <= 1 ? "disabled" : ""}>−</button>
              <output id="sim-friends-count" aria-live="polite">${state.friendCount}</output>
              <button type="button" id="sim-friends-inc" aria-label="Increase friends" ${disabled || state.friendCount >= 20 ? "disabled" : ""}>+</button>
            </div>
          </div>
          <div class="twin-friends-presets" role="group" aria-label="Friend count presets">
            ${FRIEND_PRESETS.map(
              (n) =>
                `<button type="button" data-friend-preset="${n}" aria-pressed="${state.friendCount === n}" ${disabled ? "disabled" : ""}>${n}</button>`,
            ).join("")}
          </div>
        </div>`
      : "";

  return `<div class="twin-scenario-grid twin-scenario-icon-bar" role="group" aria-label="Stress test scenarios">${cards}</div>${friendControl}`;
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
  const isBusy = isRunning || state.redesignPending;
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

  const checkpointPillsMarkup =
    state.hasTimeline && state.checkpoints.length > 0
      ? `<div class="twin-checkpoints" id="sim-checkpoints" role="group" aria-label="Story checkpoints">
          ${state.checkpoints
            .map(
              (cp) =>
                `<button type="button" class="twin-checkpoint-pill" data-checkpoint-id="${escapeHtml(cp.id)}" data-checkpoint-type="${escapeHtml(cp.type)}" aria-pressed="${state.activeCheckpointId === cp.id}" title="${escapeHtml(cp.description || cp.label)}">${escapeHtml(cp.label)}</button>`,
            )
            .join("")}
        </div>`
      : "";

  const scrubberMarkup = state.hasTimeline
    ? `<div class="twin-scrubber-bar" id="sim-timeline-wrap">
        <label class="twin-scrubber-label" for="sim-scrubber">
          <span class="section-label">Timeline &amp; Checkpoints</span>
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
        ${checkpointPillsMarkup}
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

  const speedIdx = SIMULATION_SPEEDS.indexOf(state.speed);
  const canStepDown = speedIdx > 0;
  const canStepUp = speedIdx >= 0 && speedIdx < SIMULATION_SPEEDS.length - 1;
  const playGlyph = isRunning ? "⏸" : "▶";
  const playTitle = isRunning ? "Pause simulation" : runLabel;

  return `<div class="twin-control-card" aria-label="Household Digital Twin controls">
    <div class="twin-card-head">
      <div>
        <p class="eyebrow">Step 7 · Living Blueprint Stress Test</p>
        <h2>Simulate life</h2>
      </div>
      ${state.isMockData ? '<span class="twin-mock-badge" title="Placeholder mock output while simulation engine is external">Demo mock</span>' : '<span class="bp-spec-tag">DWG · LIVE TWIN</span>'}
    </div>
    ${renderScenarioCardsMarkup(state, isBusy)}
    <div class="twin-scenario-active-bar">
      <strong>${escapeHtml(activeScenario?.name || "Morning Routine")}</strong>
      <span id="sim-scenario-desc">${escapeHtml(activeScenario?.description || "")}</span>
    </div>
    <label class="twin-field" for="sim-scenario" hidden>
      <span class="section-label">All scenarios</span>
      <select id="sim-scenario" aria-label="Simulation scenario" ${isBusy ? "disabled" : ""}>
        ${scenarios
          .map(
            (s) =>
              `<option value="${escapeHtml(s.id)}"${s.id === state.scenarioId ? " selected" : ""}>${escapeHtml(s.name)}</option>`,
          )
          .join("")}
      </select>
    </label>
    <div class="twin-status-row" id="sim-status" data-status="${escapeHtml(state.status)}" role="status" aria-live="polite">
      <span class="twin-status-indicator"><span class="twin-dot" aria-hidden="true"></span><span>${escapeHtml(statusText)}</span></span>
      <span class="twin-clock" id="sim-clock">${state.currentTime ? escapeHtml(state.currentTime) : ""}</span>
    </div>
    <div class="twin-transport-bar" role="group" aria-label="Playback transport and speed">
      <div class="twin-transport-controls">
        <button type="button" class="secondary twin-step-speed" id="sim-speed-dec" aria-label="Decrease speed" title="Slower" ${canStepDown ? "" : "disabled"}>−</button>
        <button type="button" class="primary twin-play-toggle" id="sim-play-toggle" aria-label="${escapeHtml(playTitle)}" title="${escapeHtml(playTitle)}" ${state.redesignPending ? "disabled" : ""}>
          <span class="twin-play-glyph" aria-hidden="true">${playGlyph}</span>
          <span>${isRunning ? "Pause" : escapeHtml(runLabel)}</span>
        </button>
        <button type="button" class="secondary twin-step-speed" id="sim-speed-inc" aria-label="Increase speed" title="Faster" ${canStepUp ? "" : "disabled"}>+</button>
        <button type="button" class="secondary twin-reset-compact" id="sim-reset-btn" ${hasOutput && !state.redesignPending ? "" : "disabled"}>Reset</button>
      </div>
      <div class="twin-speed-readout" aria-live="polite">
        <span class="section-label">Speed</span>
        <output id="sim-speed-value" data-current-speed="${state.speed}">${state.speed}×</output>
      </div>
      <div hidden aria-hidden="true">
        <button type="button" id="sim-run-btn" ${isBusy ? "disabled" : ""}>${escapeHtml(runLabel)}</button>
        <button type="button" id="sim-pause-btn" ${isRunning ? "" : "disabled"}>Pause</button>
        ${SIMULATION_SPEEDS.map(
          (mult) =>
            `<button type="button" data-sim-speed="${mult}" aria-pressed="${state.speed === mult}">${mult}×</button>`,
        ).join("")}
      </div>
    </div>
    ${redesignButtonMarkup}
    ${scrubberMarkup}
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

function findingCategoryBadge(finding) {
  const t = String(finding?.type || "").toUpperCase();
  if (t.startsWith("ACCESSIBILITY_")) return "Accessibility";
  if (t === "PRIVACY_SIGHTLINE") return "Privacy";
  if (t === "NOISE_CONFLICT") return "Noise";
  if (t.startsWith("TV_") || t === "SUN_GLARE") return "Visibility";
  if (t.includes("EVACUATION")) return "Safety";
  return "Movement";
}

export function renderFindingsMarkup(viewState, personas = []) {
  const state = normalizeSimulationViewState(viewState);
  if (state.status === "RUNNING" && state.findings.length === 0) {
    return `<div class="twin-empty" id="sim-findings-empty">Running scenario simulation… evaluating walkways, wheelchair clearances, sightlines, and room schedules.</div>`;
  }
  if (state.status === "ERROR") {
    return `<div class="twin-finding" data-level="critical"><span class="twin-finding-icon" aria-hidden="true">⛔</span><div><strong>Simulation failed</strong><p>${escapeHtml(state.errorMessage || "Unable to complete simulation run.")}</p></div></div>`;
  }
  if (state.findings.length === 0) {
    if (state.status === "COMPLETE") {
      return `<div class="twin-finding" id="sim-findings-clear" data-level="success"><span class="twin-finding-icon" aria-hidden="true">✓</span><div><strong>All measured spatial checks clear</strong><p>No congestion, blocked paths, sightline, noise, accessibility, or evacuation bottlenecks detected in this scenario.</p></div></div>`;
    }
    return `<div class="twin-empty" id="sim-findings-empty">No findings yet. Choose a scenario and click <strong>Run Simulation</strong> to inspect spatial issues.</div>`;
  }

  const accessCount = state.findings.filter((f) => f.isAccessibility).length;
  const accessBanner =
    accessCount > 0
      ? `<div class="twin-accessibility-banner" role="region" aria-label="Wheelchair accessibility summary">
          <span class="twin-access-icon" aria-hidden="true">♿</span>
          <div>
            <strong>Accessibility check · ${accessCount} mobility ${accessCount === 1 ? "issue" : "issues"} measured</strong>
            <p>Checked doorway widths (≥ 0.82 m), 1.50 m turning circles, and wheelchair route reachability.</p>
          </div>
        </div>`
      : "";

  return `${accessBanner}<div class="twin-findings-list" id="sim-findings-list">${state.findings
    .map((finding) => {
      const glyph = finding.isAccessibility
        ? "♿"
        : LEVEL_GLYPHS[finding.level] || LEVEL_GLYPHS.info;
      const isSelected = state.selectedFindingId === finding.id;
      const chips = formatFindingEvidenceChips(finding);
      const impact = state.isMockData ? "" : householdImpact(finding, personas);
      const category = findingCategoryBadge(finding);
      const chipsMarkup =
        chips.length > 0
          ? `<div class="twin-evidence-chips">${chips
              .map((c) => `<span class="twin-evidence-chip">${escapeHtml(c)}</span>`)
              .join("")}</div>`
          : "";
      return `<article class="twin-finding twin-finding-interactive" tabindex="0" role="button" aria-pressed="${isSelected}" data-finding-id="${escapeHtml(finding.id)}" data-level="${escapeHtml(finding.level)}" data-finding-type="${escapeHtml(finding.type)}"${finding.isAccessibility ? ' data-accessibility="true"' : ""}>
        <span class="twin-finding-icon" aria-label="${escapeHtml(finding.level)}">${glyph}</span>
        <div>
          <div class="twin-finding-head">
            <span class="twin-finding-title-wrap">
              <em class="twin-finding-cat">${escapeHtml(category)}</em>
              <strong>${escapeHtml(finding.title)}</strong>
            </span>
            <span class="twin-finding-badges">
              ${finding.location ? `<span class="twin-finding-loc">${escapeHtml(finding.location)}</span>` : ""}
              <span class="twin-finding-focus">${isSelected ? "Focused in 3D" : "Focus in 3D"}</span>
            </span>
          </div>
          ${finding.summary ? `<p>${escapeHtml(finding.summary)}</p>` : ""}
          ${finding.whyItMatters ? `<p class="twin-finding-why"><strong>Why it matters:</strong> ${escapeHtml(finding.whyItMatters)}</p>` : ""}
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
    <div class="twin-diff-summary-pills">
      <span class="diff-pill diff-resolved">Resolved: ${resolvedFindings.length}</span>
      <span class="diff-pill diff-remaining">Remaining: ${remainingFindings.length}</span>
      <span class="diff-pill diff-new">New: ${introducedFindings.length}</span>
    </div>
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
    <span class="section-label">Validator result</span>
    <ol class="twin-attempt-list">
      ${attemptSummaries
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}
    </ol>
  </div>`;
}

const REDESIGN_PIPELINE_STEPS = Object.freeze([
  { step: 1, label: "Gemini proposes" },
  { step: 2, label: "Validator checks" },
  { step: 3, label: "Retry if needed" },
  { step: 4, label: "Patch accepted" },
  { step: 5, label: "Replay result" },
]);

export function renderRedesignStepperMarkup(state) {
  const isPending = Boolean(state.redesignPending);
  const isReview = state.redesignStatus === "REVIEW";
  const isAccepted =
    Boolean(state.afterScores) ||
    state.redesignStatus === "IMPROVED" ||
    (Array.isArray(state.redesignActions) && state.redesignActions.length > 0 && !isReview);
  const isFailed =
    state.redesignStatus === "FAILED" || state.redesignStatus === "NO_IMPROVEMENT";
  const hadRetry = (state.attemptSummaries || []).some((s) =>
    /rejected|corrected|fallback/i.test(s),
  );

  const items = REDESIGN_PIPELINE_STEPS.map(({ step, label }) => {
    let stepState = "idle";
    if (isPending) {
      stepState = step === 1 ? "active" : step === 2 ? "next" : "idle";
    } else if (isReview) {
      stepState = step <= 3 ? "done" : step === 4 ? "active" : "idle";
    } else if (isAccepted) {
      stepState = step === 3 && !hadRetry ? "skipped" : "done";
    } else if (isFailed) {
      stepState = step <= 3 ? "failed" : "idle";
    }
    return `<li class="twin-pipe-step" data-pipe-state="${stepState}">
      <span class="twin-pipe-num" aria-hidden="true">${stepState === "done" ? "✓" : step}</span>
      <span class="twin-pipe-label">${escapeHtml(label)}</span>
    </li>`;
  }).join("");

  return `<ol class="twin-redesign-stepper" id="sim-redesign-stepper" aria-label="Gemini redesign verification pipeline">${items}</ol>`;
}

export function renderRedesignMarkup(redesignActions = [], viewState = {}) {
  const state = normalizeSimulationViewState({
    ...viewState,
    redesignActions,
  });

  if (state.redesignPending) {
    return `<div class="twin-redesign-box" id="sim-redesign-panel" role="status" aria-live="polite">
      <div class="twin-redesign-head">
        <span class="section-label">Gemini spatial redesign</span>
        <span class="twin-working-pill">Validating…</span>
      </div>
      ${renderRedesignStepperMarkup(state)}
      <p class="twin-redesign-working" id="sim-redesign-working">Gemini is redesigning… checking locked fixtures, doorway clearances, and replaying household life.</p>
    </div>`;
  }

  if (
    state.redesignMessage &&
    (state.redesignStatus === "FAILED" || state.redesignStatus === "NO_IMPROVEMENT")
  ) {
    return `<div class="twin-redesign-box" id="sim-redesign-panel">
      <span class="section-label">Gemini spatial redesign</span>
      ${renderRedesignStepperMarkup(state)}
      <p class="twin-redesign-rejected" id="sim-redesign-rejected">${escapeHtml(state.redesignMessage)}</p>
      ${renderAttemptTrailMarkup(state.attemptSummaries)}
    </div>`;
  }

  if (!Array.isArray(redesignActions) || redesignActions.length === 0) {
    const cta = state.canRedesign
      ? `<button type="button" class="primary twin-propose-inline-btn" id="sim-propose-redesign-inline">Propose Gemini Redesign</button>`
      : "";
    return `<div class="twin-redesign-box" id="sim-redesign-panel">
      <span class="section-label">Gemini spatial redesign</span>
      ${renderRedesignStepperMarkup(state)}
      <p class="muted" style="margin-top:6px">Proposed ScenePatch improvements will appear here after simulation analysis.</p>
      ${cta}
    </div>`;
  }

  const measuredOutcome = {
    IMPROVED: "The replay measured an improvement.",
    MIXED: "The replay measured both improvements and regressions.",
    REGRESSION: "The replay measured a regression.",
    NO_CHANGE: "The replay measured no change.",
  }[state.redesignStatus];
  const fallbackBadge = state.isFallbackRedesign
    ? '<span class="twin-fallback-pill" title="Deterministic ScenePatch generated when Gemini was unavailable">Deterministic fallback</span>'
    : '<span class="twin-verified-pill">Validator verified</span>';

  return `<div class="twin-redesign-box" id="sim-redesign-panel">
    <div class="twin-redesign-head">
      <span class="section-label">Gemini spatial redesign</span>
      ${fallbackBadge}
    </div>
    ${renderRedesignStepperMarkup(state)}
    ${measuredOutcome ? `<p class="twin-outcome-banner" id="sim-redesign-outcome">${measuredOutcome}</p>` : ""}
    ${state.redesignMessage ? `<p class="twin-redesign-note"><strong>Why Gemini changed this:</strong> ${escapeHtml(state.redesignMessage)}</p>` : ""}
    <ul class="twin-redesign-list" id="sim-redesign-list">
      ${redesignActions
        .map(
          (action) =>
            `<li><span class="twin-redesign-check" aria-hidden="true">✓</span><span>${escapeHtml(action)}</span></li>`,
        )
        .join("")}
    </ul>
    ${renderAttemptTrailMarkup(state.attemptSummaries)}
    ${state.redesignStatus === "REVIEW" ? `<div class="studio-replay-actions twin-review-actions">
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
    state.canRedesign && !state.afterScores && state.redesignStatus !== "REVIEW"
      ? `<button type="button" class="primary twin-propose-deck-btn" id="sim-propose-redesign-deck" ${state.redesignPending ? "disabled" : ""}>${state.redesignPending ? "Gemini is redesigning…" : "Propose Gemini Redesign"}</button>`
      : "";

  return `<div class="twin-results-deck">
    <section class="twin-deck-card" id="sim-findings-panel" aria-labelledby="sim-findings-heading">
      <div class="twin-deck-head">
        <div>
          <p class="eyebrow">Measured product insights</p>
          <h3 id="sim-findings-heading">Findings &amp; scorecard</h3>
        </div>
        ${state.isMockData ? '<span class="twin-mock-badge">Mock preview</span>' : `<span class="bp-spec-tag">${state.findings.length} ${state.findings.length === 1 ? "FINDING" : "FINDINGS"}</span>`}
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
  onFriendCountChange = () => {},
  onSeekTimeline = () => {},
  onJumpCheckpoint = () => {},
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
    setFriendCount(count) {
      const next = Math.max(1, Math.min(20, Math.round(Number(count) || 8)));
      state = normalizeSimulationViewState({ ...state, friendCount: next });
      onFriendCountChange(state.friendCount);
      emit();
      return state;
    },
    triggerRun() {
      if (state.status === "RUNNING" || state.redesignPending) return;
      onRunSimulation(state.scenarioId, { friendCount: state.friendCount });
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
    stepSpeed(delta) {
      const idx = SIMULATION_SPEEDS.indexOf(state.speed);
      const safeIdx = idx === -1 ? 0 : idx;
      const nextIdx = Math.max(0, Math.min(SIMULATION_SPEEDS.length - 1, safeIdx + (delta > 0 ? 1 : -1)));
      return this.selectSpeed(SIMULATION_SPEEDS[nextIdx]);
    },
    togglePlayPause() {
      if (state.redesignPending) return;
      if (state.status === "RUNNING") this.triggerPause();
      else this.triggerRun();
    },
    selectFriendCount(count) {
      return this.setFriendCount(count);
    },
    seekTimeline(second) {
      const numeric = Number(second);
      if (!Number.isFinite(numeric)) return state;
      state = normalizeSimulationViewState({ ...state, currentSecond: numeric });
      onSeekTimeline(numeric);
      return state;
    },
    jumpCheckpoint(idOrType) {
      if (!idOrType) return state;
      onJumpCheckpoint(idOrType);
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
  onFriendCountChange = () => {},
  onSeekTimeline = () => {},
  onJumpCheckpoint = () => {},
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
    onFriendCountChange,
    onSeekTimeline,
    onJumpCheckpoint,
    onToggleRoutes,
    onSelectFinding,
    onSelectLayoutView,
    onProposeRedesign,
    onChange: renderDOM,
  });

  function handleControlClick(event) {
    const scenarioCard = event.target.closest("[data-scenario-card]");
    if (scenarioCard) {
      controller.selectScenario(scenarioCard.dataset.scenarioCard);
      return;
    }
    const presetBtn = event.target.closest("[data-friend-preset]");
    if (presetBtn) {
      controller.setFriendCount(Number(presetBtn.dataset.friendPreset));
      return;
    }
    const checkpointBtn = event.target.closest("[data-checkpoint-id]");
    if (checkpointBtn) {
      controller.jumpCheckpoint(checkpointBtn.dataset.checkpointId);
      return;
    }
    const speedBtn = event.target.closest("[data-sim-speed]");
    if (speedBtn) {
      controller.selectSpeed(Number(speedBtn.dataset.simSpeed));
      return;
    }
    const btn = event.target.closest("button");
    if (!btn) return;
    if (btn.id === "sim-play-toggle") controller.togglePlayPause();
    else if (btn.id === "sim-speed-dec") controller.stepSpeed(-1);
    else if (btn.id === "sim-speed-inc") controller.stepSpeed(1);
    else if (btn.id === "sim-run-btn") controller.triggerRun();
    else if (btn.id === "sim-pause-btn") controller.triggerPause();
    else if (btn.id === "sim-reset-btn") controller.triggerReset();
    else if (btn.id === "sim-propose-redesign-btn") controller.triggerRedesign();
    else if (btn.id === "sim-friends-dec") {
      controller.setFriendCount(controller.getState().friendCount - 1);
    } else if (btn.id === "sim-friends-inc") {
      controller.setFriendCount(controller.getState().friendCount + 1);
    }
  }

  function handleControlChange(event) {
    if (event.target?.id === "sim-scenario") {
      controller.selectScenario(event.target.value);
    } else if (event.target?.id === "sim-friend-count") {
      controller.selectFriendCount(Number(event.target.value));
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
    updateClockAndProgress({ currentTime, currentSecond, startSecond, endSecond, snapshots } = {}) {
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
      if (Array.isArray(snapshots) && snapshots.length > 0) {
        for (const snap of snapshots) {
          const row = controlHost.querySelector(
            `[data-persona-id="${CSS.escape ? CSS.escape(String(snap.agentId)) : String(snap.agentId)}"] [data-persona-live-activity]`,
          );
          if (!row) continue;
          const st = formatAvatarActivityStatus(snap);
          row.textContent = st.destinationLabel && !st.isMoving
            ? `${st.activityLabel} · ${st.destinationLabel}`
            : st.activityLabel;
        }
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
