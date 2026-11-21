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
  // Prefer spacious south-central / south-west dining spots clear of east wall counters & north fixtures
  for (let zFrac of [0.82, 0.76, 0.86, 0.7, 0.62]) {
    for (let xFrac of [0.46, 0.52, 0.4, 0.58, 0.34, 0.65]) {
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

        for (const spot of candidateSpots) {
          const secondaryOffsets = [
            [-0.72, 0, round2(Math.PI / 2)],
            [0.72, 0, round2(-Math.PI / 2)],
            [0, 0.68, round2(Math.PI)],
            [0, -0.68, 0],
          ];

          const offsetCandidates = secondary ? secondaryOffsets : [[0, 0, 0]];
          for (const [dx, dz, chairYaw] of offsetCandidates) {
            const ops = [
              {
                type: "move",
                objectId: primary.id,
                position: spot,
                rotation: [0, 0, 0],
              },
            ];
            if (secondary) {
              ops.push({
                type: "move",
                objectId: secondary.id,
                position: [round2(spot[0] + dx), 0, round2(spot[2] + dz)],
                rotation: [0, chairYaw, 0],
              });
            }

            const candidatePatch = {
              id: "fallback-patch-kitchen-clearance",
              isFallback: true,
              source: "deterministic_fallback",
              reasoning:
                "Deterministic fallback: relocate movable breakfast furniture away from the northern kitchen prep zone to separate cooking and dining circulation.",
              targetFindings: [formatFindingTag(anyCongestion)],
              operations: ops,
            };

            if (validateScenePatch(house, candidatePatch).valid) {
              return candidatePatch;
            }
          }
        }
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
