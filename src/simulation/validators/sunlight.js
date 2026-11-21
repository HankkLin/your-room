import { FINDING_TYPES } from "../../contracts/simulation.js";
import {
  deriveWallsFromRooms,
  isFinitePoint2D,
  projectPointOnSegment,
} from "../../spatial/floorplan-geometry.js";
import {
  checkSightline,
  extractBlockingSegments,
  listSemanticEntities,
  raySegmentIntersection,
} from "./sightline.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Optional Deterministic Sunlight / Glare Validator (Task 3A §23).
 *
 * Azimuth convention:
 * - 0° = North (-Z), 90° = East (+X), 180° = South (+Z), 270° = West (-X).
 * - Evaluates whether direct solar rays enter through `house.windows` (checking
 *   both 2D horizontal window aperture and vertical sill/head elevation bounds)
 *   and strike glare-sensitive targets (`desk`, `tv`) without interior occlusion.
 *
 * Accepts explicit `sun` parameters; never fetches external weather or location APIs.
 *
 * @param {object} params
 * @param {object} params.house
 * @param {{ azimuthDegrees: number, elevationDegrees: number }} params.sun
 */
export function validateSunlight({ house, sun } = {}) {
  if (!house || !sun || typeof sun !== "object") {
    return { findings: [], hits: [] };
  }

  const azimuthDegrees = Number(sun.azimuthDegrees);
  const elevationDegrees = Number(sun.elevationDegrees);
  if (
    !Number.isFinite(azimuthDegrees) ||
    !Number.isFinite(elevationDegrees) ||
    elevationDegrees <= 1 ||
    elevationDegrees >= 85
  ) {
    return { findings: [], hits: [] };
  }

  const windows = Array.isArray(house.windows)
    ? house.windows.filter((w) => w && isFinitePoint2D(w.position))
    : [];
  if (windows.length === 0) {
    return { findings: [], hits: [] };
  }

  const entities = listSemanticEntities(house);
  const targets = entities.filter(
    (e) => e.semanticType === "desk" || e.semanticType === "tv",
  );
  if (targets.length === 0) {
    return { findings: [], hits: [] };
  }

  const walls =
    Array.isArray(house.walls) && house.walls.length > 0
      ? house.walls
      : deriveWallsFromRooms(house.rooms || [], [], house.ceilingHeight ?? 2.7);

  // Build 2D segments for each window aperture
  const windowApertures = windows.map((win) => {
    let tx = 1;
    let tz = 0;
    for (const wall of walls) {
      if (!isFinitePoint2D(wall.start) || !isFinitePoint2D(wall.end)) continue;
      const proj = projectPointOnSegment(win.position, wall.start, wall.end);
      if (win.wallId === wall.id || proj.distance <= 0.25) {
        const dx = wall.end[0] - wall.start[0];
        const dz = wall.end[1] - wall.start[1];
        const len = Math.hypot(dx, dz) || 1;
        tx = dx / len;
        tz = dz / len;
        break;
      }
    }
    const halfW = Math.max(0.25, (Number(win.width) || 1.2) / 2);
    return {
      id: win.id,
      roomId: win.roomId ?? null,
      sillHeight: Number(win.sillHeight ?? 0.9),
      headHeight: Number(win.headHeight ?? 2.15),
      start: [win.position[0] - tx * halfW, win.position[1] - tz * halfW],
      end: [win.position[0] + tx * halfW, win.position[1] + tz * halfW],
    };
  });

  const azRad = (azimuthDegrees * Math.PI) / 180;
  const elevRad = (elevationDegrees * Math.PI) / 180;
  const tanElev = Math.tan(elevRad);

  // Unit vector pointing FROM target TOWARD the sun on the X/Z plane
  const toSunX = Math.sin(azRad);
  const toSunZ = -Math.cos(azRad);
  const maxRayLength = 60;

  const baseOpaqueSegments = extractBlockingSegments(house, {
    minBlockingHeight: 0.95,
    carveWindows: true,
  });

  const findings = [];
  const hits = [];

  for (const target of targets) {
    const targetSurfaceHeight =
      target.semanticType === "desk"
        ? Math.max(0.75, target.dimensions.height)
        : Math.max(1.0, target.dimensions.height * 0.85);

    const rayFar = [
      target.center[0] + toSunX * maxRayLength,
      target.center[1] + toSunZ * maxRayLength,
    ];

    for (const win of windowApertures) {
      const hit = raySegmentIntersection(
        target.center,
        rayFar,
        win.start,
        win.end,
      );
      if (!hit || hit.t <= 0) continue;

      const winHitPt = [
        target.center[0] + (rayFar[0] - target.center[0]) * hit.t,
        target.center[1] + (rayFar[1] - target.center[1]) * hit.t,
      ];
      const distToWindow = Math.hypot(
        winHitPt[0] - target.center[0],
        winHitPt[1] - target.center[1],
      );

      // Vertical check: solar ray passing through window aperture height [sill..head]
      const rayHeightAtWindow = targetSurfaceHeight + distToWindow * tanElev;
      if (
        rayHeightAtWindow < win.sillHeight - 0.05 ||
        rayHeightAtWindow > win.headHeight + 0.05
      ) {
        continue;
      }

      // Check interior occlusion between target and window
      const sight = checkSightline({
        house,
        observer: target.center,
        target: winHitPt,
        blockingSegments: baseOpaqueSegments.filter(
          (s) => s.objectId !== target.id,
        ),
      });
      if (sight.occluded) continue;

      // Low-angle direct sun (10°–35°) causes stronger screen/desk glare than high sun
      const lowAngleFactor = clamp((55 - elevationDegrees) / 45, 0.3, 1.0);
      const severity = round2(clamp(0.45 + 0.45 * lowAngleFactor, 0.35, 0.92));

      const record = {
        targetObjectId: target.id,
        targetType: target.semanticType,
        windowId: win.id,
        roomId: target.roomId ?? win.roomId,
        distanceMeters: round2(distToWindow),
        azimuthDegrees: round1(azimuthDegrees),
        elevationDegrees: round1(elevationDegrees),
      };
      hits.push(record);

      findings.push({
        type: FINDING_TYPES.SUN_GLARE,
        severity,
        roomId: record.roomId,
        location: {
          roomId: record.roomId,
          position: target.center,
        },
        evidence: record,
      });
      break; // One direct glare finding per target
    }
  }

  return { findings, hits };
}
