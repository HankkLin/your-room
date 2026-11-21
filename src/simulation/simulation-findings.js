import { FINDING_TYPES } from "../contracts/simulation.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

export function createNoPathFinding({
  agentId,
  activity,
  fromRoomId,
  toRoomId,
  position,
  timestampSeconds,
  reason = "NO_PATH",
}) {
  return {
    type: FINDING_TYPES.NO_PATH,
    severity: 1,
    agentId,
    activity,
    fromRoomId: fromRoomId ?? null,
    toRoomId: toRoomId ?? null,
    roomId: toRoomId ?? fromRoomId ?? null,
    location: {
      roomId: fromRoomId ?? null,
      position: position ? [round3(position[0]), round3(position[1])] : [0, 0],
    },
    evidence: {
      timestampSeconds,
      minute: round2(timestampSeconds / 60),
      reason,
    },
  };
}

export function createLongPathFinding({
  agentId,
  activity,
  fromRoomId,
  toRoomId,
  distanceMeters,
  thresholdMeters,
  doorsTraversed,
  goalPosition,
  timestampSeconds,
}) {
  const ratio = (distanceMeters - thresholdMeters) / Math.max(5, thresholdMeters);
  const severity = round2(clamp(0.35 + ratio * 0.45, 0.25, 0.95));

  return {
    type: FINDING_TYPES.LONG_PATH,
    severity,
    agentId,
    activity,
    fromRoomId: fromRoomId ?? null,
    toRoomId: toRoomId ?? null,
    roomId: toRoomId ?? null,
    distanceMeters: round2(distanceMeters),
    location: {
      roomId: toRoomId ?? null,
      position: goalPosition
        ? [round3(goalPosition[0]), round3(goalPosition[1])]
        : [0, 0],
    },
    evidence: {
      distanceMeters: round2(distanceMeters),
      thresholdMeters: round2(thresholdMeters),
      doorsTraversed: [...(doorsTraversed || [])],
      timestampSeconds,
    },
  };
}

export function createCongestionFinding({
  roomId,
  position,
  agentCount,
  agentIds,
  durationSeconds,
  minimumClearanceMeters,
  startTimestamp,
  endTimestamp,
}) {
  const durationScore = clamp(durationSeconds / 600, 0.1, 1);
  const densityScore = clamp((agentCount - 1) / 3, 0.2, 1);
  const tightnessScore = clamp((1.2 - minimumClearanceMeters) / 1.2, 0.1, 1);
  const severity = round2(
    clamp(
      0.35 * durationScore + 0.3 * densityScore + 0.35 * tightnessScore,
      0.2,
      1.0,
    ),
  );

  return {
    type: FINDING_TYPES.CONGESTION,
    roomId: roomId ?? null,
    location: {
      roomId: roomId ?? null,
      position: [round2(position[0]), round2(position[1])],
    },
    severity,
    evidence: {
      agentCount,
      agentIds: [...agentIds],
      durationSeconds,
      minimumClearanceMeters: round2(minimumClearanceMeters),
      startTimestamp,
      endTimestamp,
      startMinute: round2(startTimestamp / 60),
      endMinute: round2(endTimestamp / 60),
    },
  };
}
