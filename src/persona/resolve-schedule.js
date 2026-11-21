export function isFlexibleActivity(entry) {
  return ['windowStartMinute', 'windowEndMinute', 'durationMinutes']
    .some((field) => Object.hasOwn(entry, field));
}

// Entries have already passed timing and destination validation.
export function resolveSchedule(schedule) {
  const fixed = [];
  const flexible = [];
  for (const entry of schedule) {
    (isFlexibleActivity(entry) ? flexible : fixed).push(entry);
  }
  fixed.sort((a, b) => a.startMinute - b.startMinute);
  if (fixed.some((entry, index) => index > 0 && entry.startMinute < fixed[index - 1].endMinute)) {
    return { error: 'overlap' };
  }

  const placements = [];
  let previousEnd = 0;
  // Stable sort preserves the approved order of entries with the same window opening.
  flexible.sort((a, b) => a.windowStartMinute - b.windowStartMinute);
  for (const entry of flexible) {
    const { activity, roomId, windowStartMinute, windowEndMinute, durationMinutes } = entry;
    let startMinute = Math.max(windowStartMinute, previousEnd);
    for (const reservation of fixed) {
      if (startMinute + durationMinutes <= reservation.startMinute) break;
      startMinute = Math.max(startMinute, reservation.endMinute);
    }
    const endMinute = startMinute + durationMinutes;
    if (endMinute > windowEndMinute) return { error: 'window' };
    placements.push({ activity, roomId, startMinute, endMinute });
    previousEnd = endMinute;
  }

  return { schedule: [...fixed, ...placements].sort((a, b) => a.startMinute - b.startMinute) };
}
