/**
 * ISOLATED DEMO PLAYBACK MOCK — VISUALIZATION PREVIEW ONLY (`isMockData: true`).
 *
 * Architectural boundary:
 * - Provides pre-baked keyframe timelines and desktop-compatible `SimulationFinding`
 *   payloads so 3D avatars, route polylines, congestion hotspots, privacy sightline
 *   rays, fire evacuation paths, and Before/After redesign transitions can be
 *   inspected on this branch without importing or implementing A* / validators.
 * - Replaced at runtime via `window.__stillroom.connectSimulationPlayback(...)`
 *   or `window.__stillroom.connectSimulationEngine(...)` when desktop's real
 *   `simulateHouse()` + `getSimulationSnapshotAt()` + `runStressScenario()` +
 *   `evaluateHouseholdExperience()` are merged.
 */

import {
  mockAfterScores,
  mockBeforeScores,
  mockRedesignActions,
} from "./demo-simulation-mock.js";
import { sampleTimelineAt } from "./src/components/simulation/playback-controller.js";

export { sampleTimelineAt as getMockSimulationSnapshotAt };

function findRoomCenter(house, kindOrId, fallback) {
  if (!house?.rooms?.length) return fallback;
  const room =
    house.rooms.find((r) => r.id === kindOrId || r.kind === kindOrId) ||
    house.rooms.find((r) =>
      String(r.name || "").toLowerCase().includes(String(kindOrId).toLowerCase()),
    );
  if (!room?.bounds) return fallback;
  return [room.bounds.centerX, room.bounds.centerZ];
}

function findDoorPosition(house, predicate, fallback) {
  if (!house?.doors?.length) return fallback;
  const door = house.doors.find(predicate);
  if (door && Array.isArray(door.position) && door.position.length >= 2) {
    return {
      id: door.id,
      width: Number(door.width) || 0.96,
      position: [Number(door.position[0]), Number(door.position[1])],
    };
  }
  return { id: "door-front-entry", width: 0.96, position: fallback };
}

function findFixturePosition(items, kind, fallback) {
  const item = (items || []).find((i) => i.kind === kind);
  if (item && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z))) {
    return { id: item.id, position: [Number(item.x), Number(item.z)] };
  }
  return { id: `fixture-${kind}`, position: fallback };
}

function buildLinearFrames(agentId, waypoints, stepSeconds = 15) {
  const timeline = [];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = b.pos[0] - a.pos[0];
    const dz = b.pos[1] - a.pos[1];
    const dist = Math.hypot(dx, dz);
    const moving = dist > 0.03;
    const yaw = moving ? Math.atan2(dz, dx) : a.yaw ?? 0;
    const span = Math.max(stepSeconds, b.t - a.t);
    const steps = Math.max(1, Math.round(span / stepSeconds));
    for (let s = 0; s < steps; s += 1) {
      const u = s / steps;
      const ts = a.t + (b.t - a.t) * u;
      timeline.push({
        timestamp: ts,
        minute: ts / 60,
        agentId,
        position: [a.pos[0] + dx * u, a.pos[1] + dz * u],
        yaw,
        roomId: u < 0.5 ? a.roomId : b.roomId,
        activity: a.activity || "move",
        moving,
      });
    }
  }
  const last = waypoints[waypoints.length - 1];
  const prev = waypoints[Math.max(0, waypoints.length - 2)];
  const finalYaw =
    Math.hypot(last.pos[0] - prev.pos[0], last.pos[1] - prev.pos[1]) > 0.03
      ? Math.atan2(last.pos[1] - prev.pos[1], last.pos[0] - prev.pos[0])
      : 0;
  timeline.push({
    timestamp: last.t,
    minute: last.t / 60,
    agentId,
    position: [...last.pos],
    yaw: finalYaw,
    roomId: last.roomId,
    activity: last.activity || "idle",
    moving: false,
  });
  return timeline;
}

function buildAfterItemsAndChanges(items = []) {
  const afterItems = items.map((item) => ({ ...item }));
  const patchChanges = [];

  const chair = afterItems.find(
    (i) => !i.locked && i.type !== "fixed" && i.kind === "chair",
  );
  if (chair) {
    const from = [Number(chair.x), Number(chair.z)];
    const to = [Number((chair.x - 0.55).toFixed(2)), Number((chair.z + 0.32).toFixed(2))];
    chair.x = to[0];
    chair.z = to[1];
    patchChanges.push({
      objectId: chair.id,
      from,
      to,
      width: chair.width || 0.78,
      depth: chair.depth || 0.8,
    });
  }

  const plant = afterItems.find(
    (i) => !i.locked && i.type !== "fixed" && i.kind === "plant",
  );
  if (plant) {
    const from = [Number(plant.x), Number(plant.z)];
    const to = [Number((plant.x + 0.62).toFixed(2)), Number((plant.z - 0.18).toFixed(2))];
    plant.x = to[0];
    plant.z = to[1];
    patchChanges.push({
      objectId: plant.id,
      from,
      to,
      width: plant.width || 0.55,
      depth: plant.depth || 0.55,
    });
  }

  return { beforeItems: items.map((i) => ({ ...i })), afterItems, patchChanges };
}

/**
 * Create a self-contained mock playback dataset matching desktop's exact contract.
 */
export function createMockPlaybackDataset(
  scenarioId = "morning-routine",
  { house = null, items = [], personas = [] } = {},
) {
  const living = findRoomCenter(house, "living", [-1.5, 1.8]);
  const kitchen = findRoomCenter(house, "kitchen", [3.0, 1.8]);
  const bedroom = findRoomCenter(house, "bedroom", [-2.2, -2.1]);
  const bathroom = findRoomCenter(house, "bathroom", [2.4, -2.0]);

  const entryDoor = findDoorPosition(
    house,
    (d) => d.kind === "exterior" || !d.roomB,
    [-3.4, 3.8],
  );
  const kitchenDoor = findDoorPosition(
    house,
    (d) => d.roomA === "kitchen" || d.roomB === "kitchen",
    [1.6, 1.8],
  );
  const bedDoor = findDoorPosition(
    house,
    (d) => d.roomA === "bedroom" || d.roomB === "bedroom",
    [-1.3, -0.4],
  );
  const bathDoor = findDoorPosition(
    house,
    (d) =>
      (d.roomA === "bathroom" && d.roomB === "living-room") ||
      (d.roomB === "bathroom" && d.roomA === "living-room"),
    [0.9, -0.4],
  );
  const toilet = findFixturePosition(items, "toilet", [bathroom[0] + 0.8, bathroom[1] - 0.9]);
  const fridge = findFixturePosition(items, "refrigerator", [kitchen[0] + 0.8, kitchen[1] - 1.1]);
  const sofa = findFixturePosition(items, "sofa", [living[0], living[1] + 1.1]);

  const memberA = personas[0]?.name || "Kevin";
  const memberB = personas[1]?.name || "Alice";
  const { beforeItems, afterItems, patchChanges } = buildAfterItemsAndChanges(items);

  if (scenarioId === "fire-emergency") {
    const startSec = 0;
    const endSec = 34;
    const exitInner = [
      entryDoor.position[0],
      entryDoor.position[1] > living[1]
        ? entryDoor.position[1] - 0.45
        : entryDoor.position[1] + 0.45,
    ];
    const agents = [
      { id: "kevin", name: memberA },
      { id: "alice", name: memberB },
    ];
    const kevinPath = [
      [bedroom[0] - 0.4, bedroom[1] - 0.3],
      bedDoor.position,
      [living[0] - 0.6, living[1] - 0.2],
      exitInner,
    ];
    const alicePath = [
      [kitchen[0] + 0.2, kitchen[1] + 0.3],
      kitchenDoor.position,
      [living[0] + 0.4, living[1] + 0.5],
      exitInner,
    ];
    const timeline = [
      ...buildLinearFrames(
        "kevin",
        [
          { t: 0, pos: kevinPath[0], roomId: "bedroom", activity: "evacuate" },
          { t: 11, pos: kevinPath[1], roomId: "living-room", activity: "evacuate" },
          { t: 22, pos: kevinPath[2], roomId: "living-room", activity: "evacuate" },
          { t: 34, pos: kevinPath[3], roomId: "living-room", activity: "evacuated" },
        ],
        2,
      ),
      ...buildLinearFrames(
        "alice",
        [
          { t: 0, pos: alicePath[0], roomId: "kitchen", activity: "evacuate" },
          { t: 10, pos: alicePath[1], roomId: "living-room", activity: "evacuate" },
          { t: 23, pos: alicePath[2], roomId: "living-room", activity: "evacuate" },
          { t: 34, pos: [exitInner[0] + 0.34, exitInner[1]], roomId: "living-room", activity: "evacuated" },
        ],
        2,
      ),
    ];
    const agentRoutes = [
      {
        agentId: "kevin",
        reachable: true,
        exitDoorId: entryDoor.id,
        exitDoorPosition: entryDoor.position,
        exitDoorWidthMeters: entryDoor.width,
        path: kevinPath,
      },
      {
        agentId: "alice",
        reachable: true,
        exitDoorId: entryDoor.id,
        exitDoorPosition: entryDoor.position,
        exitDoorWidthMeters: entryDoor.width,
        path: alicePath,
      },
    ];
    return {
      isMockData: true,
      clockMode: "elapsed",
      completedLabel: "00:34 evacuated",
      simSecondsPerRealSecond: 12,
      isEvacuation: true,
      agentRoutes,
      simulation: {
        startSecond: startSec,
        endSecond: endSec,
        agents,
        routes: agentRoutes.map((r) => ({
          agentId: r.agentId,
          path: r.path,
          startTimestamp: 0,
          endTimestamp: endSec,
        })),
        timeline,
      },
      findings: [
        {
          id: "mock-finding-egress",
          type: "EVACUATION_BOTTLENECK",
          severity: 0.84,
          level: "critical",
          title: "Narrow egress pinch point",
          summary:
            "Accent chair narrows front-entry evacuation path during simultaneous exit.",
          location: { roomId: "living-room", label: "Living Room", position: entryDoor.position },
          evidence: {
            exitDoorId: entryDoor.id,
            exitDoorWidthMeters: entryDoor.width,
            convergingAgentCount: 2,
            agentIds: ["kevin", "alice"],
            estimatedQueueDelaySeconds: 2.4,
          },
        },
        {
          id: "mock-finding-bedroom-exit",
          type: "CLEAR",
          severity: 0,
          level: "success",
          title: "Bedroom exit unobstructed",
          summary: "Clear 0.96 m doorway clearance into central living space.",
          location: "Bedroom",
        },
      ],
      beforeScores: {
        movement: 61,
        privacy: 72,
        noise: 70,
        visibility: 74,
        safety: 54,
      },
      afterScores: {
        movement: 90,
        privacy: 76,
        noise: 72,
        visibility: 89,
        safety: 95,
      },
      redesignActions: [
        "Cleared front entrance approach corridor",
        "Relocated accent chair out of primary egress lane",
      ],
      beforeItems,
      afterItems,
      patchChanges,
    };
  }

  if (scenarioId === "dinner-party-8-guests") {
    // 10 simultaneous avatars (2 hosts + 8 guests) from 19:30 (46800s) to 20:00 (48000s)
    const startSec = 19 * 3600 + 30 * 60;
    const endSec = 20 * 3600;
    const names = [
      ["kevin", memberA],
      ["alice", memberB],
      ["guest-1", "Guest 1"],
      ["guest-2", "Guest 2"],
      ["guest-3", "Guest 3"],
      ["guest-4", "Guest 4"],
      ["guest-5", "Guest 5"],
      ["guest-6", "Guest 6"],
      ["guest-7", "Guest 7"],
      ["guest-8", "Guest 8"],
    ];
    const agents = names.map(([id, name]) => ({ id, name }));
    const timeline = [];
    const routes = [];
    names.forEach(([id], idx) => {
      const angleA = (idx / names.length) * Math.PI * 2;
      const startPt =
        idx < 2
          ? [kitchen[0] + (idx === 0 ? -0.45 : 0.35), kitchen[1] + (idx === 0 ? -0.4 : 0.45)]
          : [
              living[0] + Math.cos(angleA) * 1.25,
              living[1] + Math.sin(angleA) * 0.95,
            ];
      const midPt =
        idx % 3 === 0
          ? [kitchenDoor.position[0] + 0.35, kitchenDoor.position[1] + ((idx % 2) - 0.5) * 0.55]
          : idx % 4 === 1
            ? [bathDoor.position[0], bathDoor.position[1] + 0.4]
            : [kitchen[0] - 0.3 + (idx % 3) * 0.32, kitchen[1] - 0.5 + (idx % 2) * 0.65];
      const endPt = [
        living[0] + Math.cos(angleA + 1.1) * 1.15,
        living[1] + Math.sin(angleA + 1.1) * 0.85,
      ];
      routes.push({
        agentId: id,
        startTimestamp: startSec,
        endTimestamp: endSec,
        path: [startPt, kitchenDoor.position, midPt, endPt],
      });
      timeline.push(
        ...buildLinearFrames(
          id,
          [
            { t: startSec, pos: startPt, roomId: idx < 2 ? "kitchen" : "living-room", activity: "socialize" },
            { t: startSec + 420, pos: midPt, roomId: "kitchen", activity: "refreshments" },
            { t: endSec, pos: endPt, roomId: "living-room", activity: "dinner" },
          ],
          30,
        ),
      );
    });

    return {
      isMockData: true,
      clockMode: "clock",
      simSecondsPerRealSecond: 400,
      isEvacuation: false,
      agentRoutes: [],
      simulation: {
        startSecond: startSec,
        endSecond: endSec,
        agents,
        routes,
        timeline,
      },
      findings: [
        {
          id: "mock-finding-party-bottleneck",
          type: "CONGESTION",
          severity: 0.86,
          level: "critical",
          title: "Severe doorway bottleneck",
          summary:
            "Guests queuing between Living Room and Kitchen reduced clearance to 0.42 m.",
          location: {
            roomId: "kitchen",
            label: "Kitchen",
            position: kitchenDoor.position,
          },
          evidence: {
            agentCount: 6,
            agentIds: ["kevin", "alice", "guest-1", "guest-2", "guest-3", "guest-6"],
            durationSeconds: 510,
            minimumClearanceMeters: 0.42,
          },
        },
        {
          id: "mock-finding-bath-queue",
          type: "PRIVACY_SIGHTLINE",
          severity: 0.58,
          level: "warning",
          title: "Bathroom sightline exposure",
          summary:
            "Direct line-of-sight from social seating to bathroom threshold.",
          location: {
            roomId: "bathroom",
            label: "Bathroom",
            position: toilet.position,
          },
          evidence: {
            sourceType: "seating",
            sourceId: sofa.id,
            targetType: "toilet",
            targetObjectId: toilet.id,
            observerPosition: sofa.position,
            targetPosition: toilet.position,
            distanceMeters: Number(
              Math.hypot(
                toilet.position[0] - sofa.position[0],
                toilet.position[1] - sofa.position[1],
              ).toFixed(2),
            ),
            directLineOfSight: true,
          },
        },
      ],
      beforeScores: {
        movement: 49,
        privacy: 58,
        noise: 46,
        visibility: 70,
        safety: 79,
      },
      afterScores: {
        movement: 86,
        privacy: 84,
        noise: 74,
        visibility: 92,
        safety: 91,
      },
      redesignActions: [
        "Rotated lounge chair to widen kitchen threshold to 1.04 m",
        "Shifted seating group away from bathroom sightline",
        "Replaced wide coffee table with compact oval table",
      ],
      beforeItems,
      afterItems,
      patchChanges,
    };
  }

  // Morning Routine (07:30 -> 08:30) and Normal Day (07:30 -> 10:00 PM)
  const isNormalDay = scenarioId === "normal-day";
  const startSec = 7 * 3600 + 30 * 60; // 27000 (07:30 AM)
  const endSec = isNormalDay ? 22 * 3600 : 8 * 3600 + 30 * 60; // 30600 (08:30 AM)
  const mid1 = startSec + Math.round((endSec - startSec) * 0.28);
  const mid2 = startSec + Math.round((endSec - startSec) * 0.64);

  const kevinKitchenSpot = [fridge.position[0] - 0.72, fridge.position[1] + 0.55];
  const aliceKitchenSpot = [fridge.position[0] - 0.52, fridge.position[1] + 0.85];
  const congestionPoint = [
    Number(((kevinKitchenSpot[0] + aliceKitchenSpot[0]) / 2).toFixed(2)),
    Number(((kevinKitchenSpot[1] + aliceKitchenSpot[1]) / 2).toFixed(2)),
  ];

  const kevinRoute1 = [
    [bedroom[0] - 0.45, bedroom[1] - 0.35],
    bedDoor.position,
    [living[0] + 0.2, living[1] - 0.3],
    kitchenDoor.position,
    kevinKitchenSpot,
  ];
  const kevinRoute2 = [
    kevinKitchenSpot,
    kitchenDoor.position,
    [living[0] - 0.55, living[1] + 0.45],
  ];
  const aliceRoute1 = [
    [bathroom[0] - 0.45, bathroom[1] + 0.3],
    bathDoor.position,
    kitchenDoor.position,
    aliceKitchenSpot,
  ];
  const aliceRoute2 = [
    aliceKitchenSpot,
    kitchenDoor.position,
    [sofa.position[0], sofa.position[1] - 0.55],
  ];

  const stepSec = isNormalDay ? 300 : 25;
  const timeline = [
    ...buildLinearFrames(
      "kevin",
      [
        { t: startSec, pos: kevinRoute1[0], roomId: "bedroom", activity: "wake" },
        { t: mid1, pos: kevinKitchenSpot, roomId: "kitchen", activity: "coffee" },
        { t: mid2, pos: kevinKitchenSpot, roomId: "kitchen", activity: "breakfast" },
        { t: endSec, pos: kevinRoute2[2], roomId: "living-room", activity: "work" },
      ],
      stepSec,
    ),
    ...buildLinearFrames(
      "alice",
      [
        { t: startSec, pos: aliceRoute1[0], roomId: "bathroom", activity: "ready" },
        { t: mid1, pos: aliceKitchenSpot, roomId: "kitchen", activity: "cook" },
        { t: mid2, pos: aliceKitchenSpot, roomId: "kitchen", activity: "cook" },
        { t: endSec, pos: aliceRoute2[2], roomId: "living-room", activity: "watchTv" },
      ],
      stepSec,
    ),
  ];

  const baseFindings = [
    {
      id: "mock-finding-congestion",
      type: "CONGESTION",
      severity: 0.72,
      level: "warning",
      title: "Kitchen congestion",
      summary: "Kevin and Alice overlap in the refrigerator prep lane.",
      location: {
        roomId: "kitchen",
        label: "Kitchen",
        position: congestionPoint,
      },
      evidence: {
        agentCount: 2,
        agentIds: ["kevin", "alice"],
        durationSeconds: 1498,
        minimumClearanceMeters: 0.11,
      },
    },
    {
      id: "mock-finding-privacy",
      type: "PRIVACY_SIGHTLINE",
      severity: 0.68,
      level: "warning",
      title: "Entry-to-bathroom sightline",
      summary: "Unbroken sightline from entry threshold toward bathroom fixture.",
      location: {
        roomId: "bathroom",
        label: "Bathroom",
        position: toilet.position,
      },
      evidence: {
        sourceType: "entry",
        sourceId: entryDoor.id,
        targetType: "toilet",
        targetObjectId: toilet.id,
        observerPosition: entryDoor.position,
        targetPosition: toilet.position,
        distanceMeters: Number(
          Math.hypot(
            toilet.position[0] - entryDoor.position[0],
            toilet.position[1] - entryDoor.position[1],
          ).toFixed(2),
        ),
        directLineOfSight: true,
      },
    },
    {
      id: "mock-finding-noise",
      type: "WFH_NOISE",
      severity: 0.65,
      level: "warning",
      title: "WFH noise conflict",
      summary: "Living-room TV exceeds the preferred workspace noise threshold.",
      location: {
        roomId: "living-room",
        label: "Living Room",
        position: [living[0], living[1]],
      },
    },
    {
      id: "mock-finding-clear",
      type: "CLEAR",
      severity: 0,
      level: "success",
      title: "Bedroom route clear",
      summary: "No doorway or walkway obstruction detected along bedroom path.",
      location: "Bedroom",
    },
  ];

  if (isNormalDay) {
    baseFindings.splice(2, 0, {
      id: "mock-finding-tv-angle",
      type: "TV_BAD_ANGLE",
      severity: 0.52,
      level: "info",
      title: "Off-axis living view angle",
      summary: "Accent chair views focal wall at an oblique 48° angle.",
      location: {
        roomId: "living-room",
        label: "Living Room",
        position: sofa.position,
      },
      evidence: {
        viewerPosition: sofa.position,
        tvPosition: [living[0] - 1.6, living[1] - 1.2],
        viewingAngleDegrees: 48,
        distanceMeters: 2.9,
      },
    });
  }

  return {
    isMockData: true,
    clockMode: "clock",
    simSecondsPerRealSecond: isNormalDay ? 12000 : 1000,
    isEvacuation: false,
    agentRoutes: [],
    simulation: {
      startSecond: startSec,
      endSecond: endSec,
      agents: [
        { id: "kevin", name: memberA },
        { id: "alice", name: memberB },
      ],
      routes: [
        {
          agentId: "kevin",
          startTimestamp: startSec,
          endTimestamp: mid1,
          path: kevinRoute1,
        },
        {
          agentId: "kevin",
          startTimestamp: mid2,
          endTimestamp: endSec,
          path: kevinRoute2,
        },
        {
          agentId: "alice",
          startTimestamp: startSec,
          endTimestamp: mid1,
          path: aliceRoute1,
        },
        {
          agentId: "alice",
          startTimestamp: mid2,
          endTimestamp: endSec,
          path: aliceRoute2,
        },
      ],
      timeline,
    },
    findings: baseFindings,
    beforeScores: { ...mockBeforeScores },
    afterScores: { ...mockAfterScores },
    redesignActions: [...mockRedesignActions],
    beforeItems,
    afterItems,
    patchChanges,
  };
}
