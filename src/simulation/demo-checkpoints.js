import {
  DEMO_CHECKPOINT_TYPES,
  FINDING_TYPES,
  SIMULATION_EVENT_TYPES,
} from "../contracts/simulation.js";

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Derive deterministic, reusable demo script checkpoints (`DEMO_CHECKPOINT_TYPES`)
 * from actual simulation events, findings, and redesign/replay state so a live
 * presenter, automated script, or UI jump pill can seek/pause at exact story beats:
 *
 * - `MORNING_START`
 * - `BATHROOM_CONFLICT`
 * - `BREAKFAST_CONGESTION`
 * - `TV_NOISE_CONFLICT`
 * - `GRANDPARENTS_ARRIVE`
 * - `WHEELCHAIR_ACCESS_CHECK`
 * - `FRIENDS_ARRIVE`
 * - `FIRE_START`
 * - `REDESIGN_APPLIED`
 * - `REPLAY_START`
 *
 * @param {object} params
 * @param {string} [params.scenarioId]
 * @param {object} [params.simulation]
 * @param {Array<object>} [params.findings]
 * @param {boolean} [params.isRedesignReplay=false]
 */
export function buildDemoCheckpoints({
  scenarioId = "morning-routine",
  simulation = null,
  findings = [],
  isRedesignReplay = false,
} = {}) {
  if (!simulation) return [];

  const startSec = Number.isFinite(Number(simulation.startSecond))
    ? Number(simulation.startSecond)
    : (Number(simulation.startMinute) || 0) * 60;
  const endSec = Number.isFinite(Number(simulation.endSecond))
    ? Number(simulation.endSecond)
    : (Number(simulation.endMinute) || 0) * 60;

  const clampSec = (s) => Math.max(startSec, Math.min(endSec, Math.round(Number(s) || startSec)));
  const checkpoints = [];
  const pushCheckpoint = ({ type, label, timestampSeconds, roomId = null, description = "" }) => {
    const sec = clampSec(timestampSeconds);
    const id = `cp-${type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (checkpoints.some((c) => c.type === type)) return;
    checkpoints.push({
      id,
      type,
      label,
      timestampSeconds: sec,
      minute: round1(sec / 60),
      roomId,
      description,
    });
  };

  const events = Array.isArray(simulation.events) ? simulation.events : [];
  const allFindings = [
    ...(Array.isArray(findings) ? findings : []),
    ...(Array.isArray(simulation.findings) ? simulation.findings : []),
  ];

  if (isRedesignReplay) {
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.REDESIGN_APPLIED,
      label: "Redesign Applied",
      timestampSeconds: startSec,
      description: "Validated ScenePatch applied to movable furniture while preserving locked fixtures.",
    });
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.REPLAY_START,
      label: "Replay Start",
      timestampSeconds: startSec + Math.min(60, Math.max(0, endSec - startSec)),
      description: "Identical household schedule replaying on redesigned layout.",
    });
  }

  if (scenarioId === "fire-emergency") {
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.FIRE_START,
      label: "Fire Alarm",
      timestampSeconds: startSec,
      description: "Simultaneous emergency evacuation to exterior exit.",
    });
    return checkpoints;
  }

  if (scenarioId === "grandparents-visit") {
    const arriveEvt = events.find(
      (e) =>
        e.type === SIMULATION_EVENT_TYPES.ROUTE_PLANNED &&
        /grandpa|grandma/i.test(String(e.agentId || "")),
    );
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.GRANDPARENTS_ARRIVE,
      label: "Grandparents Arrive",
      timestampSeconds: arriveEvt ? arriveEvt.timestamp : startSec + 120,
      roomId: arriveEvt?.toRoomId ?? "living-room",
      description: "Grandpa Arthur (wheelchair) & Grandma Evelyn arrive at entry.",
    });

    const accessEvt =
      events.find(
        (e) =>
          (e.type === SIMULATION_EVENT_TYPES.ROUTE_BLOCKED ||
            e.type === SIMULATION_EVENT_TYPES.ROUTE_PLANNED) &&
          /grandpa/i.test(String(e.agentId || "")) &&
          e.activity === "bathroom",
      ) ||
      events.find(
        (e) =>
          e.type === SIMULATION_EVENT_TYPES.SCHEDULE_START &&
          /grandpa/i.test(String(e.agentId || "")) &&
          e.activity === "bathroom",
      );

    const accessFinding = allFindings.find((f) =>
      String(f.type || "").startsWith("ACCESSIBILITY_"),
    );

    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.WHEELCHAIR_ACCESS_CHECK,
      label: "Wheelchair Check",
      timestampSeconds: accessEvt ? accessEvt.timestamp : startSec + 1200,
      roomId: accessFinding?.roomId ?? "bathroom",
      description: "Wheelchair doorway width, route reachability, and 1.50 m turning radius check.",
    });
  }

  if (scenarioId === "friends-arrival" || scenarioId === "dinner-party-8-guests") {
    const friendRoutes = events.filter(
      (e) =>
        e.type === SIMULATION_EVENT_TYPES.ROUTE_PLANNED &&
        /friend|guest/i.test(String(e.agentId || "")),
    );
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.FRIENDS_ARRIVE,
      label: "Wave 1 Arrives",
      timestampSeconds: friendRoutes[0]?.timestamp ?? startSec + 60,
      roomId: friendRoutes[0]?.fromRoomId ?? "living-room",
      description: "Staged guest waves arrive at front entry and move into living & kitchen.",
    });
  }

  if (scenarioId === "morning-routine" || scenarioId === "normal-day") {
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.MORNING_START,
      label: "Morning Wake-Up",
      timestampSeconds: startSec,
      roomId: "bedroom",
      description: "Family of four begins morning schedule (07:00 AM).",
    });

    // Bathroom overlap / crossing
    const bathStarts = events.filter(
      (e) =>
        e.type === SIMULATION_EVENT_TYPES.SCHEDULE_START &&
        e.activity === "bathroom",
    );
    if (bathStarts.length >= 2) {
      pushCheckpoint({
        type: DEMO_CHECKPOINT_TYPES.BATHROOM_CONFLICT,
        label: "Bathroom Overlap",
        timestampSeconds: bathStarts[1].timestamp,
        roomId: bathStarts[1].destination?.roomId ?? "bathroom",
        description: "Back-to-back family bathroom traffic and hallway crossing.",
      });
    } else if (bathStarts.length === 1) {
      pushCheckpoint({
        type: DEMO_CHECKPOINT_TYPES.BATHROOM_CONFLICT,
        label: "Bathroom Rush",
        timestampSeconds: bathStarts[0].timestamp,
        roomId: bathStarts[0].destination?.roomId ?? "bathroom",
        description: "Morning bathroom routine.",
      });
    }
  }

  // Breakfast / Kitchen congestion checkpoint (across daily or guest scenarios)
  const congestionEvt = events.find(
    (e) => e.type === SIMULATION_EVENT_TYPES.CONGESTION,
  );
  const kitchenStart = events.find(
    (e) =>
      e.type === SIMULATION_EVENT_TYPES.SCHEDULE_START &&
      (e.activity === "eat" || e.activity === "cook") &&
      /kitchen/i.test(String(e.destination?.roomId || "")),
  );
  if (congestionEvt || kitchenStart) {
    pushCheckpoint({
      type: DEMO_CHECKPOINT_TYPES.BREAKFAST_CONGESTION,
      label:
        scenarioId === "friends-arrival" || scenarioId === "dinner-party-8-guests"
          ? "Kitchen Clustering"
          : "Breakfast Congestion",
      timestampSeconds: congestionEvt
        ? congestionEvt.timestamp + 15
        : kitchenStart.timestamp + 20,
      roomId: congestionEvt?.roomId ?? "kitchen",
      description: "Multiple people cluster around tight kitchen prep & table clearance.",
    });
  }

  // TV vs WFH / homework noise conflict
  const noiseFinding = allFindings.find(
    (f) => f.type === FINDING_TYPES.NOISE_CONFLICT,
  );
  const tvStart = events.find(
    (e) =>
      e.type === SIMULATION_EVENT_TYPES.SCHEDULE_START &&
      e.activity === "watchTv",
  );
  if (noiseFinding || tvStart) {
    const overlapMin = noiseFinding?.evidence?.overlapWindow?.[0];
    const noiseSec = Number.isFinite(Number(overlapMin))
      ? Number(overlapMin) * 60
      : tvStart?.timestamp ?? startSec + 3600;
    if (noiseSec >= startSec && noiseSec <= endSec) {
      pushCheckpoint({
        type: DEMO_CHECKPOINT_TYPES.TV_NOISE_CONFLICT,
        label: "TV / WFH Noise",
        timestampSeconds: noiseSec,
        roomId: noiseFinding?.roomId ?? "living-room",
        description: "Living-room TV audio overlaps quiet WFH call or desk homework.",
      });
    }
  }

  return checkpoints.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}
