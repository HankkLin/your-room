import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_CONGESTION_CONFIG,
  DEFAULT_GRID_CELL_SIZE,
  DEFAULT_LONG_PATH_METERS,
  SIMULATION_EVENT_TYPES,
} from "../contracts/simulation.js";
import { createHouseholdAgentState } from "./household-agent.js";
import { buildNavigationModel } from "./navigation-grid.js";
import { findPath, samplePointAlongPath } from "./pathfinding.js";
import { resolveScheduleDestination } from "./schedule.js";
import {
  createCongestionFinding,
  createLongPathFinding,
  createNoPathFinding,
} from "./simulation-findings.js";

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

const REST_ACTIVITIES = new Set(["sleep", "wake"]);

function inferTimeWindowFromAgents(rawAgents = []) {
  let minMinute = Infinity;
  let maxMinute = -Infinity;
  for (const agent of rawAgents) {
    for (const entry of Array.isArray(agent?.schedule) ? agent.schedule : []) {
      const s = Number(entry.startMinute ?? entry.windowStartMinute);
      const e = Number(
        entry.endMinute ??
          entry.windowEndMinute ??
          (Number.isFinite(s) ? s + 30 : NaN),
      );
      if (Number.isFinite(s)) minMinute = Math.min(minMinute, s);
      if (Number.isFinite(e)) maxMinute = Math.max(maxMinute, e);
    }
  }
  if (!Number.isFinite(minMinute)) return { startMinute: 420, endMinute: 540 };
  return {
    startMinute: minMinute,
    endMinute: Math.max(minMinute + 15, maxMinute),
  };
}

function closestApproachInStep(aPrev, aCurr, bPrev, bCurr) {
  const r0x = aPrev[0] - bPrev[0];
  const r0z = aPrev[1] - bPrev[1];
  const vx = aCurr[0] - aPrev[0] - (bCurr[0] - bPrev[0]);
  const vz = aCurr[1] - aPrev[1] - (bCurr[1] - bPrev[1]);
  const vLenSq = vx * vx + vz * vz;
  const tau =
    vLenSq > 1e-12
      ? Math.max(0, Math.min(1, -(r0x * vx + r0z * vz) / vLenSq))
      : 1;
  const ax = aPrev[0] + (aCurr[0] - aPrev[0]) * tau;
  const az = aPrev[1] + (aCurr[1] - aPrev[1]) * tau;
  const bx = bPrev[0] + (bCurr[0] - bPrev[0]) * tau;
  const bz = bPrev[1] + (bCurr[1] - bPrev[1]) * tau;
  return {
    distance: Math.hypot(ax - bx, az - bz),
    midpoint: [round3((ax + bx) / 2), round3((az + bz) / 2)],
    tau,
  };
}

function findSpatialClusters(eligibleAgents, radiusMeters) {
  const n = eligibleAgents.length;
  const visited = new Uint8Array(n);
  const clusters = [];

  for (let i = 0; i < n; i += 1) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = 1;
    const members = [];

    while (queue.length > 0) {
      const curr = queue.shift();
      members.push(eligibleAgents[curr]);
      const [cx, cz] = eligibleAgents[curr].currentPosition;
      for (let j = 0; j < n; j += 1) {
        if (visited[j]) continue;
        const [ox, oz] = eligibleAgents[j].currentPosition;
        if (Math.hypot(ox - cx, oz - cz) <= radiusMeters) {
          visited[j] = 1;
          queue.push(j);
        }
      }
    }
    clusters.push(members);
  }
  return clusters;
}

/**
 * Execute a deterministic discrete-time household life simulation on a validated
 * `House JSON` without any Three.js or DOM dependency.
 *
 * @param {object} params
 * @param {object} params.house
 * @param {Array<object>} params.agents
 * @param {number} [params.startMinute]
 * @param {number} [params.endMinute]
 * @param {number} [params.stepSeconds=1]
 * @param {number} [params.timelineSampleSeconds=1]
 * @param {number} [params.cellSize=0.1]
 * @param {number} [params.agentRadius=0.24]
 * @param {number} [params.collisionDistanceMeters]
 * @param {number} [params.longPathThresholdMeters=15.0]
 * @param {object} [params.congestion]
 * @param {object} [params.navigation]
 */
export function runSimulation({
  house,
  agents: rawAgents = [],
  startMinute: explicitStartMinute,
  endMinute: explicitEndMinute,
  stepSeconds = 1,
  timelineSampleSeconds = 1,
  cellSize = DEFAULT_GRID_CELL_SIZE,
  agentRadius = DEFAULT_AGENT_RADIUS,
  collisionDistanceMeters,
  longPathThresholdMeters = DEFAULT_LONG_PATH_METERS,
  congestion: congestionOverrides = {},
  navigation: prebuiltNavigation = null,
}) {
  const navigation =
    prebuiltNavigation ??
    buildNavigationModel(house, {
      cellSize,
      agentRadius,
    });

  const inferredWindow = inferTimeWindowFromAgents(rawAgents);
  const startMinute =
    explicitStartMinute != null ? Number(explicitStartMinute) : inferredWindow.startMinute;
  const endMinute =
    explicitEndMinute != null
      ? Number(explicitEndMinute)
      : Math.max(startMinute + 1, inferredWindow.endMinute);

  const dt = Math.max(0.25, Math.min(10, Number(stepSeconds) || 1));
  const sampleInterval = Math.max(dt, Number(timelineSampleSeconds) || 1);
  const startSecond = Math.round(startMinute * 60);
  const endSecond = Math.round(endMinute * 60);

  const congestionConfig = {
    ...DEFAULT_CONGESTION_CONFIG,
    ...congestionOverrides,
  };

  const initialSlotCounts = new Map();
  const agents = rawAgents.map((raw, idx) =>
    createHouseholdAgentState(raw, {
      navigation,
      house,
      agentIndex: idx,
      startMinute,
      roomSlotCounts: initialSlotCounts,
    }),
  );

  // Track next unexecuted schedule index for each agent
  const scheduleCursors = new Map();
  for (const agent of agents) {
    const firstIdx = agent.schedule.findIndex(
      (entry) => entry.startSecond >= startSecond,
    );
    scheduleCursors.set(
      agent.id,
      firstIdx === -1 ? agent.schedule.length : firstIdx,
    );
  }

  const totalDistanceMeters = Object.fromEntries(agents.map((a) => [a.id, 0]));
  let pathFailures = 0;

  const events = [];
  const findings = [];
  const routes = [];
  const timeline = [];
  const lastRecordedFrameByAgent = new Map();

  function recordTimelineFrame(agent, timestamp, force = false) {
    const prev = lastRecordedFrameByAgent.get(agent.id);
    if (!force && prev) {
      const moved =
        Math.hypot(
          agent.currentPosition[0] - prev.position[0],
          agent.currentPosition[1] - prev.position[1],
        ) > 1e-4;
      const stateChanged =
        prev.activity !== agent.activity ||
        prev.roomId !== agent.currentRoomId ||
        prev.moving !== agent.moving;
      if (!moved && !stateChanged) return;
      if (moved && timestamp - prev.timestamp < sampleInterval - 1e-6) return;
    }

    const frame = {
      timestamp,
      minute: round2(timestamp / 60),
      agentId: agent.id,
      position: [round3(agent.currentPosition[0]), round3(agent.currentPosition[1])],
      yaw: round3(agent.yaw),
      roomId: agent.currentRoomId,
      activity: agent.activity,
      moving: agent.moving,
    };
    timeline.push(frame);
    lastRecordedFrameByAgent.set(agent.id, frame);
  }

  // Compute current occupancy slot in a target room so co-scheduled agents pick adjacent safe spots
  function countAgentsTargetingOrInRoom(roomId, excludeAgentId) {
    let count = 0;
    for (const other of agents) {
      if (other.id === excludeAgentId) continue;
      const otherTarget = other.activeRoute?.targetRoomId ?? other.currentRoomId;
      if (otherTarget === roomId) count += 1;
    }
    return count;
  }

  // Active collision episodes keyed by `"idA|idB"`
  const activeCollisions = new Map();
  let collisionCount = 0;

  // Active congestion episodes keyed by `roomId`
  const activeCongestionByRoom = new Map();

  function finalizeCongestionEpisode(episode) {
    if (episode.durationSeconds < congestionConfig.minDurationSeconds) return;
    const avgPos = [
      episode.sumX / Math.max(1, episode.samples),
      episode.sumZ / Math.max(1, episode.samples),
    ];
    const finding = createCongestionFinding({
      roomId: episode.roomId,
      position: avgPos,
      agentCount: episode.maxAgentCount,
      agentIds: [...episode.agentIds],
      durationSeconds: round2(episode.durationSeconds),
      minimumClearanceMeters: episode.minClearance,
      startTimestamp: episode.startSecond,
      endTimestamp: episode.lastSecond,
    });
    findings.push(finding);
    events.push({
      type: SIMULATION_EVENT_TYPES.CONGESTION,
      timestamp: episode.startSecond,
      endTimestamp: episode.lastSecond,
      roomId: episode.roomId,
      agentIds: [...episode.agentIds],
      durationSeconds: round2(episode.durationSeconds),
      position: finding.location.position,
    });
  }

  // Record initial state at startSecond
  for (const agent of agents) {
    recordTimelineFrame(agent, startSecond, true);
  }

  for (let t = startSecond; t <= endSecond; t += dt) {
    const prevPositions = new Map(
      agents.map((a) => [a.id, [a.currentPosition[0], a.currentPosition[1]]]),
    );

    // 1. Advance moving agents across [t - dt, t]
    if (t > startSecond) {
      for (const agent of agents) {
        const active = agent.activeRoute;
        if (!active) continue;

        const stepDist = Math.min(
          agent.movementSpeedMps * dt,
          active.totalDistance - active.traveledDistance,
        );
        active.traveledDistance += stepDist;
        totalDistanceMeters[agent.id] = round3(
          totalDistanceMeters[agent.id] + stepDist,
        );

        const sampled = samplePointAlongPath(
          active.path,
          active.traveledDistance,
        );

        agent.currentPosition = sampled.position;
        agent.yaw = sampled.yaw;
        const detectedRoom = navigation.getRoomIdAt(
          sampled.position[0],
          sampled.position[1],
        );
        if (detectedRoom) agent.currentRoomId = detectedRoom;

        const door = navigation.getDoorAt(
          sampled.position[0],
          sampled.position[1],
        );
        if (door && !active.emittedDoors.has(door.id)) {
          active.emittedDoors.add(door.id);
          events.push({
            type: SIMULATION_EVENT_TYPES.DOOR_TRAVERSED,
            timestamp: t,
            agentId: agent.id,
            doorId: door.id,
            doorKind: door.kind,
            position: [...sampled.position],
          });
        }

        if (
          sampled.completed ||
          active.traveledDistance >= active.totalDistance - 1e-4
        ) {
          const goalPt = active.path.at(-1);
          agent.currentPosition = [goalPt[0], goalPt[1]];
          agent.currentRoomId = active.targetRoomId ?? agent.currentRoomId;
          agent.activity = active.scheduledActivity;
          agent.moving = false;
          active.routeRecord.endTimestamp = t;
          agent.activeRoute = null;

          events.push({
            type: SIMULATION_EVENT_TYPES.ARRIVED,
            timestamp: t,
            minute: round2(t / 60),
            agentId: agent.id,
            roomId: agent.currentRoomId,
            activity: agent.activity,
            position: [...agent.currentPosition],
          });
          recordTimelineFrame(agent, t, true);
        } else {
          recordTimelineFrame(agent, t, false);
        }
      }
    }

    // 2. Trigger scheduled activities starting at `t`
    for (const agent of agents) {
      let cursor = scheduleCursors.get(agent.id);
      while (
        cursor < agent.schedule.length &&
        agent.schedule[cursor].startSecond <= t
      ) {
        const entry = agent.schedule[cursor];
        cursor += 1;
        scheduleCursors.set(agent.id, cursor);

        events.push({
          type: SIMULATION_EVENT_TYPES.SCHEDULE_START,
          timestamp: t,
          minute: round2(t / 60),
          agentId: agent.id,
          activity: entry.activity,
          destination: structuredClone(entry.destination),
        });

        const targetRoomHint = entry.destination.roomId;
        if (
          entry.destination.type === "room" &&
          targetRoomHint &&
          targetRoomHint === agent.currentRoomId &&
          !agent.moving &&
          REST_ACTIVITIES.has(entry.activity)
        ) {
          agent.activity = entry.activity;
          recordTimelineFrame(agent, t, true);
          continue;
        }

        const slotIndex = targetRoomHint
          ? countAgentsTargetingOrInRoom(targetRoomHint, agent.id)
          : 0;

        const resolvedDest = resolveScheduleDestination(entry.destination, {
          navigation,
          house,
          agentRadius: agent.radiusMeters,
          slotIndex,
          activity: entry.activity,
        });

        if (!resolvedDest.ok || !resolvedDest.position) {
          pathFailures += 1;
          agent.activeRoute = null;
          agent.moving = false;
          events.push({
            type: SIMULATION_EVENT_TYPES.ROUTE_BLOCKED,
            timestamp: t,
            agentId: agent.id,
            fromRoomId: agent.currentRoomId,
            toRoomId: resolvedDest.roomId ?? targetRoomHint ?? null,
            activity: entry.activity,
            reason: "NO_PATH",
          });
          findings.push(
            createNoPathFinding({
              agentId: agent.id,
              activity: entry.activity,
              fromRoomId: agent.currentRoomId,
              toRoomId: resolvedDest.roomId ?? targetRoomHint ?? null,
              position: agent.currentPosition,
              timestampSeconds: t,
            }),
          );
          recordTimelineFrame(agent, t, true);
          continue;
        }

        const pathResult = findPath({
          navigation,
          start: agent.currentPosition,
          goal: resolvedDest.position,
          agentRadius: agent.radiusMeters,
        });

        if (!pathResult.success) {
          pathFailures += 1;
          agent.activeRoute = null;
          agent.moving = false;
          events.push({
            type: SIMULATION_EVENT_TYPES.ROUTE_BLOCKED,
            timestamp: t,
            agentId: agent.id,
            fromRoomId: agent.currentRoomId,
            toRoomId: resolvedDest.roomId,
            activity: entry.activity,
            reason: pathResult.reason,
          });
          findings.push(
            createNoPathFinding({
              agentId: agent.id,
              activity: entry.activity,
              fromRoomId: agent.currentRoomId,
              toRoomId: resolvedDest.roomId,
              position: agent.currentPosition,
              timestampSeconds: t,
              reason: pathResult.reason,
            }),
          );
          recordTimelineFrame(agent, t, true);
          continue;
        }

        if (pathResult.distanceMeters < 0.04) {
          agent.currentPosition = [...resolvedDest.position];
          agent.currentRoomId = resolvedDest.roomId ?? agent.currentRoomId;
          agent.activity = entry.activity;
          agent.moving = false;
          agent.activeRoute = null;
          recordTimelineFrame(agent, t, true);
          continue;
        }

        const routeRecord = {
          agentId: agent.id,
          activity: entry.activity,
          fromRoomId: agent.currentRoomId,
          toRoomId: resolvedDest.roomId,
          startTimestamp: t,
          endTimestamp: null,
          distanceMeters: pathResult.distanceMeters,
          doorsTraversed: pathResult.doorsTraversed,
          roomsTraversed: pathResult.roomsTraversed,
          path: pathResult.path,
        };
        routes.push(routeRecord);

        events.push({
          type: SIMULATION_EVENT_TYPES.ROUTE_PLANNED,
          timestamp: t,
          agentId: agent.id,
          fromRoomId: agent.currentRoomId,
          toRoomId: resolvedDest.roomId,
          activity: entry.activity,
          distanceMeters: pathResult.distanceMeters,
          doorsTraversed: pathResult.doorsTraversed,
        });

        if (pathResult.distanceMeters >= longPathThresholdMeters) {
          findings.push(
            createLongPathFinding({
              agentId: agent.id,
              activity: entry.activity,
              fromRoomId: agent.currentRoomId,
              toRoomId: resolvedDest.roomId,
              distanceMeters: pathResult.distanceMeters,
              thresholdMeters: longPathThresholdMeters,
              doorsTraversed: pathResult.doorsTraversed,
              goalPosition: resolvedDest.position,
              timestampSeconds: t,
            }),
          );
        }

        agent.activeRoute = {
          path: pathResult.path,
          totalDistance: pathResult.distanceMeters,
          traveledDistance: 0,
          targetRoomId: resolvedDest.roomId,
          scheduledActivity: entry.activity,
          emittedDoors: new Set(),
          routeRecord,
        };
        agent.moving = true;
        agent.activity = `going-to-${resolvedDest.roomId || entry.activity}`;
        recordTimelineFrame(agent, t, true);
      }
    }

    // 3. Swept pairwise agent collision / personal-space overlap check
    for (let i = 0; i < agents.length; i += 1) {
      for (let j = i + 1; j < agents.length; j += 1) {
        const a = agents[i];
        const b = agents[j];
        const pairKey = `${a.id}|${b.id}`;
        const approach = closestApproachInStep(
          prevPositions.get(a.id),
          a.currentPosition,
          prevPositions.get(b.id),
          b.currentPosition,
        );
        const dist = approach.distance;
        const threshold =
          collisionDistanceMeters != null
            ? Number(collisionDistanceMeters)
            : a.personalSpaceMeters + b.personalSpaceMeters;

        const bothResting =
          !a.moving &&
          !b.moving &&
          REST_ACTIVITIES.has(a.activity) &&
          REST_ACTIVITIES.has(b.activity) &&
          dist >= a.radiusMeters + b.radiusMeters;

        if (!bothResting && dist < threshold) {
          if (!activeCollisions.has(pairKey)) {
            const exactTime = round2(
              t > startSecond ? t - dt + approach.tau * dt : t,
            );
            const mid = approach.midpoint;
            const event = {
              type: SIMULATION_EVENT_TYPES.AGENT_COLLISION,
              timestamp: exactTime,
              minute: round2(exactTime / 60),
              agentIds: [a.id, b.id],
              roomId: navigation.getRoomIdAt(mid[0], mid[1]) ?? a.currentRoomId,
              position: mid,
              distanceMeters: round3(dist),
            };
            activeCollisions.set(pairKey, event);
            events.push(event);
            collisionCount += 1;
          } else {
            const existing = activeCollisions.get(pairKey);
            if (dist < existing.distanceMeters) {
              existing.distanceMeters = round3(dist);
            }
          }
        } else if (dist >= threshold + 0.06) {
          activeCollisions.delete(pairKey);
        }
      }
    }

    // 4. Sustained spatial congestion analysis
    const eligibleForCongestion = agents.filter(
      (a) =>
        congestionConfig.includeRestActivities || !REST_ACTIVITIES.has(a.activity),
    );
    const clusters = findSpatialClusters(
      eligibleForCongestion,
      congestionConfig.radiusMeters,
    ).filter((group) => group.length >= congestionConfig.minAgents);

    const roomsCrowdedThisTick = new Set();

    for (const group of clusters) {
      let cx = 0;
      let cz = 0;
      for (const member of group) {
        cx += member.currentPosition[0];
        cz += member.currentPosition[1];
      }
      cx /= group.length;
      cz /= group.length;

      const roomId =
        navigation.getRoomIdAt(cx, cz) || group[0].currentRoomId || "unknown";
      roomsCrowdedThisTick.add(roomId);

      // Compute minimum clearance across agents & surrounding physical obstacles
      let minPairClearance = Infinity;
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const pairDist = Math.hypot(
            group[i].currentPosition[0] - group[j].currentPosition[0],
            group[i].currentPosition[1] - group[j].currentPosition[1],
          );
          const freeGap = Math.max(
            0,
            pairDist - group[i].radiusMeters - group[j].radiusMeters,
          );
          if (freeGap < minPairClearance) minPairClearance = freeGap;
        }
      }
      const envClearance = navigation.getClearanceAt(cx, cz);
      const effectiveClearance = Math.min(minPairClearance, envClearance * 2);

      const existing = activeCongestionByRoom.get(roomId);
      if (!existing) {
        activeCongestionByRoom.set(roomId, {
          roomId,
          startSecond: t,
          lastSecond: t,
          durationSeconds: dt,
          maxAgentCount: group.length,
          agentIds: new Set(group.map((m) => m.id)),
          minClearance: effectiveClearance,
          sumX: cx,
          sumZ: cz,
          samples: 1,
        });
      } else {
        existing.lastSecond = t;
        existing.durationSeconds += dt;
        existing.maxAgentCount = Math.max(existing.maxAgentCount, group.length);
        for (const m of group) existing.agentIds.add(m.id);
        existing.minClearance = Math.min(
          existing.minClearance,
          effectiveClearance,
        );
        existing.sumX += cx;
        existing.sumZ += cz;
        existing.samples += 1;
      }
    }

    // Close congestion episodes that have cleared for > 5 seconds
    for (const [roomId, episode] of activeCongestionByRoom.entries()) {
      if (!roomsCrowdedThisTick.has(roomId) && t - episode.lastSecond > 5) {
        finalizeCongestionEpisode(episode);
        activeCongestionByRoom.delete(roomId);
      }
    }
  }

  // Finalize any ongoing congestion episodes at endSecond and record final keyframes
  for (const episode of activeCongestionByRoom.values()) {
    finalizeCongestionEpisode(episode);
  }
  for (const agent of agents) {
    recordTimelineFrame(agent, endSecond, true);
  }

  const congestionEvents = findings.filter(
    (f) => f.type === "CONGESTION",
  ).length;

  const summary = {
    totalDistanceMeters,
    pathFailures,
    collisions: collisionCount,
    congestionEvents,
    findings,
  };

  return {
    startMinute,
    endMinute,
    startSecond,
    endSecond,
    stepSeconds: dt,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      movementSpeedMps: a.movementSpeedMps,
      radiusMeters: a.radiusMeters,
      finalRoomId: a.currentRoomId,
      finalPosition: [...a.currentPosition],
      finalActivity: a.activity,
    })),
    routes,
    timeline,
    events,
    findings,
    summary,
  };
}

/**
 * Repeatable top-level simulation entrypoint designed for both:
 * - `simulateHouse(house, household, scenario)` (Task 2 §23)
 * - `compareHouseholdLayouts({ beforeScene, afterScene, personas, rooms, simulate: simulateHouse })`
 *
 * Pure and deterministic: never mutates `house`, `household`, or `scenario`.
 */
export function simulateHouse(house, household = [], scenario = {}) {
  const agents = Array.isArray(household)
    ? household
    : Array.isArray(household?.agents)
      ? household.agents
      : [];
  return runSimulation({
    house,
    agents,
    ...scenario,
  });
}

/**
 * Interpolate continuous `[x, z, yaw, roomId, activity, moving]` for every agent
 * at any `timestampSeconds` so the Three.js renderer can animate smoothly at 60 FPS
 * from the compact `simulation.timeline`.
 */
export function getSimulationSnapshotAt(simulation, timestampSeconds) {
  if (!simulation || !Array.isArray(simulation.timeline)) return [];
  const t = Number(timestampSeconds);

  // Group frames per agent lazily on first snapshot call
  if (!simulation._framesByAgent) {
    const grouped = new Map();
    for (const frame of simulation.timeline) {
      if (!grouped.has(frame.agentId)) grouped.set(frame.agentId, []);
      grouped.get(frame.agentId).push(frame);
    }
    Object.defineProperty(simulation, "_framesByAgent", {
      value: grouped,
      enumerable: false,
    });
  }

  const snapshots = [];
  for (const [agentId, frames] of simulation._framesByAgent.entries()) {
    if (frames.length === 0) continue;
    if (t <= frames[0].timestamp) {
      snapshots.push({ ...frames[0], position: [...frames[0].position] });
      continue;
    }
    const last = frames.at(-1);
    if (t >= last.timestamp) {
      snapshots.push({ ...last, position: [...last.position] });
      continue;
    }

    // Binary search for surrounding frames [lo, lo + 1]
    let lo = 0;
    let hi = frames.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].timestamp <= t) lo = mid;
      else hi = mid;
    }

    const f0 = frames[lo];
    const f1 = frames[hi];
    const span = f1.timestamp - f0.timestamp;
    const alpha = span > 1e-6 && f0.moving ? (t - f0.timestamp) / span : 0;

    snapshots.push({
      timestamp: t,
      minute: round2(t / 60),
      agentId,
      position: [
        round3(f0.position[0] + (f1.position[0] - f0.position[0]) * alpha),
        round3(f0.position[1] + (f1.position[1] - f0.position[1]) * alpha),
      ],
      yaw: f0.yaw,
      roomId: f0.roomId,
      activity: f0.activity,
      moving: f0.moving,
    });
  }
  return snapshots;
}
