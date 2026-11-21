import { importSampleFloorplan } from "../spatial/floorplan-importer.js";
import { simulateHouse } from "./simulation-engine.js";

export const MORNING_ROUTINE_SCENARIO = Object.freeze({
  id: "morning-routine",
  name: "Morning Routine",
  startMinute: 420, // 07:00
  endMinute: 540, // 09:00
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
