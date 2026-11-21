import assert from "node:assert/strict";
import test from "node:test";
import { validateHouseGeometry } from "./src/lib/validators/house-validator.js";
import { analyzeFloorplan } from "./src/spatial/floorplan-ai-adapter.js";
import {
  computeManualCalibration,
  convertDistanceToMeters,
  feetInchesToMeters,
  parseDimensionPairToMeters,
  parseDimensionTextToMeters,
} from "./src/spatial/floorplan-calibration.js";
import {
  applyImportCorrection,
  buildImportSessionFromCandidate,
  calibrateImportSession,
  clearConfirmedImportedHouse,
  confirmImportedHouse,
  createManualCalibrationFallbackSession,
  getConfirmedImportedHouse,
  importFloorplanImage,
  importSampleFloorplan,
} from "./src/spatial/floorplan-importer.js";

test("Test 1 — Valid house: bundled sample floorplan produces valid multi-room House JSON", () => {
  const session = importSampleFloorplan();
  assert.equal(session.status, "ready");
  assert.equal(session.calibrationRequired, false);
  assert.equal(session.validation.valid, true);
  assert.equal(session.validation.errors.length, 0);

  const { house } = session;
  assert.equal(house.units, "meters");
  assert.equal(house.rooms.length, 5);
  assert.equal(house.doors.length, 6);
  assert.equal(house.windows.length, 4);
  assert.equal(house.fixtures.length, 7);
  assert.equal(house.calibration.source, "printed_dimension");
  assert.equal(house.calibration.metersPerPixel, 0.01);
  assert.equal(house.bounds.width, 9.6);
  assert.equal(house.bounds.depth, 8.6);

  // Verify room adjacency graph connects hallway to living-room, kitchen, bedroom, bathroom
  assert(
    house.adjacency.some(
      (edge) =>
        edge.fromRoomId === "hallway" &&
        edge.toRoomId === "bedroom" &&
        edge.viaDoorId === "door-bedroom",
    ),
  );
});

test("Test 2 — Duplicate room ID: validator flags duplicate and missing room IDs", () => {
  const { house } = importSampleFloorplan();
  const duplicate = structuredClone(house);
  duplicate.rooms[1].id = duplicate.rooms[0].id;

  const result = validateHouseGeometry(duplicate);
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.code === "DUPLICATE_ROOM_ID"));

  const missingId = structuredClone(house);
  missingId.rooms[0].id = "";
  const missingResult = validateHouseGeometry(missingId);
  assert.equal(missingResult.valid, false);
  assert(missingResult.errors.some((e) => e.code === "MISSING_ROOM_ID"));
});

test("Test 3 — Invalid polygon: validator rejects <3 vertices, zero area, NaN, and self-intersections", () => {
  const { house } = importSampleFloorplan();

  // Fewer than 3 vertices
  const tooFew = structuredClone(house);
  tooFew.rooms[0].polygon = [
    [0, 0],
    [4, 0],
  ];
  assert(
    validateHouseGeometry(tooFew).errors.some(
      (e) => e.code === "INVALID_POLYGON_VERTICES",
    ),
  );

  // Collinear zero-area polygon
  const zeroArea = structuredClone(house);
  zeroArea.rooms[0].polygon = [
    [0, 0],
    [2, 0],
    [4, 0],
  ];
  assert(
    validateHouseGeometry(zeroArea).errors.some(
      (e) => e.code === "ZERO_AREA_POLYGON",
    ),
  );

  // Self-intersecting bowtie polygon
  const bowtie = structuredClone(house);
  bowtie.rooms[0].polygon = [
    [0, 0],
    [4, 4],
    [4, 0],
    [0, 4],
  ];
  assert(
    validateHouseGeometry(bowtie).errors.some(
      (e) => e.code === "SELF_INTERSECTING_POLYGON",
    ),
  );

  // NaN / Infinity coordinates
  const badCoords = structuredClone(house);
  badCoords.rooms[0].polygon[1] = [Number.NaN, Infinity];
  assert(
    validateHouseGeometry(badCoords).errors.some(
      (e) => e.code === "INVALID_COORDINATES",
    ),
  );
});

test("Test 4 — Invalid door reference & window off wall: validator catches bad references", () => {
  const { house } = importSampleFloorplan();
  const brokenDoor = structuredClone(house);
  brokenDoor.doors[1].roomB = "non-existent-attic";

  const doorResult = validateHouseGeometry(brokenDoor);
  assert.equal(doorResult.valid, false);
  assert(doorResult.errors.some((e) => e.code === "INVALID_DOOR_ROOM_REF"));

  const floatingWindow = structuredClone(house);
  floatingWindow.windows[0].position = [2.9, 2.1]; // Middle of living room floor, far from walls
  const winResult = validateHouseGeometry(floatingWindow);
  assert.equal(winResult.valid, false);
  assert(winResult.errors.some((e) => e.code === "WINDOW_OFF_WALL"));
});

test("Test 5 — Calibration: known pixel distance + known physical distance produces exact scale", () => {
  const cal = computeManualCalibration({
    pointA: [100, 120],
    pointB: [528, 120],
    knownDistanceMeters: 3.66,
  });
  assert.equal(cal.source, "manual_calibration");
  assert.equal(cal.pixelDistance, 428);
  assert.equal(cal.knownDistanceMeters, 3.66);
  assert(Math.abs(cal.metersPerPixel - 3.66 / 428) < 1e-6);

  // Verify scaling an uncalibrated candidate using manual calibration
  const uncalibratedSession = buildImportSessionFromCandidate({
    id: "uncalibrated-apt",
    name: "Uncalibrated Apt",
    imageWidth: 800,
    imageHeight: 600,
    rooms: [
      {
        id: "living",
        name: "Living Room",
        polygonPx: [
          [0, 0],
          [400, 0],
          [400, 300],
          [0, 300],
        ],
      },
    ],
    doors: [
      {
        id: "door-1",
        kind: "exterior",
        roomA: "living",
        roomB: null,
        positionPx: [0, 150],
        widthPx: 90,
      },
    ],
    windows: [],
    fixtures: [],
  });
  assert.equal(uncalibratedSession.calibrationRequired, true);

  const calibrated = calibrateImportSession(uncalibratedSession, {
    pointA: [0, 0],
    pointB: [400, 0],
    knownDistanceMeters: 4.8,
  });
  assert.equal(calibrated.calibrationRequired, false);
  assert.equal(calibrated.validation.valid, true);
  assert.equal(calibrated.house.calibration.source, "manual_calibration");
  assert.equal(calibrated.house.calibration.metersPerPixel, 0.012);
  assert.equal(calibrated.house.bounds.width, 4.8);
  assert.equal(calibrated.house.bounds.depth, 3.6);
  assert.equal(calibrated.house.doors[0].width, 1.08);
});

test("Test 6 — Unit conversion: feet/inches, feet, cm, mm, and printed dimension parsing", () => {
  // 12' 6" = 3.81 m exact
  assert(Math.abs(feetInchesToMeters(12, 6) - 3.81) < 1e-9);
  assert(
    Math.abs(
      convertDistanceToMeters({ feet: 10, inches: 2 }, "feet_inches") - 3.0988,
    ) < 1e-9,
  );
  assert(Math.abs(convertDistanceToMeters(12, "ft") - 3.6576) < 1e-9);
  assert(Math.abs(convertDistanceToMeters(365, "cm") - 3.65) < 1e-9);
  assert(Math.abs(convertDistanceToMeters(3650, "mm") - 3.65) < 1e-9);

  assert(Math.abs(parseDimensionTextToMeters(`12' 6"`) - 3.81) < 1e-9);
  assert(Math.abs(parseDimensionTextToMeters(`3.65 m`) - 3.65) < 1e-9);
  assert.equal(parseDimensionTextToMeters("unknown"), null);

  const pair = parseDimensionPairToMeters(`12' 6" × 10' 2"`);
  assert(pair);
  assert(Math.abs(pair.firstMeters - 3.81) < 1e-9);
  assert(Math.abs(pair.secondMeters - 3.0988) < 1e-9);
});

test("Test 7 — Fixture locking: imported fixed fixtures have locked: true and unlocked fixtures fail validation", () => {
  const { house } = importSampleFloorplan();
  assert(house.fixtures.length > 0);
  assert.equal(
    house.fixtures.every((fixture) => fixture.locked === true),
    true,
  );

  const unlocked = structuredClone(house);
  unlocked.fixtures[0].locked = false;
  const check = validateHouseGeometry(unlocked);
  assert.equal(check.valid, false);
  assert(check.errors.some((e) => e.code === "UNLOCKED_FIXTURE"));
});

test("Test 8 — Missing scale: importer explicitly reports calibration required and blocks confirmation", () => {
  const session = buildImportSessionFromCandidate({
    id: "no-scale-plan",
    name: "No Scale Floorplan",
    rooms: [
      {
        id: "bedroom-1",
        name: "Bedroom",
        polygonPx: [
          [50, 50],
          [350, 50],
          [350, 300],
          [50, 300],
        ],
      },
    ],
    doors: [],
    windows: [],
    fixtures: [],
  });

  assert.equal(session.calibrationRequired, true);
  assert.equal(session.house.calibration.source, "unknown");
  assert.equal(session.house.calibration.metersPerPixel, null);
  assert.equal(session.validation.valid, false);
  assert(session.validation.errors.some((e) => e.code === "MISSING_SCALE"));
  assert(
    session.house.warnings.some((w) => /manual calibration required/i.test(w)),
  );
  assert.throws(() => confirmImportedHouse(session), /calibration/i);
});

test("Scale sanity rejects absurd room sizes (0.05m bedroom or 900m house)", () => {
  const { house } = importSampleFloorplan();

  const tinyBedroom = structuredClone(house);
  tinyBedroom.rooms = [
    {
      id: "bedroom",
      name: "Bedroom",
      kind: "bedroom",
      polygon: [
        [0, 0],
        [0.05, 0],
        [0.05, 0.05],
        [0, 0.05],
      ],
    },
  ];
  tinyBedroom.doors = [];
  tinyBedroom.windows = [];
  tinyBedroom.fixtures = [];
  assert(
    validateHouseGeometry(tinyBedroom).errors.some(
      (e) => e.code === "ABSURD_ROOM_SCALE" || e.code === "ABSURD_HOUSE_SCALE",
    ),
  );

  const giantHouse = structuredClone(house);
  giantHouse.rooms = [
    {
      id: "mega-room",
      name: "Living Room",
      kind: "living",
      polygon: [
        [0, 0],
        [900, 0],
        [900, 500],
        [0, 500],
      ],
    },
  ];
  giantHouse.doors = [];
  giantHouse.windows = [];
  giantHouse.fixtures = [];
  assert(
    validateHouseGeometry(giantHouse).errors.some(
      (e) => e.code === "ABSURD_HOUSE_SCALE" || e.code === "ABSURD_ROOM_SCALE",
    ),
  );
});

test("Mocked Gemini adapter, failure recovery, manual corrections, and confirmed house store", async () => {
  clearConfirmedImportedHouse();
  assert.equal(getConfirmedImportedHouse(), null);

  // Mock Gemini success
  const mockImage = {
    name: "Test Apartment",
    mimeType: "image/png",
    width: 600,
    height: 400,
    dataUrl: "data:image/png;base64,AAAA",
    base64Data: "AAAA",
  };

  const mockedCandidate = await analyzeFloorplan(mockImage, {
    analyzer: async () => ({
      name: "Mocked Loft",
      confidence: 0.87,
      warnings: ["Bathroom west wall partially obscured."],
      printedDimensions: [
        { text: "12' 0\"", startPx: [0, 0], endPx: [365.76, 0], confidence: 0.9 },
      ],
      rooms: [
        {
          id: "living",
          name: "Living Area",
          polygonPx: [
            [0, 0],
            [365.76, 0],
            [365.76, 300],
            [0, 300],
          ],
        },
        {
          id: "bath",
          name: "Bath",
          polygonPx: [
            [365.76, 0],
            [565.76, 0],
            [565.76, 300],
            [365.76, 300],
          ],
        },
        {
          id: "false-room",
          name: "Artifact Noise",
          polygonPx: [
            [0, 300],
            [180, 300],
            [180, 420],
            [0, 420],
          ],
        },
      ],
      doors: [
        {
          id: "door-bath",
          kind: "interior",
          roomA: "living",
          roomB: "bath",
          positionPx: [365.76, 150],
          widthPx: 80,
        },
      ],
      windows: [],
      fixtures: [
        {
          id: "fix-toilet",
          kind: "toilet",
          name: "Toilet",
          roomId: "bath",
          positionPx: [480, 120],
          widthPx: 46,
          depthPx: 68,
        },
      ],
    }),
  });

  let session = buildImportSessionFromCandidate(mockedCandidate);
  assert.equal(session.validation.valid, true);
  assert.equal(session.house.rooms.length, 3);

  // Manual corrections: remove false room, rename room, add window, add door
  session = applyImportCorrection(session, {
    type: "remove_room",
    roomId: "false-room",
  });
  assert.equal(session.house.rooms.length, 2);

  session = applyImportCorrection(session, {
    type: "rename_room",
    roomId: "living",
    name: "Main Living Studio",
  });
  assert.equal(session.house.rooms[0].name, "Main Living Studio");

  session = applyImportCorrection(session, {
    type: "add_window",
    roomId: "living",
    width: 1.5,
  });
  assert.equal(session.house.windows.length, 1);

  session = applyImportCorrection(session, {
    type: "add_door",
    roomA: "living",
    kind: "exterior",
    width: 0.9,
  });
  assert.equal(session.house.doors.length, 2);
  assert.equal(session.validation.valid, true);

  const confirmed = confirmImportedHouse(session);
  assert.deepEqual(getConfirmedImportedHouse(), confirmed);
  assert.equal("rawCandidate" in confirmed, false);
  assert.equal(confirmed.fixtures[0].locked, true);

  // Mock Gemini failure never throws and supports manual fallback
  const failedSession = await importFloorplanImage(mockImage, {
    analyzer: async () => {
      throw new Error("Simulated Gemini outage");
    },
  });
  assert.equal(failedSession.status, "failed");
  assert.match(failedSession.error, /Simulated Gemini outage/);

  const fallback = createManualCalibrationFallbackSession({
    imageUrl: mockImage.dataUrl,
    imageWidth: 600,
    imageHeight: 400,
  });
  assert.equal(fallback.calibrationRequired, true);
  const calibratedFallback = calibrateImportSession(fallback, {
    pointA: [72, 48],
    pointB: [324, 48],
    distanceValue: 14,
    unit: "ft",
  });
  assert.equal(calibratedFallback.validation.valid, true);
  clearConfirmedImportedHouse();
});
