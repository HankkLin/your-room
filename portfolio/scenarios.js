export const scenarios = [
  ["morning-routine", "Morning", "Follow the family into the kitchen at breakfast."],
  ["friends-arrival", "Friends", "Watch eight guests arrive in waves."],
  ["grandparents-visit", "Wheelchair", "Follow Grandpa Arthur’s visit and check the bathroom doorway."],
  ["fire-emergency", "Fire", "Follow the family’s simulated route to the exit."],
];
export function sampleProposal() {
  return { id: "sample-breakfast-layout", reasoning: "Move the breakfast table and chair away from the prep area.",
    targetFindings: ["CONGESTION:kitchen"], operations: [
      { type: "move", objectId: "kitchen-table-1", position: [7.7, 0, 3.45] },
      { type: "move", objectId: "kitchen-chair-1", position: [7.7, 0, 2.6] },
    ] };
}
export function measure(dataset) {
  const find = (type, room) => dataset.findings.find(f => f.type === type && f.roomId === room);
  switch (dataset.scenarioId) {
    case "morning-routine": {
      const sec = find("CONGESTION", "kitchen")?.evidence.durationSeconds ?? 0;
      return { label: "Kitchen crowding", value: sec, unit: "s", detail: `The simulation recorded ${sec} seconds of kitchen congestion.` };
    }
    case "friends-arrival": {
      const sec = find("CONGESTION", "hallway")?.evidence.durationSeconds ?? 0;
      return { label: "Hallway crowding", value: sec, unit: "s", detail: `The guests’ hallway crowding episode lasted ${sec} seconds.` };
    }
    case "grandparents-visit": {
      const issues = dataset.findings.filter(f => f.type.startsWith("ACCESSIBILITY"));
      const door = find("ACCESSIBILITY_CLEARANCE_FAIL", "bathroom")?.evidence;
      return { label: "Access findings", value: issues.length, unit: "", detail: door ? `Arthur’s bathroom route crosses a ${door.measuredWidthMeters} m doorway. The validator requires ${door.requiredWidthMeters} m.` : `Accessibility checks reported ${issues.length} findings.` };
    }
    case "fire-emergency": {
      const sec = find("EVACUATION_BOTTLENECK", "hallway")?.evidence.estimatedQueueDelaySeconds ?? 0;
      return { label: "Exit queue delay", value: sec, unit: "s", detail: `${dataset.completedLabel}. The estimated hallway queue delay was ${sec} seconds.` };
    }
  }
}

