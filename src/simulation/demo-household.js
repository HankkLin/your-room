import { importSampleFloorplan } from "../spatial/floorplan-importer.js";
import { simulateHouse } from "./simulation-engine.js";

export const MORNING_ROUTINE_SCENARIO = Object.freeze({
  id: "morning-routine",
  name: "Morning Routine",
  startMinute: 420, // 07:00
  endMinute: 540, // 09:00
  stepSeconds: 1,
});

export const GRANDPARENTS_STAYOVER_SCENARIO = Object.freeze({
  id: "grandparents-stayover",
  name: "Grandparents Stayover — Wheelchair",
  startMinute: 540, // 09:00
  endMinute: 660, // 11:00
  stepSeconds: 1,
});

function pickRoomId(rooms, preferredId, preferredKind) {
  const byId = rooms.find((r) => r.id === preferredId);
  if (byId) return byId.id;
  const byKind = rooms.find((r) => r.kind === preferredKind);
  if (byKind) return byKind.id;
  return rooms[0]?.id ?? preferredId;
}

/**
 * Create the deterministic two-person demo household (Kevin & Alice) whose
 * 07:00–09:00 Morning Routine exercises:
 * - Multi-door room-to-room A* routing (bedroom ↔ hallway ↔ bathroom ↔ kitchen ↔ living-room/exit)
 * - Narrow hallway path crossing around 07:25
 * - Overlapping kitchen breakfast prep from 07:45–08:10 (producing deterministic CONGESTION)
 *
 * @param {object} [house]
 */
export function createDemoHousehold(house) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const bedroomId = pickRoomId(rooms, "bedroom", "bedroom");
  const bathroomId = pickRoomId(rooms, "bathroom", "bathroom");
  const kitchenId = pickRoomId(rooms, "kitchen", "kitchen");
  const livingId = pickRoomId(rooms, "living-room", "living");
  const hasExteriorDoor = (house?.doors || []).some(
    (d) => d.kind === "exterior",
  );

  return [
    {
      id: "kevin",
      name: "Kevin",
      ageGroup: "adult",
      movementSpeedMps: 1.3,
      currentRoomId: bedroomId,
      needs: {
        privacy: 0.8,
        quiet: 0.9,
        accessibility: 0.2,
        daylight: 0.7,
        social: 0.5,
      },
      schedule: [
        {
          startMinute: 420, // 07:00
          endMinute: 435,
          activity: "wake",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 435, // 07:15
          endMinute: 445,
          activity: "bathroom",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 445, // 07:25 — crosses Alice in narrow hallway
          endMinute: 460,
          activity: "other",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 460, // 07:40 — enters kitchen work zone
          endMinute: 490,
          activity: "cook",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 490, // 08:10 — moves to living room / WFH desk area
          endMinute: 540,
          activity: "work",
          destination: { type: "room", roomId: livingId },
        },
      ],
    },
    {
      id: "alice",
      name: "Alice",
      ageGroup: "adult",
      movementSpeedMps: 1.25,
      currentRoomId: bedroomId,
      needs: {
        privacy: 0.6,
        quiet: 0.6,
        accessibility: 0.2,
        daylight: 0.8,
        social: 0.7,
      },
      schedule: [
        {
          startMinute: 430, // 07:10
          endMinute: 445,
          activity: "wake",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 445, // 07:25 — heads to bathroom as Kevin leaves bathroom
          endMinute: 465,
          activity: "bathroom",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 465, // 07:45 — joins Kevin in kitchen (25 min overlap -> CONGESTION)
          endMinute: 495,
          activity: "eat",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 495, // 08:15 — heads to entry exit or living room
          endMinute: 540,
          activity: "other",
          destination: hasExteriorDoor
            ? { type: "exit" }
            : { type: "room", roomId: livingId },
        },
      ],
    },
  ];
}

/**
 * Create Persona-contract-valid whole-home demo personas (Kevin & Alice) mapped
 * strictly to actual room IDs of `house` (never `room-1`), with both Morning
 * Routine (`07:00–09:00`) and Normal Day (`09:00–22:00`) schedule coverage.
 *
 * Passes `validatePersonas(personas, rooms)` directly.
 *
 * @param {object} [house]
 */
export function createWholeHomeDemoPersonas(house) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const bedroomId = pickRoomId(rooms, "bedroom", "bedroom");
  const bathroomId = pickRoomId(rooms, "bathroom", "bathroom");
  const kitchenId = pickRoomId(rooms, "kitchen", "kitchen");
  const livingId = pickRoomId(rooms, "living-room", "living");
  const hasHallway = rooms.some((r) => r.kind === "hallway" || r.id === "hallway");
  const alicePostBreakfastRoomId = hasHallway
    ? pickRoomId(rooms, "hallway", "hallway")
    : bedroomId;

  return [
    {
      id: "kevin",
      name: "Kevin",
      role: "Dad",
      heightLabel: "1.80 m",
      color: "#c5643b",
      ageGroup: "adult",
      preferences: ["WFH", "Quiet preferred"],
      dislikes: ["Afternoon glare", "Crowded kitchen"],
      needs: {
        privacy: 0.8,
        quiet: 0.9,
        accessibility: 0.2,
        daylight: 0.7,
        social: 0.5,
      },
      schedule: [
        { startMinute: 420, endMinute: 435, activity: "sleep", roomId: bedroomId },
        { startMinute: 435, endMinute: 445, activity: "bathroom", roomId: bathroomId },
        { startMinute: 445, endMinute: 460, activity: "other", roomId: bedroomId },
        { startMinute: 460, endMinute: 490, activity: "cook", roomId: kitchenId },
        { startMinute: 490, endMinute: 720, activity: "work", roomId: livingId },
        { startMinute: 720, endMinute: 765, activity: "eat", roomId: kitchenId },
        { startMinute: 765, endMinute: 1020, activity: "work", roomId: bedroomId },
        { startMinute: 1080, endMinute: 1140, activity: "eat", roomId: kitchenId },
        { startMinute: 1140, endMinute: 1320, activity: "relax", roomId: livingId },
      ],
    },
    {
      id: "alice",
      name: "Alice",
      role: "Mom",
      heightLabel: "1.66 m",
      color: "#4d7d6e",
      ageGroup: "adult",
      preferences: ["Early schedule", "Likes daylight"],
      dislikes: ["Blocked kitchen walkway"],
      needs: {
        privacy: 0.6,
        quiet: 0.5,
        accessibility: 0.2,
        daylight: 0.85,
        social: 0.75,
      },
      schedule: [
        { startMinute: 420, endMinute: 445, activity: "sleep", roomId: bedroomId },
        { startMinute: 445, endMinute: 465, activity: "bathroom", roomId: bathroomId },
        { startMinute: 465, endMinute: 495, activity: "eat", roomId: kitchenId },
        { startMinute: 495, endMinute: 540, activity: "other", roomId: alicePostBreakfastRoomId },
        { startMinute: 960, endMinute: 1080, activity: "watchTv", roomId: livingId },
        { startMinute: 1080, endMinute: 1140, activity: "cook", roomId: kitchenId },
        { startMinute: 1140, endMinute: 1320, activity: "watchTv", roomId: livingId },
      ],
    },
  ];
}

/**
 * Create a 5-member multi-generational family household (Dad · Kevin, Mom · Alice,
 * Brother · Leo, Sister · Maya, and Grandma Evelyn using a wheelchair) mapped to
 * actual room IDs of `house` and compliant with `validatePersonas(personas, rooms)`.
 *
 * @param {object} [house]
 */
export function createFamilyStayoverPersonas(house) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const bedroomId = pickRoomId(rooms, "bedroom", "bedroom");
  const bathroomId = pickRoomId(rooms, "bathroom", "bathroom");
  const kitchenId = pickRoomId(rooms, "kitchen", "kitchen");
  const livingId = pickRoomId(rooms, "living-room", "living");
  const entryRoomId = rooms.some((r) => r.kind === "hallway" || r.id === "hallway")
    ? pickRoomId(rooms, "hallway", "hallway")
    : livingId;

  const [kevin, alice] = createWholeHomeDemoPersonas(house);

  return [
    {
      ...kevin,
      schedule: [
        ...kevin.schedule.filter((s) => s.endMinute <= 540 || s.startMinute >= 660),
        { startMinute: 540, endMinute: 575, activity: "socialize", roomId: livingId },
        { startMinute: 575, endMinute: 625, activity: "cook", roomId: kitchenId },
        { startMinute: 625, endMinute: 660, activity: "eat", roomId: kitchenId },
      ].sort((a, b) => a.startMinute - b.startMinute),
    },
    {
      ...alice,
      schedule: [
        ...alice.schedule.filter((s) => s.endMinute <= 540 || s.startMinute >= 660),
        { startMinute: 540, endMinute: 565, activity: "socialize", roomId: entryRoomId },
        { startMinute: 565, endMinute: 620, activity: "cook", roomId: kitchenId },
        { startMinute: 620, endMinute: 660, activity: "socialize", roomId: livingId },
      ].sort((a, b) => a.startMinute - b.startMinute),
    },
    {
      id: "leo",
      name: "Leo",
      role: "Brother",
      heightLabel: "1.62 m",
      color: "#52719b",
      ageGroup: "teen",
      preferences: ["School prep", "Gaming corner"],
      dislikes: ["Hallway traffic"],
      needs: {
        privacy: 0.7,
        quiet: 0.65,
        accessibility: 0.2,
        daylight: 0.6,
        social: 0.6,
      },
      schedule: [
        { startMinute: 430, endMinute: 455, activity: "sleep", roomId: bedroomId },
        { startMinute: 455, endMinute: 470, activity: "bathroom", roomId: bathroomId },
        { startMinute: 470, endMinute: 500, activity: "eat", roomId: kitchenId },
        { startMinute: 540, endMinute: 585, activity: "study", roomId: bedroomId },
        { startMinute: 585, endMinute: 660, activity: "socialize", roomId: livingId },
      ],
    },
    {
      id: "maya",
      name: "Maya",
      role: "Sister",
      heightLabel: "1.34 m",
      color: "#b4823e",
      ageGroup: "child",
      preferences: ["Drawing table", "Sunny rug"],
      dislikes: ["Blocked doorway"],
      needs: {
        privacy: 0.4,
        quiet: 0.45,
        accessibility: 0.35,
        daylight: 0.85,
        social: 0.85,
      },
      schedule: [
        { startMinute: 440, endMinute: 470, activity: "sleep", roomId: bedroomId },
        { startMinute: 470, endMinute: 505, activity: "eat", roomId: kitchenId },
        { startMinute: 540, endMinute: 605, activity: "relax", roomId: livingId },
        { startMinute: 605, endMinute: 660, activity: "eat", roomId: kitchenId },
      ],
    },
    {
      id: "grandma-evelyn",
      name: "Grandma Evelyn",
      role: "Grandparent",
      heightLabel: "Wheelchair · 0.90 m",
      wheelchair: true,
      radiusMeters: 0.42,
      movementSpeedMps: 0.88,
      color: "#2f6b8a",
      ageGroup: "olderAdult",
      preferences: ["Wheelchair 0.90 m route", "Step-free tea table"],
      dislikes: ["Narrow doorways", "Tight dining chairs"],
      needs: {
        privacy: 0.75,
        quiet: 0.75,
        accessibility: 0.98,
        daylight: 0.8,
        social: 0.85,
      },
      schedule: [
        { startMinute: 540, endMinute: 560, activity: "socialize", roomId: entryRoomId },
        { startMinute: 560, endMinute: 590, activity: "relax", roomId: livingId },
        { startMinute: 590, endMinute: 615, activity: "bathroom", roomId: bathroomId },
        { startMinute: 615, endMinute: 660, activity: "eat", roomId: kitchenId },
      ],
    },
  ];
}

/**
 * Execute the complete deterministic Morning Routine scenario against a House JSON
 * (defaulting to the bundled 5-room Mercer Street Apartment sample house).
 */
export function runMorningRoutineDemo(house = null, scenarioOverrides = {}) {
  const targetHouse = house ?? importSampleFloorplan().house;
  const household = createDemoHousehold(targetHouse);
  const simulation = simulateHouse(targetHouse, household, {
    ...MORNING_ROUTINE_SCENARIO,
    ...scenarioOverrides,
  });
  return {
    house: targetHouse,
    household,
    simulation,
  };
}
