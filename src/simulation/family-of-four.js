function pickRoomId(rooms, preferredId, preferredKind) {
  const byId = rooms.find((r) => r.id === preferredId);
  if (byId) return byId.id;
  const byKind = rooms.find((r) => r.kind === preferredKind);
  if (byKind) return byKind.id;
  return rooms[0]?.id ?? preferredId;
}

/**
 * Canonical Family of Four Personas (Persona-contract compatible: passes `validatePersonas(personas, rooms)`).
 *
 * Members:
 * 1. Kevin (Dad) — tallest (`1.83 m`), WFH / practical, early riser, quiet calls.
 * 2. Alice (Mom) — slightly shorter (`1.66 m`), detail-oriented, family logistics, quiet & safety needs.
 * 3. Leo (Brother) — teenager (`1.74 m`), homework at desk & evening gaming.
 * 4. Maya (Sister) — elementary-school child (`1.30 m`), playful, living room & afternoon TV.
 *
 * Exercises natural household conflicts:
 * - Morning bathroom overlap (`07:12–07:32`)
 * - Breakfast prep & eating congestion in kitchen (`07:40–08:10`)
 * - Afternoon TV vs WFH / homework noise conflict (`15:30–17:00`)
 * - Bedroom / bathroom privacy sightlines
 *
 * @param {object} [house]
 */
export function createFamilyOfFourPersonas(house) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const bedroomId = pickRoomId(rooms, "bedroom", "bedroom");
  const bathroomId = pickRoomId(rooms, "bathroom", "bathroom");
  const kitchenId = pickRoomId(rooms, "kitchen", "kitchen");
  const livingId = pickRoomId(rooms, "living-room", "living");
  const hasHallway = rooms.some((r) => r.kind === "hallway" || r.id === "hallway");
  const circulationRoomId = hasHallway
    ? pickRoomId(rooms, "hallway", "hallway")
    : livingId;

  return [
    {
      id: "kevin",
      name: "Kevin (Dad)",
      role: "dad",
      ageGroup: "adult",
      heightMeters: 1.83,
      eyeHeightMeters: 1.67,
      movementSpeedMps: 1.34,
      preferences: ["WFH", "Quiet preferred", "Early coffee"],
      dislikes: ["Kitchen crowding", "Call background noise"],
      needs: {
        privacy: 0.8,
        quiet: 0.9,
        accessibility: 0.25,
        daylight: 0.7,
        social: 0.55,
      },
      schedule: [
        { startMinute: 420, endMinute: 432, activity: "sleep", roomId: bedroomId },
        { startMinute: 432, endMinute: 444, activity: "bathroom", roomId: bathroomId },
        { startMinute: 444, endMinute: 460, activity: "other", roomId: bedroomId },
        { startMinute: 460, endMinute: 490, activity: "cook", roomId: kitchenId },
        { startMinute: 490, endMinute: 720, activity: "work", roomId: livingId },
        { startMinute: 720, endMinute: 765, activity: "eat", roomId: kitchenId },
        { startMinute: 765, endMinute: 1035, activity: "work", roomId: bedroomId },
        { startMinute: 1080, endMinute: 1140, activity: "eat", roomId: kitchenId },
        { startMinute: 1140, endMinute: 1320, activity: "relax", roomId: livingId },
      ],
    },
    {
      id: "alice",
      name: "Alice (Mom)",
      role: "mom",
      ageGroup: "adult",
      heightMeters: 1.66,
      eyeHeightMeters: 1.51,
      movementSpeedMps: 1.28,
      preferences: ["Early schedule", "Likes daylight", "Clear walkways"],
      dislikes: ["Blocked kitchen walkway", "Morning bathroom queue"],
      needs: {
        privacy: 0.75,
        quiet: 0.8,
        accessibility: 0.35,
        daylight: 0.85,
        social: 0.72,
      },
      schedule: [
        { startMinute: 420, endMinute: 444, activity: "sleep", roomId: bedroomId },
        { startMinute: 444, endMinute: 458, activity: "bathroom", roomId: bathroomId },
        { startMinute: 458, endMinute: 492, activity: "eat", roomId: kitchenId },
        { startMinute: 492, endMinute: 540, activity: "other", roomId: circulationRoomId },
        { startMinute: 720, endMinute: 765, activity: "eat", roomId: kitchenId },
        { startMinute: 960, endMinute: 1065, activity: "work", roomId: livingId },
        { startMinute: 1065, endMinute: 1140, activity: "cook", roomId: kitchenId },
        { startMinute: 1140, endMinute: 1320, activity: "relax", roomId: bedroomId },
      ],
    },
    {
      id: "leo",
      name: "Leo (Brother)",
      role: "brother",
      ageGroup: "teen",
      heightMeters: 1.74,
      eyeHeightMeters: 1.58,
      movementSpeedMps: 1.38,
      preferences: ["Desk homework", "Evening gaming"],
      dislikes: ["Sibling TV noise", "Morning rush"],
      needs: {
        privacy: 0.85,
        quiet: 0.82,
        accessibility: 0.15,
        daylight: 0.6,
        social: 0.65,
      },
      schedule: [
        { startMinute: 420, endMinute: 458, activity: "sleep", roomId: bedroomId },
        { startMinute: 458, endMinute: 470, activity: "bathroom", roomId: bathroomId },
        { startMinute: 470, endMinute: 515, activity: "study", roomId: bedroomId },
        { startMinute: 515, endMinute: 540, activity: "other", roomId: circulationRoomId },
        { startMinute: 900, endMinute: 1050, activity: "study", roomId: bedroomId },
        { startMinute: 1080, endMinute: 1135, activity: "eat", roomId: kitchenId },
        { startMinute: 1135, endMinute: 1300, activity: "watchTv", roomId: livingId },
      ],
    },
    {
      id: "maya",
      name: "Maya (Sister)",
      role: "sister",
      ageGroup: "child",
      heightMeters: 1.3,
      eyeHeightMeters: 1.18,
      movementSpeedMps: 1.18,
      preferences: ["Living room play", "Afternoon cartoons"],
      dislikes: ["Dark hallways"],
      needs: {
        privacy: 0.4,
        quiet: 0.45,
        accessibility: 0.3,
        daylight: 0.8,
        social: 0.88,
      },
      schedule: [
        { startMinute: 420, endMinute: 448, activity: "sleep", roomId: bedroomId },
        { startMinute: 448, endMinute: 472, activity: "relax", roomId: livingId },
        { startMinute: 472, endMinute: 484, activity: "bathroom", roomId: bathroomId },
        { startMinute: 484, endMinute: 540, activity: "relax", roomId: bedroomId },
        { startMinute: 930, endMinute: 1030, activity: "watchTv", roomId: livingId },
        { startMinute: 1080, endMinute: 1130, activity: "eat", roomId: kitchenId },
        { startMinute: 1130, endMinute: 1230, activity: "relax", roomId: livingId },
        { startMinute: 1230, endMinute: 1320, activity: "sleep", roomId: bedroomId },
      ],
    },
  ];
}

/**
 * Event-labeled simulation household for the Canonical Family of Four, with rich
 * human-readable `eventLabel` & `eventType` story beats for Morning Routine & Normal Day.
 *
 * Notice how in the 07:00–09:00 Morning Routine:
 * - Kevin (`cook` at sink/stove `07:40–08:10`) and Alice (`eat` at breakfast table `07:43–08:12`)
 *   overlap in the kitchen — so relocating the breakfast table away from the stove/sink prep zone
 *   via Gemini Redesign still cleanly resolves `CONGESTION:kitchen`!
 * - Meanwhile Leo (Brother) and Maya (Sister) wake up, cross the hallway/bathroom, use the
 *   bedroom desk and living-room TV (`08:02–09:00` overlapping Kevin's `08:10` WFH call in living room -> `NOISE_CONFLICT`!),
 *   creating a genuinely alive 4-person household with visible height differences.
 *
 * @param {object} [house]
 */
export function createFamilyOfFourSimulationHousehold(house) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const bedroomId = pickRoomId(rooms, "bedroom", "bedroom");
  const bathroomId = pickRoomId(rooms, "bathroom", "bathroom");
  const kitchenId = pickRoomId(rooms, "kitchen", "kitchen");
  const livingId = pickRoomId(rooms, "living-room", "living");
  const hasExteriorDoor = (house?.doors || []).some((d) => d.kind === "exterior");

  return [
    {
      id: "kevin",
      name: "Kevin (Dad)",
      role: "dad",
      ageGroup: "adult",
      color: "#3d6b82",
      heightMeters: 1.83,
      eyeHeightMeters: 1.67,
      movementSpeedMps: 1.34,
      currentRoomId: bedroomId,
      needs: {
        privacy: 0.8,
        quiet: 0.9,
        accessibility: 0.25,
        daylight: 0.7,
        social: 0.55,
      },
      schedule: [
        {
          startMinute: 420,
          endMinute: 432,
          activity: "wake",
          eventType: "wake_up",
          eventLabel: "Wake up",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 432,
          endMinute: 444,
          activity: "bathroom",
          eventType: "use_bathroom",
          eventLabel: "Morning bathroom",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 444,
          endMinute: 460,
          activity: "other",
          eventType: "dress_ready",
          eventLabel: "Get dressed",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 460,
          endMinute: 490,
          activity: "cook",
          eventType: "prepare_breakfast",
          eventLabel: "Prepare family breakfast",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 490,
          endMinute: 720,
          activity: "work",
          eventType: "wfh_call",
          eventLabel: "Morning WFH call",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 720,
          endMinute: 765,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Lunch break",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 765,
          endMinute: 1035,
          activity: "work",
          eventType: "wfh_call",
          eventLabel: "Afternoon WFH focus",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 1080,
          endMinute: 1140,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Family dinner",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 1140,
          endMinute: 1290,
          activity: "relax",
          eventType: "evening_relax",
          eventLabel: "Evening wind-down",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 1290,
          endMinute: 1320,
          activity: "sleep",
          eventType: "bedtime",
          eventLabel: "Bedtime",
          destination: { type: "room", roomId: bedroomId },
        },
      ],
    },
    {
      id: "alice",
      name: "Alice (Mom)",
      role: "mom",
      ageGroup: "adult",
      color: "#b55d3f",
      heightMeters: 1.66,
      eyeHeightMeters: 1.51,
      movementSpeedMps: 1.28,
      currentRoomId: bedroomId,
      needs: {
        privacy: 0.75,
        quiet: 0.8,
        accessibility: 0.35,
        daylight: 0.85,
        social: 0.72,
      },
      schedule: [
        {
          startMinute: 420,
          endMinute: 444,
          activity: "wake",
          eventType: "wake_up",
          eventLabel: "Wake up & check schedule",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 444,
          endMinute: 458,
          activity: "bathroom",
          eventType: "use_bathroom",
          eventLabel: "Use bathroom (crosses Dad in hallway)",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 458,
          endMinute: 492,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Sit for breakfast & pack lunches",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 492,
          endMinute: 540,
          activity: "other",
          eventType: "school_dropoff",
          eventLabel: hasExteriorDoor ? "Head out for errands" : "Morning check-in",
          destination: hasExteriorDoor
            ? { type: "exit" }
            : { type: "room", roomId: livingId },
        },
        {
          startMinute: 720,
          endMinute: 765,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Midday lunch",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 960,
          endMinute: 1065,
          activity: "work",
          eventType: "wfh_call",
          eventLabel: "Household planning",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 1065,
          endMinute: 1140,
          activity: "cook",
          eventType: "prepare_breakfast",
          eventLabel: "Cook dinner",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 1140,
          endMinute: 1320,
          activity: "sleep",
          eventType: "bedtime",
          eventLabel: "Read & bedtime",
          destination: { type: "room", roomId: bedroomId },
        },
      ],
    },
    {
      id: "leo",
      name: "Leo (Brother)",
      role: "brother",
      ageGroup: "teen",
      color: "#5a7d5a",
      heightMeters: 1.74,
      eyeHeightMeters: 1.58,
      movementSpeedMps: 1.38,
      currentRoomId: bedroomId,
      needs: {
        privacy: 0.85,
        quiet: 0.82,
        accessibility: 0.15,
        daylight: 0.6,
        social: 0.65,
      },
      schedule: [
        {
          startMinute: 420,
          endMinute: 458,
          activity: "sleep",
          eventType: "wake_up",
          eventLabel: "Sleep in / wake up",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 458,
          endMinute: 470,
          activity: "bathroom",
          eventType: "use_bathroom",
          eventLabel: "Teen bathroom turn",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 470,
          endMinute: 512,
          activity: "study",
          eventType: "homework",
          eventLabel: "Review homework at bedroom desk",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 512,
          endMinute: 540,
          activity: "relax",
          eventType: "leave_school",
          eventLabel: "Pack backpack for school",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 900,
          endMinute: 1050,
          activity: "study",
          eventType: "homework",
          eventLabel: "Afternoon homework",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 1080,
          endMinute: 1135,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Dinner with family",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 1135,
          endMinute: 1290,
          activity: "watchTv",
          eventType: "watch_tv",
          eventLabel: "Evening console gaming",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 1290,
          endMinute: 1320,
          activity: "sleep",
          eventType: "bedtime",
          eventLabel: "Bedtime",
          destination: { type: "room", roomId: bedroomId },
        },
      ],
    },
    {
      id: "maya",
      name: "Maya (Sister)",
      role: "sister",
      ageGroup: "child",
      color: "#8a638e",
      heightMeters: 1.3,
      eyeHeightMeters: 1.18,
      movementSpeedMps: 1.18,
      currentRoomId: bedroomId,
      needs: {
        privacy: 0.4,
        quiet: 0.45,
        accessibility: 0.3,
        daylight: 0.8,
        social: 0.88,
      },
      schedule: [
        {
          startMinute: 420,
          endMinute: 448,
          activity: "sleep",
          eventType: "wake_up",
          eventLabel: "Wake up",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 448,
          endMinute: 471,
          activity: "relax",
          eventType: "morning_play",
          eventLabel: "Play in living room",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 471,
          endMinute: 484,
          activity: "bathroom",
          eventType: "use_bathroom",
          eventLabel: "Brush teeth",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 484,
          endMinute: 515,
          activity: "watchTv",
          eventType: "watch_tv",
          eventLabel: "Watch morning cartoons",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 515,
          endMinute: 540,
          activity: "relax",
          eventType: "morning_play",
          eventLabel: "Get ready for school",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 930,
          endMinute: 1030,
          activity: "watchTv",
          eventType: "watch_tv",
          eventLabel: "Afternoon cartoons (TV on)",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 1080,
          endMinute: 1130,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Sit to eat dinner",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 1130,
          endMinute: 1220,
          activity: "relax",
          eventType: "evening_play",
          eventLabel: "Story time",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 1220,
          endMinute: 1320,
          activity: "sleep",
          eventType: "bedtime",
          eventLabel: "Early bedtime",
          destination: { type: "room", roomId: bedroomId },
        },
      ],
    },
  ];
}
