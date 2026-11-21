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
  baseSimSecondsPerRealSecond = 45,
  onFrame = () => {},
  onTick = () => {},
  onStatusChange = () => {},
} = {}) {
  let payload = null;
  let status = "READY";
  let speed = 1;
  let currentSecond = 0;
  let startSecond = 0;
  let endSecond = 0;
  let showAllRoutes = false;
  let selectedFindingId = null;
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
        snapshots,
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

    agentMeta = new Map();
    const personaLookup = new Map(
      (payload?.personas || []).map((p) => [p?.id, p]),
    );
    for (const agent of sim?.agents || []) {
      if (!agent?.id) continue;
      const persona = personaLookup.get(agent.id);
      agentMeta.set(agent.id, {
        id: agent.id,
        name: agent.name || persona?.name || agent.id,
        color: agent.color || persona?.color || null,
        role: agent.role || persona?.role || null,
        ageGroup: agent.ageGroup || persona?.ageGroup || "adult",
        wheelchair: Boolean(
          agent.wheelchair ||
            persona?.wheelchair ||
            Number(persona?.needs?.accessibility) >= 0.85,
        ),
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
    if (status === "COMPLETE" && currentSecond < endSecond) {
      status = "PAUSED";
      emitCurrentFrame({ notifyTick: true });
      emitStatus();
      return getState();
    }
    emitCurrentFrame({ notifyTick: true });
    return getState();
  }

  function step(deltaRealMs) {
    if (!payload?.simulation || status !== "RUNNING") return getState();
    const dtSec = Math.max(0, Number(deltaRealMs) || 0) / 1000;
    const rate =
      Number(payload.simSecondsPerRealSecond) || baseSimSecondsPerRealSecond;
    currentSecond += dtSec * rate * speed;

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
    reset,
    dispose: stopLoop,
    getState,
  };
}
