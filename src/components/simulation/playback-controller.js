import {
  formatSimulationClock,
  selectVisibleRoutes,
} from "../avatar/simulation-scene-layer.js";
import { SIMULATION_SPEEDS } from "../../contracts/simulation.js";

/**
 * Fallback linear timeline sampler used ONLY when a caller connects a `SimulationResult`
 * without passing desktop's `getSimulationSnapshotAt`.
 * Does NOT calculate paths or schedules — strictly interpolates precomputed `simulation.timeline`.
 */
export function sampleTimelineAt(simulation, timestampSeconds) {
  if (!simulation || !Array.isArray(simulation.timeline) || simulation.timeline.length === 0) {
    return [];
  }
  const target = Number(timestampSeconds) || 0;
  const byAgent = new Map();
  for (const frame of simulation.timeline) {
    if (!frame?.agentId) continue;
    let list = byAgent.get(frame.agentId);
    if (!list) {
      list = [];
      byAgent.set(frame.agentId, list);
    }
    list.push(frame);
  }

  const snapshots = [];
  for (const frames of byAgent.values()) {
    if (frames.length === 0) continue;
    if (target <= frames[0].timestamp) {
      snapshots.push({ ...frames[0] });
      continue;
    }
    const last = frames[frames.length - 1];
    if (target >= last.timestamp) {
      snapshots.push({ ...last });
      continue;
    }
    let idx = 0;
    while (idx < frames.length - 2 && frames[idx + 1].timestamp < target) {
      idx += 1;
    }
    const a = frames[idx];
    const b = frames[idx + 1];
    const span = Math.max(1e-6, b.timestamp - a.timestamp);
    const t = Math.max(0, Math.min(1, (target - a.timestamp) / span));
    const ax = Number(a.position?.[0]) || 0;
    const az = Number(a.position?.[1]) || 0;
    const bx = Number(b.position?.[0]) || 0;
    const bz = Number(b.position?.[1]) || 0;
    snapshots.push({
      ...a,
      timestamp: target,
      minute:
        Number.isFinite(Number(a.minute)) && Number.isFinite(Number(b.minute))
          ? a.minute + (b.minute - a.minute) * t
          : target / 60,
      position: [ax + (bx - ax) * t, az + (bz - az) * t],
      yaw: Number.isFinite(Number(b.yaw)) ? Number(b.yaw) : Number(a.yaw) || 0,
      moving: Boolean(a.moving || b.moving),
    });
  }
  return snapshots;
}

/**
 * Simulation Playback Controller.
 *
 * Architectural boundary:
 * - Consumes externally supplied `SimulationResult` + `getSnapshotAt(simulation, second)`.
 * - Drives avatar frames, visible route selection, timeline scrubbing, and finding focus.
 * - Contains ZERO pathfinding, schedule generation, or spatial validation math.
 */
export function createSimulationPlaybackController({
  baseSimSecondsPerRealSecond = 12,
  onFrame = () => {},
  onTick = () => {},
  onStatusChange = () => {},
  onCheckpoint = () => {},
} = {}) {
  let payload = null;
  let status = "READY";
  let speed = 1;
  let currentSecond = 0;
  let startSecond = 0;
  let endSecond = 0;
  let showAllRoutes = false;
  let selectedFindingId = null;
  let checkpoints = [];
  let activeCheckpointId = null;
  let pauseOnCheckpoints = false;
  let triggeredCheckpointIds = new Set();
  let rafId = 0;
  let lastWallMs = 0;
  let agentMeta = new Map();

  function stopLoop() {
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
    rafId = 0;
    lastWallMs = 0;
  }

  function resolveSnapshot(sec) {
    if (!payload?.simulation) return [];
    const fn =
      typeof payload.getSnapshotAt === "function"
        ? payload.getSnapshotAt
        : sampleTimelineAt;
    return fn(payload.simulation, sec) || [];
  }

  function resolveClockText(sec, snapshots) {
    if (!payload?.simulation) return null;
    const mode = payload.clockMode === "elapsed" ? "elapsed" : "clock";
    if (mode === "elapsed") {
      const elapsed = Math.max(0, sec - startSecond);
      if (status === "COMPLETE" && payload.completedLabel) {
        return payload.completedLabel;
      }
      return formatSimulationClock({ timestampSeconds: elapsed, mode: "elapsed" });
    }
    const sampleMin = snapshots?.[0]?.minute;
    const minute = Number.isFinite(Number(sampleMin))
      ? Number(sampleMin)
      : sec / 60;
    return formatSimulationClock({ minute, timestampSeconds: sec, mode: "clock" });
  }

  function emitCurrentFrame({ notifyTick = true } = {}) {
    if (!payload?.simulation) {
      onFrame({
        snapshots: [],
        visibleRoutes: [],
        agentMeta: new Map(),
        timestampSeconds: 0,
      });
      return { currentTime: null, snapshots: [], visibleRoutes: [] };
    }

    const snapshots = resolveSnapshot(currentSecond);
    const visibleRoutes = selectVisibleRoutes({
      routes: payload.simulation.routes || [],
      agentRoutes: payload.agentRoutes || [],
      snapshots,
      timestampSeconds: currentSecond,
      showAllRoutes,
      isEvacuation: Boolean(payload.isEvacuation),
    });

    onFrame({
      snapshots,
      visibleRoutes,
      agentMeta,
      timestampSeconds: currentSecond,
    });

    const currentTime = resolveClockText(currentSecond, snapshots);
    const span = Math.max(1, endSecond - startSecond);
    const progress = Math.max(0, Math.min(1, (currentSecond - startSecond) / span));

    if (notifyTick) {
      onTick({
        status,
        currentSecond,
        startSecond,
        endSecond,
        progress,
        currentTime,
      });
    }
    return { currentTime, snapshots, visibleRoutes };
  }

  function emitStatus(extra = {}) {
    const snapshots = payload?.simulation ? resolveSnapshot(currentSecond) : [];
    const currentTime = payload?.simulation
      ? resolveClockText(currentSecond, snapshots)
      : null;
    onStatusChange({
      status,
      speed,
      currentSecond,
      startSecond,
      endSecond,
      hasTimeline: Boolean(payload?.simulation && endSecond > startSecond),
      checkpoints,
      activeCheckpointId,
      showAllRoutes,
      selectedFindingId,
      currentTime,
      ...extra,
    });
  }

  function scheduleNextFrame() {
    if (status !== "RUNNING" || typeof requestAnimationFrame !== "function") return;
    rafId = requestAnimationFrame((nowMs) => {
      rafId = 0;
      if (status !== "RUNNING") return;
      const dtMs = lastWallMs > 0 ? Math.min(100, Math.max(0, nowMs - lastWallMs)) : 16.67;
      lastWallMs = nowMs;
      step(dtMs);
      if (status === "RUNNING") {
        scheduleNextFrame();
      }
    });
  }

  function load(nextPayload = {}) {
    stopLoop();
    payload = nextPayload;
    const sim = payload?.simulation;
    startSecond = Number.isFinite(Number(sim?.startSecond))
      ? Number(sim.startSecond)
      : Number.isFinite(Number(sim?.startMinute))
        ? Number(sim.startMinute) * 60
        : 0;
    endSecond = Number.isFinite(Number(sim?.endSecond))
      ? Number(sim.endSecond)
      : Number.isFinite(Number(sim?.endMinute))
        ? Number(sim.endMinute) * 60
        : startSecond;
    if (endSecond < startSecond) endSecond = startSecond;
    currentSecond = startSecond;
    selectedFindingId = null;
    checkpoints = Array.isArray(payload?.checkpoints)
      ? [...payload.checkpoints]
      : Array.isArray(sim?.checkpoints)
        ? [...sim.checkpoints]
        : [];
    activeCheckpointId = null;
    triggeredCheckpointIds = new Set();

    agentMeta = new Map();
    for (const agent of sim?.agents || []) {
      if (!agent?.id) continue;
      agentMeta.set(agent.id, {
        id: agent.id,
        name: agent.name || agent.id,
        color: agent.color || null,
        heightMeters: agent.heightMeters ?? null,
        eyeHeightMeters: agent.eyeHeightMeters ?? null,
        usesWheelchair: Boolean(agent.usesWheelchair),
        role: agent.role || null,
      });
    }
    status = "READY";
    emitCurrentFrame({ notifyTick: false });
    return getState();
  }

  function play() {
    if (!payload?.simulation) return getState();
    if (currentSecond >= endSecond) {
      currentSecond = startSecond;
      triggeredCheckpointIds = new Set();
    }
    status = "RUNNING";
    lastWallMs = 0;
    emitCurrentFrame({ notifyTick: false });
    emitStatus();
    scheduleNextFrame();
    return getState();
  }

  function pause() {
    if (status !== "RUNNING") return getState();
    stopLoop();
    status = "PAUSED";
    emitStatus();
    return getState();
  }

  function seek(nextSecond) {
    if (!payload?.simulation) return getState();
    const numeric = Number(nextSecond);
    if (!Number.isFinite(numeric)) return getState();
    currentSecond = Math.max(startSecond, Math.min(endSecond, numeric));
    triggeredCheckpointIds = new Set(
      checkpoints
        .filter((cp) => cp.timestampSeconds <= currentSecond)
        .map((cp) => cp.id),
    );
    if (status === "COMPLETE" && currentSecond < endSecond) {
      status = "PAUSED";
      emitCurrentFrame({ notifyTick: true });
      emitStatus();
      return getState();
    }
    emitCurrentFrame({ notifyTick: true });
    return getState();
  }

  function hasActiveWalkAt(sec) {
    const routes = payload?.simulation?.routes;
    if (!Array.isArray(routes) || routes.length === 0) return false;
    return routes.some((r) => {
      const s = Number(r.startTimestamp);
      const e =
        r.endTimestamp != null
          ? Number(r.endTimestamp)
          : s + (Number(r.distanceMeters) || 0) / (Number(r.speedMps) || 1.3);
      return sec >= s - 0.5 && sec <= e + 0.5;
    });
  }

  function resolveEffectiveSimRate(sec) {
    // Allow scenario-specific explicit speed rates when configured
    if (payload?.speedRates && Number.isFinite(Number(payload.speedRates[speed]))) {
      const baseRate = Number(payload.speedRates[speed]);
      if (speed === 1 && payload.adaptiveWalkPacing !== false) {
        const walkingRate = Number(payload.walkingSimSecondsPerRealSecond) || 3.2;
        return hasActiveWalkAt(sec) ? Math.min(baseRate, walkingRate) : baseRate;
      }
      return baseRate;
    }
    const rate =
      Number(payload?.simSecondsPerRealSecond) || baseSimSecondsPerRealSecond;
    return rate * speed;
  }

  function step(deltaRealMs) {
    if (!payload?.simulation || status !== "RUNNING") return getState();
    const dtSec = Math.max(0, Number(deltaRealMs) || 0) / 1000;
    const prevSecond = currentSecond;
    const effectiveRate = resolveEffectiveSimRate(currentSecond);
    currentSecond += dtSec * effectiveRate;

    // Emit checkpoint notifications when crossing checkpoint timestamps
    for (const cp of checkpoints) {
      if (
        !triggeredCheckpointIds.has(cp.id) &&
        cp.timestampSeconds > prevSecond &&
        cp.timestampSeconds <= currentSecond
      ) {
        triggeredCheckpointIds.add(cp.id);
        activeCheckpointId = cp.id;
        onCheckpoint(cp);
        if (pauseOnCheckpoints) {
          currentSecond = cp.timestampSeconds;
          stopLoop();
          status = "PAUSED";
          emitCurrentFrame({ notifyTick: true });
          emitStatus({ checkpoint: cp });
          return getState();
        }
      }
    }

    if (currentSecond >= endSecond) {
      currentSecond = endSecond;
      stopLoop();
      status = "COMPLETE";
      emitCurrentFrame({ notifyTick: true });
      emitStatus({ completed: true });
      return getState();
    }

    emitCurrentFrame({ notifyTick: true });
    return getState();
  }

  function jumpToCheckpoint(idOrType, { pausePlayback = true } = {}) {
    if (!payload?.simulation || checkpoints.length === 0) return null;
    const query = String(idOrType || "").trim();
    const matched =
      checkpoints.find((cp) => cp.id === query || cp.type === query) ||
      checkpoints.find(
        (cp) => cp.label?.toLowerCase() === query.toLowerCase(),
      ) ||
      null;
    if (!matched) return null;
    activeCheckpointId = matched.id;
    seek(matched.timestampSeconds);
    if (pausePlayback && status === "RUNNING") {
      pause();
    } else {
      emitStatus({ checkpoint: matched });
    }
    onCheckpoint(matched);
    return matched;
  }

  function setPauseOnCheckpoints(flag) {
    pauseOnCheckpoints = Boolean(flag);
    return pauseOnCheckpoints;
  }

  function setSpeed(multiplier) {
    const numeric = Number(multiplier);
    if (!SIMULATION_SPEEDS.includes(numeric)) return getState();
    speed = numeric;
    return getState();
  }

  function setShowAllRoutes(flag) {
    showAllRoutes = Boolean(flag);
    if (payload?.simulation) {
      emitCurrentFrame({ notifyTick: false });
    }
    emitStatus();
    return getState();
  }

  function selectFinding(findingOrId) {
    const nextId =
      typeof findingOrId === "string"
        ? findingOrId
        : findingOrId?.id || null;
    selectedFindingId = selectedFindingId === nextId ? null : nextId;
    emitStatus();
    return selectedFindingId;
  }

  function reset() {
    stopLoop();
    payload = null;
    status = "READY";
    currentSecond = 0;
    startSecond = 0;
    endSecond = 0;
    selectedFindingId = null;
    checkpoints = [];
    activeCheckpointId = null;
    triggeredCheckpointIds = new Set();
    agentMeta = new Map();
    onFrame({
      snapshots: [],
      visibleRoutes: [],
      agentMeta: new Map(),
      timestampSeconds: 0,
    });
    emitStatus({
      currentTime: null,
      hasTimeline: false,
    });
    return getState();
  }

  function getState() {
    return {
      status,
      speed,
      currentSecond,
      startSecond,
      endSecond,
      checkpoints: [...checkpoints],
      activeCheckpointId,
      pauseOnCheckpoints,
      showAllRoutes,
      selectedFindingId,
      hasSimulation: Boolean(payload?.simulation),
    };
  }

  return {
    load,
    play,
    pause,
    seek,
    step,
    setSpeed,
    setShowAllRoutes,
    selectFinding,
    getCheckpoints: () => [...checkpoints],
    jumpToCheckpoint,
    setPauseOnCheckpoints,
    reset,
    dispose: stopLoop,
    getState,
  };
}
