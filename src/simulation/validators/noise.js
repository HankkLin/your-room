import { FINDING_TYPES } from "../../contracts/simulation.js";
import { polygonBounds } from "../../spatial/floorplan-geometry.js";
import { normalizeSchedule } from "../schedule.js";
import { countPartitionsCrossed, listSemanticEntities } from "./sightline.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function isQuietFocusActivity(activity) {
  return /^(?:work|wfh|work[-_\s]?from[-_\s]?home|study|focus|call|meeting)$/i.test(
    String(activity || "").trim(),
  );
}

function classifyNoiseSourceActivity(activity) {
  const token = String(activity || "").trim();
  if (/^(?:watchtv|watch[_\s-]?tv|tv|television|media|music|speaker|gaming)$/i.test(token)) {
    return { sourceType: "tv", baseNoiseIndex: 76 };
  }
  if (/^(?:socialize|party|exercise|workout)$/i.test(token)) {
    return { sourceType: "social", baseNoiseIndex: 74 };
  }
  if (/^(?:cook|cooking|kitchen|blend)$/i.test(token)) {
    return { sourceType: "kitchen", baseNoiseIndex: 68 };
  }
  return null;
}

function resolveActivityPoint(entry, house, entities, preferredType) {
  if (entry.destination?.type === "position" && entry.destination.position) {
    return {
      roomId: entry.destination.roomId ?? null,
      position: [...entry.destination.position],
    };
  }
  const roomId = entry.destination?.roomId ?? null;
  if (preferredType && roomId) {
    const matched = entities.find(
      (e) => e.roomId === roomId && e.semanticType === preferredType,
    );
    if (matched) {
      return { roomId, position: [...matched.center] };
    }
  }
  const room = (house?.rooms ?? []).find((r) => r.id === roomId);
  if (room && Array.isArray(room.polygon) && room.polygon.length >= 3) {
    const b = polygonBounds(room.polygon);
    return {
      roomId,
      position: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2],
    };
  }
  return { roomId, position: [0, 0] };
}

/**
 * Simplified Deterministic WFH Noise Conflict Validator (Task 3A §10–12).
 *
 * Uses a documented 0–100 non-calibrated simulation noise index (`simulation_noise_index_0_100`,
 * NOT claimed as verified physical SPL dBA):
 *
 * `estimatedLevel = max(0, baseNoiseIndex - distanceAttenuation - wallAttenuation)`
 * where:
 * - `distanceAttenuation = 18 * log10(max(1, d)) + 1.1 * max(0, d - 1)`
 * - `wallAttenuation = wallsCrossed * wallPenaltyPerWall + openDoorwaysCrossed * (0.25 * wallPenaltyPerWall)`
 *
 * Evaluates conflicts strictly during overlapping schedule intervals.
 *
 * @param {object} params
 * @param {object} params.house
 * @param {Array<object>} [params.household=[]]
 * @param {number} [params.wallPenaltyPerWall=12]
 * @param {number} [params.conflictThreshold=40]
 */
export function validateNoiseConflicts({
  house,
  household = [],
  wallPenaltyPerWall = 12,
  conflictThreshold = 40,
} = {}) {
  if (!house || !Array.isArray(household) || household.length < 2) {
    return { findings: [], evaluations: [] };
  }

  const entities = listSemanticEntities(house);
  const preparedAgents = household.map((agent, idx) => ({
    id: String(agent?.id || `agent-${idx + 1}`),
    name: String(agent?.name || `Agent ${idx + 1}`),
    quietNeed: Number.isFinite(agent?.needs?.quiet)
      ? Number(agent.needs.quiet)
      : 0.75,
    schedule: normalizeSchedule(agent?.schedule ?? []).map((entry) => ({
      ...entry,
      effectiveEndMinute: entry.endMinute ?? entry.startMinute + 60,
    })),
  }));

  const findings = [];
  const evaluations = [];

  for (const worker of preparedAgents) {
    const focusEntries = worker.schedule.filter((e) =>
      isQuietFocusActivity(e.activity),
    );
    if (focusEntries.length === 0) continue;

    // Adjust threshold slightly when persona has explicit quiet sensitivity (0..1)
    const workerThreshold =
      conflictThreshold - (worker.quietNeed - 0.75) * 8;

    for (const sourceAgent of preparedAgents) {
      if (sourceAgent.id === worker.id) continue;

      for (const focusEntry of focusEntries) {
        for (const srcEntry of sourceAgent.schedule) {
          const noiseSpec = classifyNoiseSourceActivity(srcEntry.activity);
          if (!noiseSpec) continue;

          const overlapStart = Math.max(
            focusEntry.startMinute,
            srcEntry.startMinute,
          );
          const overlapEnd = Math.min(
            focusEntry.effectiveEndMinute,
            srcEntry.effectiveEndMinute,
          );
          const overlapMinutes = overlapEnd - overlapStart;
          if (overlapMinutes <= 0) continue;

          const receiverLoc = resolveActivityPoint(
            focusEntry,
            house,
            entities,
            "desk",
          );
          const preferredSourceEntity =
            noiseSpec.sourceType === "tv"
              ? "tv"
              : noiseSpec.sourceType === "kitchen"
                ? "stove"
                : null;
          const sourceLoc = resolveActivityPoint(
            srcEntry,
            house,
            entities,
            preferredSourceEntity,
          );

          const distanceMeters = Math.hypot(
            sourceLoc.position[0] - receiverLoc.position[0],
            sourceLoc.position[1] - receiverLoc.position[1],
          );
          const distanceAttenuation =
            18 * Math.log10(Math.max(1, distanceMeters)) +
            1.1 * Math.max(0, distanceMeters - 1);

          const { wallsCrossed, openDoorwaysCrossed } = countPartitionsCrossed(
            house,
            sourceLoc.position,
            receiverLoc.position,
          );
          const wallAttenuation =
            wallsCrossed * wallPenaltyPerWall +
            openDoorwaysCrossed * (wallPenaltyPerWall * 0.25);

          const estimatedLevel = round1(
            Math.max(
              0,
              noiseSpec.baseNoiseIndex - distanceAttenuation - wallAttenuation,
            ),
          );

          const evaluation = {
            workerAgentId: worker.id,
            sourceAgentId: sourceAgent.id,
            sourceRoomId: sourceLoc.roomId,
            receiverRoomId: receiverLoc.roomId,
            sourceType: noiseSpec.sourceType,
            distanceMeters: round2(distanceMeters),
            wallsCrossed,
            openDoorwaysCrossed,
            overlapMinutes: round2(overlapMinutes),
            overlapWindowMinutes: [overlapStart, overlapEnd],
            estimatedLevel,
            thresholdLevel: round1(workerThreshold),
            levelScale: "simulation_noise_index_0_100",
            conflict: estimatedLevel >= workerThreshold,
          };
          evaluations.push(evaluation);

          if (estimatedLevel < workerThreshold) continue;

          const levelExcess =
            (estimatedLevel - workerThreshold) / Math.max(15, 100 - workerThreshold);
          const durationFactor = clamp(overlapMinutes / 120, 0.25, 1.0);
          const severity = round2(
            clamp(0.65 * clamp(levelExcess * 1.6, 0.2, 1.0) + 0.35 * durationFactor, 0.2, 0.98),
          );

          findings.push({
            type: FINDING_TYPES.NOISE_CONFLICT,
            severity,
            roomId: receiverLoc.roomId ?? sourceLoc.roomId,
            agentId: worker.id,
            location: {
              roomId: receiverLoc.roomId,
              position: [
                round2(receiverLoc.position[0]),
                round2(receiverLoc.position[1]),
              ],
            },
            evidence: {
              workerAgentId: worker.id,
              sourceAgentId: sourceAgent.id,
              sourceRoomId: sourceLoc.roomId,
              receiverRoomId: receiverLoc.roomId,
              sourceType: noiseSpec.sourceType,
              distanceMeters: round2(distanceMeters),
              wallsCrossed,
              overlapMinutes: round2(overlapMinutes),
              overlapWindowMinutes: [overlapStart, overlapEnd],
              estimatedLevel,
              levelScale: "simulation_noise_index_0_100",
            },
          });
        }
      }
    }
  }

  return { findings, evaluations };
}
