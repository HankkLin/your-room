import { FINDING_TYPES } from "../../contracts/simulation.js";
import {
  isFinitePoint2D,
  polygonBounds,
} from "../../spatial/floorplan-geometry.js";
import {
  checkSightline,
  extractBlockingSegments,
  listSemanticEntities,
} from "./sightline.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

const TARGET_SENSITIVITY = {
  toilet: 1.0,
  shower: 0.92,
  bathtub: 0.88,
  bed: 0.84,
};

const SOURCE_WEIGHT = {
  "entry-door": 1.0,
  "living-room": 0.86,
  hallway: 0.78,
};

function roomCenter(room) {
  const b = polygonBounds(room.polygon);
  return [round3((b.minX + b.maxX) / 2), round3((b.minZ + b.maxZ) / 2)];
}

function collectSensitiveObservers(house) {
  const observers = [];
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const doors = Array.isArray(house?.doors) ? house.doors : [];

  for (const door of doors) {
    if (!door || door.kind !== "exterior") continue;
    if (door.closed === true || door.blocked === true) continue;
    if (!isFinitePoint2D(door.position)) continue;
    observers.push({
      sourceType: "entry-door",
      sourceId: door.id,
      roomId: door.roomA ?? null,
      position: [round3(door.position[0]), round3(door.position[1])],
    });
  }

  for (const room of rooms) {
    if (!Array.isArray(room?.polygon) || room.polygon.length < 3) continue;
    if (room.kind === "hallway") {
      observers.push({
        sourceType: "hallway",
        sourceId: room.id,
        roomId: room.id,
        position: roomCenter(room),
      });
    } else if (room.kind === "living" || room.kind === "dining") {
      observers.push({
        sourceType: "living-room",
        sourceId: room.id,
        roomId: room.id,
        position: roomCenter(room),
      });
    }
  }

  return observers;
}

/**
 * Deterministic Privacy Sightline Validator (Task 3A §5–7).
 *
 * Evaluates whether sensitive viewpoints (exterior entry doors, hallways,
 * public living areas) have unobstructed 2D sightlines to sensitive targets
 * (`toilet`, `shower`, `bathtub`, `bed`) that actually exist in `house`.
 *
 * Severity formula:
 * `severity = clamp(targetWeight * sourceWeight * (0.65 + 0.35 * distanceFactor), 0.25, 0.98)`
 * where `distanceFactor = clamp(1 - (distance - 2.0) / 18.0, 0.45, 1.0)`.
 *
 * @param {object} params
 * @param {object} params.house
 */
export function validatePrivacySightlines({ house } = {}) {
  if (!house || typeof house !== "object") {
    return { findings: [], checks: [] };
  }

  const entities = listSemanticEntities(house);
  const sensitiveTargets = entities.filter((e) =>
    Object.hasOwn(TARGET_SENSITIVITY, e.semanticType),
  );

  // Never fabricate privacy findings if no sensitive targets exist in the house
  if (sensitiveTargets.length === 0) {
    return { findings: [], checks: [] };
  }

  const observers = collectSensitiveObservers(house);
  const baseBlocking = extractBlockingSegments(house, {
    minBlockingHeight: 1.1,
  });

  const checks = [];
  const exposuresByTarget = new Map();

  for (const target of sensitiveTargets) {
    const filteredSegments = baseBlocking.filter(
      (seg) => seg.objectId !== target.id,
    );

    for (const obs of observers) {
      // Skip room-center -> target checks when both are inside the same room
      if (
        obs.sourceType !== "entry-door" &&
        obs.roomId &&
        target.roomId &&
        obs.roomId === target.roomId
      ) {
        continue;
      }

      const sight = checkSightline({
        house,
        observer: obs.position,
        target: target.center,
        blockingSegments: filteredSegments,
      });

      const checkRecord = {
        sourceType: obs.sourceType,
        sourceId: obs.sourceId,
        targetType: target.semanticType,
        targetObjectId: target.id,
        roomId: target.roomId,
        observerPosition: obs.position,
        targetPosition: target.center,
        distanceMeters: sight.distanceMeters,
        visible: sight.visible,
        occluded: sight.occluded,
        blockingObjectIds: sight.blockingObjectIds,
      };
      checks.push(checkRecord);

      if (!sight.visible) continue;

      const tWeight = TARGET_SENSITIVITY[target.semanticType] ?? 0.8;
      const sWeight = SOURCE_WEIGHT[obs.sourceType] ?? 0.75;
      const distFactor = clamp(
        1 - (sight.distanceMeters - 2.0) / 18.0,
        0.45,
        1.0,
      );
      const severity = round2(
        clamp(tWeight * sWeight * (0.65 + 0.35 * distFactor), 0.25, 0.98),
      );

      if (!exposuresByTarget.has(target.id)) {
        exposuresByTarget.set(target.id, []);
      }
      exposuresByTarget.get(target.id).push({
        ...checkRecord,
        severity,
      });
    }
  }

  const findings = [];
  for (const [, exposures] of exposuresByTarget.entries()) {
    exposures.sort((a, b) => b.severity - a.severity);
    const worst = exposures[0];
    const exposedSources = [
      ...new Set(exposures.map((item) => item.sourceType)),
    ];

    findings.push({
      type: FINDING_TYPES.PRIVACY_SIGHTLINE,
      severity: worst.severity,
      roomId: worst.roomId,
      location: {
        roomId: worst.roomId,
        position: worst.targetPosition,
      },
      evidence: {
        sourceType: worst.sourceType,
        sourceId: worst.sourceId,
        targetType: worst.targetType,
        targetObjectId: worst.targetObjectId,
        observerPosition: worst.observerPosition,
        targetPosition: worst.targetPosition,
        distanceMeters: worst.distanceMeters,
        directLineOfSight: true,
        occluded: false,
        exposedSources,
      },
    });
  }

  return { findings, checks };
}
