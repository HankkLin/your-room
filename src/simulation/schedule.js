import { isFinitePoint2D } from "../spatial/floorplan-geometry.js";
import {
  resolveExitPosition,
  resolveSafeRoomPosition,
} from "./navigation-grid.js";

function isFlexibleEntry(entry) {
  return (
    entry != null &&
    typeof entry === "object" &&
    (Object.hasOwn(entry, "windowStartMinute") ||
      Object.hasOwn(entry, "windowEndMinute") ||
      Object.hasOwn(entry, "durationMinutes"))
  );
}

function normalizeDestinationSpec(entry) {
  if (entry.destination && typeof entry.destination === "object") {
    const dest = entry.destination;
    if (dest.type === "position" && isFinitePoint2D(dest.position)) {
      return {
        type: "position",
        position: [Number(dest.position[0]), Number(dest.position[1])],
        roomId: dest.roomId ?? null,
      };
    }
    if (dest.type === "exit") {
      return { type: "exit", roomId: dest.roomId ?? null };
    }
    return {
      type: "room",
      roomId: String(dest.roomId ?? entry.roomId ?? "").trim(),
    };
  }
  if (typeof entry.destination === "string") {
    if (entry.destination === "exit") return { type: "exit", roomId: null };
    return { type: "room", roomId: entry.destination.trim() };
  }
  if (typeof entry.roomId === "string" && entry.roomId.trim()) {
    return { type: "room", roomId: entry.roomId.trim() };
  }
  return { type: "room", roomId: "" };
}

/**
 * Normalize an agent's schedule (supporting both Task 2 `{ startMinute, activity, destination }`
 * and Persona contract `{ startMinute, endMinute, activity, roomId }` + flexible windows)
 * into sorted, concrete schedule items with `startSecond` and `endSecond`.
 *
 * @param {Array<object>} rawSchedule
 * @returns {Array<{
 *   index: number,
 *   activity: string,
 *   startMinute: number,
 *   endMinute: number | null,
 *   startSecond: number,
 *   endSecond: number | null,
 *   destination: { type: "room" | "position" | "exit", roomId?: string | null, position?: [number, number] }
 * }>}
 */
const DEFAULT_EVENT_LABELS = Object.freeze({
  sleep: "Sleep",
  wake: "Wake up",
  bathroom: "Use bathroom",
  cook: "Prepare meal",
  breakfast: "Eat breakfast",
  eat: "Sit to eat",
  work: "WFH focus / call",
  study: "Homework at desk",
  watchTv: "Watch TV",
  socialize: "Visit & chat",
  relax: "Relax in room",
  exercise: "Stretch / exercise",
  other: "Household routine",
});

function resolveEventLabel(entry, activity) {
  if (typeof entry?.eventLabel === "string" && entry.eventLabel.trim()) {
    return entry.eventLabel.trim();
  }
  if (typeof entry?.label === "string" && entry.label.trim()) {
    return entry.label.trim();
  }
  return DEFAULT_EVENT_LABELS[activity] || activity;
}

export function normalizeSchedule(rawSchedule = []) {
  if (!Array.isArray(rawSchedule) || rawSchedule.length === 0) return [];

  const fixed = [];
  const flexible = [];

  rawSchedule.forEach((entry, rawIdx) => {
    if (!entry || typeof entry !== "object") return;
    const activity = String(entry.activity || "other").trim();
    const destination = normalizeDestinationSpec(entry);
    const eventLabel = resolveEventLabel(entry, activity);
    const eventType =
      typeof entry.eventType === "string" && entry.eventType.trim()
        ? entry.eventType.trim()
        : null;

    if (isFlexibleEntry(entry)) {
      const winStart = Number(entry.windowStartMinute ?? 0);
      const winEnd = Number(entry.windowEndMinute ?? 1440);
      const duration = Math.max(1, Number(entry.durationMinutes ?? 15));
      if (Number.isFinite(winStart) && Number.isFinite(winEnd) && winEnd > winStart) {
        flexible.push({
          rawIdx,
          activity,
          eventLabel,
          eventType,
          destination,
          windowStartMinute: winStart,
          windowEndMinute: winEnd,
          durationMinutes: duration,
        });
      }
      return;
    }

    const startMinute = Number(entry.startMinute);
    if (!Number.isFinite(startMinute) || startMinute < 0) return;
    const endMinute =
      entry.endMinute != null && Number.isFinite(Number(entry.endMinute))
        ? Number(entry.endMinute)
        : null;

    fixed.push({
      rawIdx,
      activity,
      eventLabel,
      eventType,
      startMinute,
      endMinute,
      destination,
    });
  });

  fixed.sort((a, b) => a.startMinute - b.startMinute || a.rawIdx - b.rawIdx);

  // Fill implicit endMinute on fixed entries where omitted so flexible placement knows reservations
  const fixedWithBounds = fixed.map((item, idx) => {
    const nextStart = fixed[idx + 1]?.startMinute ?? null;
    const inferredEnd =
      item.endMinute ??
      (nextStart != null && nextStart > item.startMinute
        ? nextStart
        : item.startMinute + 15);
    return { ...item, inferredEnd };
  });

  flexible.sort(
    (a, b) => a.windowStartMinute - b.windowStartMinute || a.rawIdx - b.rawIdx,
  );
  let previousFlexEnd = 0;
  const resolvedFlexible = [];

  for (const flex of flexible) {
    let startMinute = Math.max(flex.windowStartMinute, previousFlexEnd);
    for (const res of fixedWithBounds) {
      if (startMinute + flex.durationMinutes <= res.startMinute) break;
      startMinute = Math.max(startMinute, res.inferredEnd);
    }
    const endMinute = Math.min(
      flex.windowEndMinute,
      startMinute + flex.durationMinutes,
    );
    if (endMinute > startMinute) {
      resolvedFlexible.push({
        rawIdx: flex.rawIdx,
        activity: flex.activity,
        eventLabel: flex.eventLabel,
        eventType: flex.eventType,
        startMinute,
        endMinute,
        destination: flex.destination,
      });
      previousFlexEnd = endMinute;
    }
  }

  const combined = [...fixed, ...resolvedFlexible].sort(
    (a, b) => a.startMinute - b.startMinute || a.rawIdx - b.rawIdx,
  );

  return combined.map((entry, idx) => {
    const nextStart = combined[idx + 1]?.startMinute ?? null;
    const endMinute =
      entry.endMinute ??
      (nextStart != null && nextStart > entry.startMinute ? nextStart : null);
    return {
      index: idx,
      activity: entry.activity,
      eventLabel: entry.eventLabel,
      eventType: entry.eventType ?? null,
      startMinute: entry.startMinute,
      endMinute,
      startSecond: Math.round(entry.startMinute * 60),
      endSecond: endMinute != null ? Math.round(endMinute * 60) : null,
      destination: entry.destination,
    };
  });
}

/**
 * Resolve a normalized schedule destination into a concrete walkable `[x, z]`
 * target position in meters.
 */
export function resolveScheduleDestination(
  destination,
  {
    navigation,
    house,
    agentRadius,
    slotIndex = 0,
    activity = "",
    occupiedPositions = [],
  },
) {
  if (!destination || typeof destination !== "object") {
    return { ok: false, reason: "INVALID_DESTINATION", roomId: null, position: null };
  }

  if (destination.type === "position") {
    const pos = destination.position;
    if (
      !isFinitePoint2D(pos) ||
      !navigation.isPointWalkable(pos[0], pos[1], agentRadius)
    ) {
      return {
        ok: false,
        reason: "NO_PATH",
        roomId: destination.roomId ?? navigation.getRoomIdAt(pos?.[0], pos?.[1]),
        position: null,
      };
    }
    return {
      ok: true,
      roomId: destination.roomId ?? navigation.getRoomIdAt(pos[0], pos[1]),
      position: [pos[0], pos[1]],
    };
  }

  if (destination.type === "exit") {
    const exitTarget = resolveExitPosition(navigation, agentRadius);
    if (!exitTarget) {
      return { ok: false, reason: "NO_PATH", roomId: "exit", position: null };
    }
    return {
      ok: true,
      roomId: exitTarget.roomId,
      position: exitTarget.position,
      isExit: true,
    };
  }

  const requestedRoomId = destination.roomId;
  if (!requestedRoomId || !navigation.roomsById.has(requestedRoomId)) {
    return {
      ok: false,
      reason: "NO_PATH",
      roomId: requestedRoomId || null,
      position: null,
    };
  }

  const resolved = resolveSafeRoomPosition(navigation, requestedRoomId, {
    slotIndex,
    agentRadius,
    activity,
    house,
    occupiedPositions,
  });

  if (!resolved) {
    return {
      ok: false,
      reason: "NO_PATH",
      roomId: requestedRoomId,
      position: null,
    };
  }

  return {
    ok: true,
    roomId: resolved.roomId,
    position: resolved.position,
  };
}
