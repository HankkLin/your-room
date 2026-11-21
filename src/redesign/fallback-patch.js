import { toSceneObject } from "../contracts/scene.js";
import { formatFindingTag } from "../contracts/scene-patch.js";
import { FINDING_TYPES } from "../contracts/simulation.js";
import { polygonBounds } from "../spatial/floorplan-geometry.js";
import { importSampleFloorplan } from "../spatial/floorplan-importer.js";
import { validateScenePatch } from "./validate-scene-patch.js";

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Create the bundled multi-room demo house furnished with movable furniture,
 * including a movable breakfast table & chair crowding the northern kitchen
 * sink/stove prep triangle during the 07:00–09:00 Morning Routine.
 */
export function createRedesignDemoHouse() {
  const { house } = importSampleFloorplan();
  const furnished = structuredClone(house);

  furnished.objects = [
    toSceneObject({
      id: "kitchen-table-1",
      type: "existing",
      kind: "table",
      name: "Breakfast Bistro Table",
      roomId: "kitchen",
      owned: true,
      locked: false,
      position: [7.25, 0, 1.35],
      rotation: [0, 0, 0],
      dimensions: { width: 0.86, height: 0.75, depth: 0.64 },
    }),
    toSceneObject({
      id: "kitchen-chair-1",
      type: "existing",
      kind: "chair",
      name: "Kitchen Café Chair",
      roomId: "kitchen",
      owned: true,
      locked: false,
      position: [6.5, 0, 1.35],
      rotation: [0, Math.PI / 2, 0],
      dimensions: { width: 0.52, height: 0.82, depth: 0.52 },
    }),
    toSceneObject({
      id: "living-sofa-1",
      type: "existing",
      kind: "sofa",
      name: "Linen Sofa",
      roomId: "living-room",
      owned: true,
      locked: false,
      position: [2.9, 0, 3.25],
      rotation: [0, Math.PI, 0],
      dimensions: { width: 2.2, height: 0.86, depth: 0.96 },
    }),
    toSceneObject({
      id: "living-tv-1",
      type: "existing",
      kind: "tv",
      name: "Wall-Stand TV",
      roomId: "living-room",
      owned: true,
      locked: false,
      position: [2.9, 0, 0.3],
      rotation: [0, 0, 0],
      dimensions: { width: 1.25, height: 1.15, depth: 0.2 },
    }),
    toSceneObject({
      id: "bedroom-bed-1",
      type: "existing",
      kind: "bed",
      name: "Primary Bed",
      roomId: "bedroom",
      owned: true,
      locked: false,
      position: [1.65, 0, 7.25],
      rotation: [0, 0, 0],
      dimensions: { width: 1.65, height: 0.92, depth: 2.05 },
    }),
    toSceneObject({
      id: "living-plant-1",
      type: "existing",
      kind: "plant",
      name: "Potted Olive Tree",
      roomId: "living-room",
      owned: true,
      locked: false,
      position: [0.65, 0, 0.65],
      rotation: [0, 0, 0],
      dimensions: { width: 0.48, height: 1.54, depth: 0.48 },
    }),
  ];

  return furnished;
}

function generateRoomCandidateSpots(room) {
  const b = polygonBounds(room.polygon);
  const spots = [];
  // Prefer spacious corners and edges clear of wall counters, fixtures & doors
  for (let zFrac of [0.82, 0.76, 0.86, 0.7, 0.62, 0.25, 0.16]) {
    for (let xFrac of [0.46, 0.52, 0.4, 0.58, 0.34, 0.65, 0.24, 0.18]) {
      spots.push([
        round2(b.minX + b.width * xFrac),
        0,
        round2(b.minZ + b.depth * zFrac),
      ]);
    }
  }
  return spots;
}

/**
 * Build a known-safe, clearly labeled deterministic fallback `ScenePatch`
 * when Gemini is offline, unconfigured, or exhausts retries.
 *
 * Every fallback candidate is verified with `validateScenePatch` before being returned.
 *
 * @param {object} params
 * @param {object} params.house
 * @param {object} [params.evaluation]
 * @returns {object | null}
 */
export function buildFallbackScenePatch({ house, evaluation } = {}) {
  if (!house || !Array.isArray(house.rooms)) return null;

  const findings = evaluation?.findings || [];
  const kitchenCongestion = findings.find(
    (f) => f.type === FINDING_TYPES.CONGESTION && f.roomId === "kitchen",
  );
  const anyCongestion =
    kitchenCongestion ||
    findings.find((f) => f.type === FINDING_TYPES.CONGESTION);

  if (anyCongestion) {
    const targetRoomId = anyCongestion.roomId || "kitchen";
    const room = house.rooms.find((r) => r.id === targetRoomId);
    if (room) {
      const movableInRoom = (house.objects || []).filter(
        (o) =>
          o &&
          !o.locked &&
          o.type !== "fixed" &&
          o.roomId === targetRoomId &&
          (o.kind === "table" || o.kind === "chair"),
      );

      const candidateSpots = generateRoomCandidateSpots(room);

      // Case 1: Relocate existing movable table/chair out of congested prep zone
      if (movableInRoom.length > 0) {
        const primary =
          movableInRoom.find((o) => o.kind === "table") || movableInRoom[0];
        const secondary = movableInRoom.find(
          (o) => o.id !== primary.id && o.kind === "chair",
        );

        // Look for an away-from-fixture spot first by sorting candidateSpots farthest from kitchen stove/sink
        const roomBounds = polygonBounds(room.polygon);
        const roomCenter = [
          (roomBounds.minX + roomBounds.maxX) / 2,
          (roomBounds.minZ + roomBounds.maxZ) / 2,
        ];
        const prepFixtures = (house.fixtures || []).filter(
          (f) =>
            f.roomId === targetRoomId &&
            (f.kind === "stove" || f.kind === "sink"),
        );
        const primaryCookFixture =
          prepFixtures.find((f) => f.kind === "sink") || prepFixtures[0] || null;
        const cookStandEstimate = primaryCookFixture
          ? [
              (primaryCookFixture.position?.[0] ?? primaryCookFixture.x ?? 0) +
                (roomCenter[0] -
                  (primaryCookFixture.position?.[0] ?? primaryCookFixture.x ?? 0)) *
                  0.45,
              (primaryCookFixture.position?.[2] ?? primaryCookFixture.z ?? 0) +
                (roomCenter[1] -
                  (primaryCookFixture.position?.[2] ?? primaryCookFixture.z ?? 0)) *
                  0.45,
            ]
          : null;
        const sortedSpots = [...candidateSpots].sort((a, b) => {
          if (!cookStandEstimate) return 0;
          const distToCook = (pt) =>
            Math.hypot(pt[0] - cookStandEstimate[0], pt[2] - cookStandEstimate[1]);
          return distToCook(b) - distToCook(a);
        });

        let firstValidPatch = null;
        let bestSingleMovePatch = null;

        for (const spot of sortedSpots) {
          for (const tableYaw of [0, round2(Math.PI / 2)]) {
            const rawTableW = Number(primary.dimensions?.width ?? primary.width ?? 0.86);
            const rawTableD = Number(primary.dimensions?.depth ?? primary.depth ?? 0.64);
            const rotated = Math.abs(tableYaw) > 0.5;
            const tableHalfW = (rotated ? rawTableD : rawTableW) / 2;
            const tableHalfD = (rotated ? rawTableW : rawTableD) / 2;
            const chairHalfD = Number(secondary?.dimensions?.depth ?? secondary?.depth ?? 0.56) / 2;
            const gapX = round2(tableHalfW + chairHalfD + 0.08);
            const gapZ = round2(tableHalfD + chairHalfD + 0.08);

            const secondaryOffsets = [
              [0, gapZ, round2(Math.PI)],
              [0, -gapZ, 0],
              [-gapX, 0, round2(Math.PI / 2)],
              [gapX, 0, round2(-Math.PI / 2)],
            ].sort((oA, oB) => {
              if (!cookStandEstimate) return 0;
              const dA = Math.hypot(
                spot[0] + oA[0] - cookStandEstimate[0],
                spot[2] + oA[1] - cookStandEstimate[1],
              );
              const dB = Math.hypot(
                spot[0] + oB[0] - cookStandEstimate[0],
                spot[2] + oB[1] - cookStandEstimate[1],
              );
              return dB - dA;
            });

            const offsetCandidates = secondary ? secondaryOffsets : [[0, 0, 0]];
            for (const [dx, dz, chairYaw] of offsetCandidates) {
              const chairPos = secondary
                ? [round2(spot[0] + dx), 0, round2(spot[2] + dz)]
                : spot;
              const ops = [
                {
                  type: "move",
                  objectId: primary.id,
                  position: spot,
                  rotation: [0, tableYaw, 0],
                },
              ];
              if (secondary) {
                ops.push({
                  type: "move",
                  objectId: secondary.id,
                  position: chairPos,
                  rotation: [0, chairYaw, 0],
                });
              }

              const candidatePatch = {
                id: "fallback-patch-kitchen-clearance",
                isFallback: true,
                source: "deterministic_fallback",
                reasoning:
                  "Deterministic fallback: relocate movable breakfast furniture away from the kitchen prep zone to separate cooking and dining circulation.",
                targetFindings: [formatFindingTag(anyCongestion)],
                operations: ops,
              };

              if (validateScenePatch(house, candidatePatch).valid) {
                if (!firstValidPatch) firstValidPatch = candidatePatch;
                const standDist = cookStandEstimate
                  ? Math.hypot(
                      chairPos[0] - cookStandEstimate[0],
                      chairPos[2] - cookStandEstimate[1],
                    )
                  : 99;
                if (standDist >= 1.95) {
                  return candidatePatch;
                }
              }
            }

            // If room is too compact for both table + lounge chair side-by-side in the clear corner,
            // also consider removing the extra chair while relocating the breakfast table cleanly.
            if (secondary && !bestSingleMovePatch) {
              const standDist = cookStandEstimate
                ? Math.hypot(
                    spot[0] - cookStandEstimate[0],
                    spot[2] - cookStandEstimate[1],
                  )
                : 99;
              if (standDist >= 1.9) {
                const compactOps = [
                  {
                    type: "move",
                    objectId: primary.id,
                    position: spot,
                    rotation: [0, tableYaw, 0],
                  },
                  {
                    type: "remove",
                    objectId: secondary.id,
                  },
                ];
                const compactPatch = {
                  id: "fallback-patch-kitchen-compact",
                  isFallback: true,
                  source: "deterministic_fallback",
                  reasoning:
                    "Deterministic fallback: relocate breakfast table to the clear corner and remove the oversized café chair crowding the prep zone.",
                  targetFindings: [formatFindingTag(anyCongestion)],
                  operations: compactOps,
                };
                if (validateScenePatch(house, compactPatch).valid) {
                  bestSingleMovePatch = compactPatch;
                }
              }
            }
          }
        }
        if (bestSingleMovePatch) return bestSingleMovePatch;
        if (firstValidPatch) return firstValidPatch;
      }

      // Case 2: Unfurnished room with shared-fixture congestion -> place compact breakfast table in clear corner
      for (const spot of candidateSpots) {
        const addPatch = {
          id: "fallback-patch-dining-zone",
          isFallback: true,
          source: "deterministic_fallback",
          reasoning:
            "Deterministic fallback: add a compact breakfast table in the clear southern dining corner so eating and stove/sink prep no longer crowd the same work triangle.",
          targetFindings: [formatFindingTag(anyCongestion)],
          operations: [
            {
              type: "add",
              objectId: "fallback-breakfast-table",
              position: spot,
              rotation: [0, 0, 0],
              object: {
                id: "fallback-breakfast-table",
                kind: "table",
                name: "Compact Breakfast Table",
                roomId: targetRoomId,
                dimensions: { width: 0.78, height: 0.74, depth: 0.62 },
              },
            },
          ],
        };
        if (validateScenePatch(house, addPatch).valid) {
          return addPatch;
        }
      }
    }
  }

  return null;
}
