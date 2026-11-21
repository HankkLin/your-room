export function createBlockedRouteDemo() {
  return {
    items: [{
      id: "replay-demo-sofa",
      name: "Doorway sofa",
      type: "existing",
      kind: "sofa",
      roomId: "bedroom",
      x: 3.2,
      z: 6,
      rotation: 0,
      width: 2.1,
      height: 0.85,
      depth: 0.9,
      owned: true,
      locked: false,
      price: 0,
      color: "#8e7969",
    }],
    householdDraft: [{
      id: "replay-demo-alex",
      name: "Alex",
      ageGroup: "adult",
      preferences: [],
      dislikes: [],
      needs: { privacy: 0.6, quiet: 0.6, accessibility: 0.2, daylight: 0.6, social: 0.6 },
      schedule: [
        { activity: "sleep", roomId: "bedroom", startMinute: 470, endMinute: 485 },
        { activity: "cook", roomId: "kitchen", windowStartMinute: 480, windowEndMinute: 510, durationMinutes: 15 },
      ],
    }],
  };
}
