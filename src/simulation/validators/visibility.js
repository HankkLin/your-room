import { FINDING_TYPES } from "../../contracts/simulation.js";
import { checkSightline, listSemanticEntities } from "./sightline.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function angleBetweenDegrees(u, v) {
  const uLen = Math.hypot(u[0], u[1]);
  const vLen = Math.hypot(v[0], v[1]);
  if (uLen < 1e-6 || vLen < 1e-6) return 0;
  const dot = clamp((u[0] * v[0] + u[1] * v[1]) / (uLen * vLen), -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Deterministic TV Visibility Validator (Task 3A §8–9).
 *
 * Evaluates distance, viewing angle (both TV screen off-axis angle and explicit
 * seating orientation), and 2D sightline occlusion (ignoring low coffee tables
 * `< minBlockingHeight`) between seating (`sofa`, `chair`) and TVs (`tv`).
 *
 * Safely skips and returns empty findings when no TV exists in `house`.
 *
 * @param {object} params
 * @param {object} params.house
 * @param {number} [params.maxViewingAngleDegrees=45]
 * @param {number} [params.maxDistanceMeters=4.8]
 * @param {number} [params.minBlockingHeight=0.95]
 */
export function validateTvVisibility({
  house,
  maxViewingAngleDegrees = 45,
  maxDistanceMeters = 4.8,
  minBlockingHeight = 0.95,
} = {}) {
  if (!house || typeof house !== "object") {
    return { findings: [], evaluations: [] };
  }

  const entities = listSemanticEntities(house);
  const tvs = entities.filter((e) => e.semanticType === "tv");
  if (tvs.length === 0) {
    return { findings: [], evaluations: [] };
  }

  const seats = entities.filter(
    (e) => e.semanticType === "sofa" || e.semanticType === "chair",
  );
  if (seats.length === 0) {
    return { findings: [], evaluations: [] };
  }

  const findings = [];
  const evaluations = [];

  for (const tv of tvs) {
    // Prefer seats in the same room as the TV; if roomId is unset, evaluate all seats
    const candidateSeats = tv.roomId
      ? seats.filter((s) => !s.roomId || s.roomId === tv.roomId)
      : seats;
    const relevantSeats = candidateSeats.length > 0 ? candidateSeats : seats;

    for (const seat of relevantSeats) {
      const viewerToTv = [
        tv.center[0] - seat.center[0],
        tv.center[1] - seat.center[1],
      ];
      const tvToViewer = [-viewerToTv[0], -viewerToTv[1]];

      const screenOffAxisDeg = angleBetweenDegrees(tv.facing, tvToViewer);
      const seatTurnDeg = seat.hasExplicitOrientation
        ? angleBetweenDegrees(seat.facing, viewerToTv)
        : 0;
      const viewingAngleDegrees = round1(
        Math.max(screenOffAxisDeg, seatTurnDeg),
      );

      const sight = checkSightline({
        house,
        observer: seat.center,
        target: tv.center,
        minBlockingHeight,
        excludeIds: [seat.id, tv.id],
      });

      const baseEvidence = {
        viewerObjectId: seat.id,
        viewerType: seat.semanticType,
        tvObjectId: tv.id,
        distanceMeters: round2(sight.distanceMeters),
        viewingAngleDegrees,
        screenOffAxisDegrees: round1(screenOffAxisDeg),
        seatTurnDegrees: round1(seatTurnDeg),
        occluded: sight.occluded,
        blockingObjectIds: sight.blockingObjectIds,
      };

      const roomId = tv.roomId ?? seat.roomId ?? null;
      let usable = true;

      if (sight.occluded) {
        usable = false;
        findings.push({
          type: FINDING_TYPES.TV_OCCLUDED,
          severity: 0.84,
          roomId,
          location: {
            roomId,
            position: seat.center,
          },
          evidence: baseEvidence,
        });
      } else if (viewingAngleDegrees > maxViewingAngleDegrees) {
        usable = false;
        const excessRatio =
          (viewingAngleDegrees - maxViewingAngleDegrees) /
          Math.max(15, 135 - maxViewingAngleDegrees);
        const severity = round2(clamp(0.48 + excessRatio * 0.45, 0.45, 0.92));
        findings.push({
          type: FINDING_TYPES.TV_BAD_ANGLE,
          severity,
          roomId,
          location: {
            roomId,
            position: seat.center,
          },
          evidence: {
            ...baseEvidence,
            maxViewingAngleDegrees,
          },
        });
      } else if (sight.distanceMeters > maxDistanceMeters) {
        usable = false;
        const excessRatio =
          (sight.distanceMeters - maxDistanceMeters) / maxDistanceMeters;
        const severity = round2(clamp(0.38 + excessRatio * 0.42, 0.35, 0.85));
        findings.push({
          type: FINDING_TYPES.TV_TOO_FAR,
          severity,
          roomId,
          location: {
            roomId,
            position: seat.center,
          },
          evidence: {
            ...baseEvidence,
            maxDistanceMeters,
          },
        });
      }

      evaluations.push({
        ...baseEvidence,
        roomId,
        usable,
      });
    }
  }

  return { findings, evaluations };
}
