// Wire evidence allowlists for Studio replay and the whole-home spatial validators.
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const pair = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);
const strings = value => Array.isArray(value) && value.length <= 32 && Array.from(value).every(text);
const boolean = value => typeof value === "boolean";

const tvEvidence = {
  viewerObjectId: text, viewerType: text, tvObjectId: text, distanceMeters: nonnegative,
  viewingAngleDegrees: nonnegative, screenOffAxisDegrees: nonnegative, seatTurnDegrees: nonnegative,
  occluded: boolean, blockingObjectIds: strings,
};
const schemas = {
  NO_PATH: { timestampSeconds: nonnegative, reason: text },
  LONG_PATH: { timestampSeconds: nonnegative, distanceMeters: nonnegative, thresholdMeters: nonnegative },
  CONGESTION: { agentCount: nonnegative, durationSeconds: nonnegative, minimumClearanceMeters: nonnegative,
    startTimestamp: nonnegative, endTimestamp: nonnegative },
  PRIVACY_SIGHTLINE: { sourceType: text, sourceId: text, targetType: text, targetObjectId: text,
    distanceMeters: nonnegative, directLineOfSight: boolean, occluded: boolean },
  TV_OCCLUDED: tvEvidence,
  TV_BAD_ANGLE: { ...tvEvidence, maxViewingAngleDegrees: nonnegative },
  TV_TOO_FAR: { ...tvEvidence, maxDistanceMeters: nonnegative },
  NOISE_CONFLICT: { workerAgentId: text, sourceAgentId: text, sourceType: text, distanceMeters: nonnegative,
    wallsCrossed: nonnegative, overlapMinutes: nonnegative, estimatedLevel: nonnegative, levelScale: text },
  SUN_GLARE: { targetObjectId: text, targetType: text, windowId: text, distanceMeters: nonnegative,
    azimuthDegrees: Number.isFinite, elevationDegrees: Number.isFinite },
  NO_EVACUATION_PATH: { reason: text },
  LONG_EVACUATION_ROUTE: { exitDoorId: text, distanceMeters: nonnegative, estimatedSeconds: nonnegative,
    maxSafeDistanceMeters: nonnegative, maxSafeSeconds: nonnegative },
  EVACUATION_BOTTLENECK: { exitDoorId: text, exitDoorWidthMeters: nonnegative, convergingAgentCount: nonnegative,
    collisionCountNearExit: nonnegative, estimatedQueueDelaySeconds: nonnegative },
  ACCESSIBILITY_CLEARANCE_FAIL: { measuredWidthMeters: nonnegative, requiredWidthMeters: nonnegative, wheelchairWidthMeters: nonnegative },
  ACCESSIBILITY_TURN_RADIUS_FAIL: { measuredTurnDiameterMeters: nonnegative, requiredTurnDiameterMeters: nonnegative },
  ACCESSIBILITY_ROUTE_BLOCKED: { wheelchairWidthMeters: nonnegative },
};
const screenSize = { modeledTvWidthMeters: nonnegative, apparentScreenAngleDegrees: nonnegative, minScreenAngleDegrees: nonnegative };
const optional = {
  TV_OCCLUDED: screenSize,
  TV_BAD_ANGLE: screenSize,
  TV_TOO_FAR: screenSize,
  LONG_PATH: { doorsTraversed: strings },
  CONGESTION: { agentIds: strings },
  PRIVACY_SIGHTLINE: { observerPosition: pair, targetPosition: pair, exposedSources: strings },
  NOISE_CONFLICT: { sourceRoomId: text, receiverRoomId: text, overlapWindowMinutes: pair },
  SUN_GLARE: { roomId: text },
  NO_EVACUATION_PATH: { fromRoomId: text, candidateExitDoorIds: strings },
  LONG_EVACUATION_ROUTE: { fromRoomId: text },
  EVACUATION_BOTTLENECK: { agentIds: strings },
  ACCESSIBILITY_CLEARANCE_FAIL: { doorId: text, agentIds: strings },
  ACCESSIBILITY_TURN_RADIUS_FAIL: { roomId: text, agentIds: strings },
  ACCESSIBILITY_ROUTE_BLOCKED: { fromRoomId: text, toRoomId: text, exitDoorId: text, blockingDoorId: text, reason: text, ableBodiedReachable: boolean, agentIds: strings },
};

export function isRegionFinding(finding, [left, top, right, bottom], roomIds) {
  const location = finding?.rawLocation ?? finding?.location;
  const evidence = finding?.evidence ?? {};
  const positions = [location?.position, evidence.observerPosition, evidence.targetPosition];
  return positions.some(p => pair(p) && p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom)
    || [finding?.roomId, location?.roomId, finding?.fromRoomId, finding?.toRoomId,
      evidence.fromRoomId, evidence.sourceRoomId, evidence.receiverRoomId].some(id => roomIds.has(id));
}

export function measuredFinding(finding) {
  const { type, severity, roomId, fromRoomId, toRoomId, agentId, evidence } = finding || {};
  const location = finding?.rawLocation ?? finding?.location;
  const position = location?.position;
  const invalid = () => new Error("A regional finding is missing measured replay evidence.");
  if (!Object.hasOwn(schemas, type) || !nonnegative(severity) || severity > 1 || !evidence ||
      (position != null && !pair(position)) ||
      [roomId, location?.roomId, fromRoomId, toRoomId, agentId].some(id => id != null && !text(id))) throw invalid();
  const measured = {};
  for (const [key, validate] of Object.entries(schemas[type])) {
    if (!validate(evidence[key])) throw invalid();
    measured[key] = evidence[key];
  }
  for (const [key, validate] of Object.entries(optional[type] || {})) {
    if (evidence[key] == null) continue;
    if (!validate(evidence[key])) throw invalid();
    measured[key] = evidence[key];
  }
  return { type, severity, roomId: roomId ?? null, fromRoomId: fromRoomId ?? null, toRoomId: toRoomId ?? null,
    ...(agentId ? { agentId } : {}), location: { roomId: location?.roomId ?? null, ...(position ? { position } : {}) },
    evidence: measured };
}
