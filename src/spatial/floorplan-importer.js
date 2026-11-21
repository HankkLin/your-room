import { HOUSE_UNITS } from "../contracts/scene.js";
import { validateHouseGeometry } from "../lib/validators/house-validator.js";
import {
  ALLOWED_FLOORPLAN_MIME_TYPES,
  analyzeFloorplan,
} from "./floorplan-ai-adapter.js";
import {
  computeManualCalibration,
  resolveCandidateScale,
} from "./floorplan-calibration.js";
import {
  buildRoomAdjacencyGraph,
  deriveWallsFromRooms,
  findNearestWall,
  inferRoomKind,
  isFinitePoint2D,
  normalizeDoorKind,
  normalizeHouseGeometry,
  polygonArea,
  polygonBounds,
  slugifyId,
} from "./floorplan-geometry.js";
import {
  SAMPLE_FLOORPLAN_ASSET_URL,
  createSampleFloorplanCandidate,
} from "./sample-floorplan.js";

export const IMPORTED_HOUSE_STORAGE_KEY = "stillroom.importedHouse.v1";

let confirmedImportedHouse = null;
const confirmedListeners = new Set();

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

function readStoredHouse() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(IMPORTED_HOUSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const check = validateHouseGeometry(parsed);
    return check.valid ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredHouse(house) {
  if (typeof localStorage === "undefined") return;
  try {
    if (house) {
      localStorage.setItem(IMPORTED_HOUSE_STORAGE_KEY, JSON.stringify(house));
    } else {
      localStorage.removeItem(IMPORTED_HOUSE_STORAGE_KEY);
    }
  } catch {
    // Session-only fallback when storage is unavailable
  }
}

function notifyConfirmedHouse(house) {
  for (const listener of confirmedListeners) {
    try {
      listener(house ? structuredClone(house) : null);
    } catch {
      // Isolate listener errors
    }
  }
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(
      new CustomEvent("stillroom:house-imported", {
        detail: { house: house ? structuredClone(house) : null },
      }),
    );
  }
}

/**
 * Preprocess an uploaded floorplan image file in the browser into a bounded
 * data URL + base64 payload suitable for display and Gemini extraction.
 *
 * @param {File} file
 */
export async function preprocessFloorplanFile(file) {
  if (!file) {
    throw new Error("Select a PNG, JPG, or WEBP floorplan image.");
  }
  if (!ALLOWED_FLOORPLAN_MIME_TYPES.includes(file.type)) {
    throw new Error("Supported floorplan formats: PNG, JPG/JPEG, and WEBP.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Choose a floorplan image smaller than 20 MB.");
  }

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = blobUrl;
    await img.decode();

    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const outputMime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(
      outputMime,
      outputMime === "image/jpeg" ? 0.88 : undefined,
    );
    const commaIdx = dataUrl.indexOf(",");
    const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : "";

    return {
      name: file.name.replace(/\.[^.]+$/, "") || "Uploaded Floorplan",
      mimeType: outputMime,
      width,
      height,
      dataUrl,
      base64Data,
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Run deterministic scale resolution, normalization, and validation on a candidate.
 */
export function buildImportSessionFromCandidate(candidate, meta = {}) {
  const { calibration, scaleWarnings } = resolveCandidateScale(candidate);
  const house = normalizeHouseGeometry(candidate, {
    calibration,
    extraWarnings: scaleWarnings,
  });
  const validation = validateHouseGeometry(house);

  return {
    status: "ready",
    mode: meta.mode || "upload",
    imageUrl: meta.imageUrl || null,
    imageWidth: Number(meta.imageWidth || candidate.imageWidth || 1000),
    imageHeight: Number(meta.imageHeight || candidate.imageHeight || 800),
    rawCandidate: structuredClone(candidate),
    house,
    validation,
    calibrationRequired: validation.calibrationRequired,
    manuallyEdited: false,
    error: null,
  };
}

/**
 * Load the deterministic bundled multi-room sample floorplan.
 */
export function importSampleFloorplan() {
  const candidate = createSampleFloorplanCandidate();
  return buildImportSessionFromCandidate(candidate, {
    mode: "sample",
    imageUrl: SAMPLE_FLOORPLAN_ASSET_URL,
    imageWidth: candidate.imageWidth,
    imageHeight: candidate.imageHeight,
  });
}

/**
 * Analyze a preprocessed floorplan image via the Gemini adapter and validate the output.
 * Never throws unhandled errors into the UI: returns a structured `status: "failed"`
 * session so the user can choose sample / retry / manual calibration.
 */
export async function importFloorplanImage(preprocessedImage, options = {}) {
  try {
    const candidate = await analyzeFloorplan(preprocessedImage, options);
    if (preprocessedImage.name && candidate.name === "Imported Floorplan Home") {
      candidate.name = preprocessedImage.name;
    }
    return buildImportSessionFromCandidate(candidate, {
      mode: "upload",
      imageUrl: preprocessedImage.dataUrl,
      imageWidth: preprocessedImage.width,
      imageHeight: preprocessedImage.height,
    });
  } catch (err) {
    return {
      status: "failed",
      mode: "upload",
      imageUrl: preprocessedImage?.dataUrl ?? null,
      imageWidth: Number(preprocessedImage?.width) || 1000,
      imageHeight: Number(preprocessedImage?.height) || 800,
      rawCandidate: null,
      house: null,
      validation: null,
      calibrationRequired: true,
      manuallyEdited: false,
      error:
        err?.message ||
        "Analysis failed. Use sample, retry, or calibrate manually.",
    };
  }
}

/**
 * Create a manual uncalibrated starter shell over an uploaded floorplan image
 * when Gemini analysis is unavailable, allowing two-point calibration + manual repair.
 */
export function createManualCalibrationFallbackSession({
  imageUrl,
  imageWidth = 1000,
  imageHeight = 800,
  name = "Manual Floorplan Import",
} = {}) {
  const padX = Math.round(imageWidth * 0.12);
  const padY = Math.round(imageHeight * 0.12);
  const midX = Math.round(imageWidth * 0.54);
  const rightX = imageWidth - padX;
  const bottomY = imageHeight - padY;

  const starterCandidate = {
    id: "manual-imported-house",
    name,
    coordinateSpace: "image_pixels",
    imageWidth,
    imageHeight,
    confidence: 0.6,
    warnings: [
      "AI extraction was unavailable; starter room boundaries created for manual calibration and adjustment.",
    ],
    rooms: [
      {
        id: "living-room",
        name: "Living Room",
        kind: "living",
        polygonPx: [
          [padX, padY],
          [midX, padY],
          [midX, bottomY],
          [padX, bottomY],
        ],
        confidence: 0.6,
      },
      {
        id: "bedroom",
        name: "Bedroom",
        kind: "bedroom",
        polygonPx: [
          [midX, padY],
          [rightX, padY],
          [rightX, bottomY],
          [midX, bottomY],
        ],
        confidence: 0.6,
      },
    ],
    doors: [
      {
        id: "door-entry",
        kind: "exterior",
        roomA: "living-room",
        roomB: null,
        positionPx: [padX, Math.round((padY + bottomY) / 2)],
        widthPx: Math.round(imageWidth * 0.08),
        confidence: 0.6,
      },
      {
        id: "door-interior-1",
        kind: "interior",
        roomA: "living-room",
        roomB: "bedroom",
        positionPx: [midX, Math.round((padY + bottomY) / 2)],
        widthPx: Math.round(imageWidth * 0.075),
        confidence: 0.6,
      },
    ],
    windows: [
      {
        id: "window-1",
        roomId: "living-room",
        positionPx: [Math.round((padX + midX) / 2), padY],
        widthPx: Math.round(imageWidth * 0.15),
        confidence: 0.6,
      },
    ],
    fixtures: [],
  };

  return buildImportSessionFromCandidate(starterCandidate, {
    mode: "manual",
    imageUrl,
    imageWidth,
    imageHeight,
  });
}

function scaleEditedHouse(house, newCalibration, previousFactor) {
  const ratio = newCalibration.metersPerPixel / previousFactor;
  const scale2D = (pt) => [round3(pt[0] * ratio), round3(pt[1] * ratio)];

  const rooms = house.rooms.map((room) => {
    const polygon = room.polygon.map(scale2D);
    return {
      ...room,
      polygon,
      areaSqMeters: round3(polygonArea(polygon)),
    };
  });

  const walls = deriveWallsFromRooms(rooms, [], house.ceilingHeight);

  const doors = house.doors.map((door) => ({
    ...door,
    position: scale2D(door.position),
    width: door.width != null ? round3(door.width * ratio) : null,
  }));

  const windows = house.windows.map((win) => ({
    ...win,
    position: scale2D(win.position),
    width: round3(win.width * ratio),
  }));

  const fixtures = house.fixtures.map((fix) => ({
    ...fix,
    position: [
      round3(fix.position[0] * ratio),
      fix.position[1],
      round3(fix.position[2] * ratio),
    ],
    dimensions: {
      width: round3(fix.dimensions.width * ratio),
      height: fix.dimensions.height,
      depth: round3(fix.dimensions.depth * ratio),
    },
    footprint: Array.isArray(fix.footprint) ? fix.footprint.map(scale2D) : [],
    locked: true,
  }));

  const warnings = house.warnings.filter(
    (w) => !/manual calibration required/i.test(w),
  );

  return {
    ...house,
    bounds: polygonBounds(rooms.flatMap((r) => r.polygon)),
    calibration: newCalibration,
    warnings,
    rooms,
    walls,
    doors,
    windows,
    adjacency: buildRoomAdjacencyGraph(rooms, doors),
    fixtures,
  };
}

/**
 * Apply two-point physical distance calibration to an import session.
 */
export function calibrateImportSession(session, calibrationInput) {
  if (!session || !session.house) {
    throw new Error("No floorplan session available to calibrate.");
  }

  const calibration = computeManualCalibration(calibrationInput);
  let house;

  if (!session.manuallyEdited && session.rawCandidate) {
    const filteredCandidate = {
      ...session.rawCandidate,
      warnings: (session.rawCandidate.warnings || []).filter(
        (w) => !/manual calibration required/i.test(w),
      ),
    };
    house = normalizeHouseGeometry(filteredCandidate, { calibration });
  } else {
    const previousFactor =
      Number(session.house.calibration?.metersPerPixel) > 0
        ? Number(session.house.calibration.metersPerPixel)
        : 0.01;
    house = scaleEditedHouse(session.house, calibration, previousFactor);
  }

  const validation = validateHouseGeometry(house);
  return {
    ...session,
    status: "ready",
    house,
    validation,
    calibrationRequired: validation.calibrationRequired,
    error: null,
  };
}

function recomputeDerivedHouseTopology(house) {
  const rooms = house.rooms.map((room) => ({
    ...room,
    areaSqMeters: Number.isFinite(polygonArea(room.polygon))
      ? Math.round(polygonArea(room.polygon) * 100) / 100
      : 0,
  }));
  const walls = deriveWallsFromRooms(rooms, [], house.ceilingHeight);

  const doors = house.doors.map((door) => {
    const nearest = findNearestWall(door.position, walls);
    return {
      ...door,
      wallId:
        nearest && nearest.distance <= 0.35
          ? nearest.wall.id
          : (door.wallId ?? null),
    };
  });

  const windows = house.windows.map((win) => {
    const nearest = findNearestWall(win.position, walls);
    return {
      ...win,
      wallId:
        nearest && nearest.distance <= 0.35
          ? nearest.wall.id
          : (win.wallId ?? null),
    };
  });

  return {
    ...house,
    bounds: polygonBounds(rooms.flatMap((r) => r.polygon)),
    rooms,
    walls,
    doors,
    windows,
    adjacency: buildRoomAdjacencyGraph(rooms, doors),
  };
}

function findDefaultWallMidpointForRooms(walls, roomA, roomB) {
  let targetWall = null;
  if (roomA && roomB) {
    targetWall = walls.find(
      (w) => w.roomIds.includes(roomA) && w.roomIds.includes(roomB),
    );
  }
  if (!targetWall && roomA) {
    targetWall =
      walls.find((w) => w.kind === "exterior" && w.roomIds.includes(roomA)) ||
      walls.find((w) => w.roomIds.includes(roomA));
  }
  if (!targetWall) targetWall = walls[0];
  if (!targetWall) return { position: [0, 0], wallId: null };
  return {
    position: [
      round3((targetWall.start[0] + targetWall.end[0]) / 2),
      round3((targetWall.start[1] + targetWall.end[1]) / 2),
    ],
    wallId: targetWall.id,
  };
}

/**
 * Apply a focused manual repair action to an import session and re-validate.
 *
 * Supported actions:
 * - { type: "rename_room", roomId, name, kind? }
 * - { type: "remove_room", roomId }
 * - { type: "move_vertex", roomId, vertexIndex, position: [x, z] }
 * - { type: "update_door", doorId, roomA?, roomB?, kind?, width?, position? }
 * - { type: "add_door", roomA, roomB?, kind?, width?, position? }
 * - { type: "remove_door", doorId }
 * - { type: "add_window", roomId, position?, width? }
 * - { type: "remove_window", windowId }
 */
export function applyImportCorrection(session, action) {
  if (!session?.house || !action?.type) return session;
  let nextHouse = structuredClone(session.house);

  switch (action.type) {
    case "rename_room": {
      const name = String(action.name ?? "").trim();
      if (!name) break;
      nextHouse.rooms = nextHouse.rooms.map((room) =>
        room.id === action.roomId
          ? {
              ...room,
              name,
              kind: action.kind
                ? inferRoomKind(action.kind)
                : inferRoomKind(name),
            }
          : room,
      );
      break;
    }

    case "remove_room": {
      const targetId = action.roomId;
      nextHouse.rooms = nextHouse.rooms.filter((r) => r.id !== targetId);
      nextHouse.fixtures = nextHouse.fixtures.filter(
        (f) => f.roomId !== targetId,
      );
      nextHouse.windows = nextHouse.windows.filter(
        (w) => w.roomId !== targetId,
      );
      nextHouse.doors = nextHouse.doors
        .map((door) => {
          if (door.roomA === targetId && door.roomB) {
            return { ...door, roomA: door.roomB, roomB: null, kind: "exterior" };
          }
          if (door.roomB === targetId) {
            return { ...door, roomB: null, kind: "exterior" };
          }
          return door;
        })
        .filter((door) => door.roomA !== targetId);
      nextHouse = recomputeDerivedHouseTopology(nextHouse);
      break;
    }

    case "move_vertex": {
      const idx = Number(action.vertexIndex);
      const pt = action.position;
      if (!Number.isInteger(idx) || !isFinitePoint2D(pt)) break;
      nextHouse.rooms = nextHouse.rooms.map((room) => {
        if (room.id !== action.roomId) return room;
        const polygon = room.polygon.map((v, vIdx) =>
          vIdx === idx ? [round3(pt[0]), round3(pt[1])] : v,
        );
        return { ...room, polygon };
      });
      nextHouse = recomputeDerivedHouseTopology(nextHouse);
      break;
    }

    case "update_door": {
      nextHouse.doors = nextHouse.doors.map((door) => {
        if (door.id !== action.doorId) return door;
        const roomA =
          action.roomA !== undefined ? action.roomA || null : door.roomA;
        const rawRoomB =
          action.roomB !== undefined ? action.roomB || null : door.roomB;
        const kind = normalizeDoorKind(action.kind ?? door.kind, rawRoomB);
        const roomB = kind === "exterior" ? null : rawRoomB;

        let position = door.position;
        if (isFinitePoint2D(action.position)) {
          position = [round3(action.position[0]), round3(action.position[1])];
        } else if (action.roomA !== undefined || action.roomB !== undefined) {
          const snapped = findDefaultWallMidpointForRooms(
            nextHouse.walls,
            roomA,
            roomB,
          );
          if (snapped.wallId) position = snapped.position;
        }

        const width =
          action.width !== undefined
            ? action.width === null || action.width === ""
              ? null
              : round3(Number(action.width))
            : door.width;

        return {
          ...door,
          kind,
          roomA,
          roomB,
          position,
          width,
        };
      });
      nextHouse = recomputeDerivedHouseTopology(nextHouse);
      break;
    }

    case "add_door": {
      const roomA = action.roomA || nextHouse.rooms[0]?.id || null;
      const rawRoomB = action.roomB || null;
      const kind = normalizeDoorKind(
        action.kind ?? (rawRoomB ? "interior" : "exterior"),
        rawRoomB,
      );
      const roomB = kind === "exterior" ? null : rawRoomB;
      const fallbackPlacement = findDefaultWallMidpointForRooms(
        nextHouse.walls,
        roomA,
        roomB,
      );
      const rawPos = isFinitePoint2D(action.position)
        ? [round3(action.position[0]), round3(action.position[1])]
        : fallbackPlacement.position;
      const nearest = findNearestWall(rawPos, nextHouse.walls);
      const position =
        nearest && nearest.distance <= 0.35 ? nearest.point : rawPos;

      let suffix = nextHouse.doors.length + 1;
      let id = `door-manual-${suffix}`;
      while (nextHouse.doors.some((d) => d.id === id)) {
        suffix += 1;
        id = `door-manual-${suffix}`;
      }

      nextHouse.doors.push({
        id,
        kind,
        wallId: nearest?.wall?.id ?? fallbackPlacement.wallId,
        roomA,
        roomB,
        position,
        width:
          action.width != null && action.width !== ""
            ? round3(Number(action.width))
            : 0.86,
        widthEstimated: action.width == null || action.width === "",
        height: 2.08,
        confidence: 1,
      });
      nextHouse = recomputeDerivedHouseTopology(nextHouse);
      break;
    }

    case "remove_door": {
      nextHouse.doors = nextHouse.doors.filter((d) => d.id !== action.doorId);
      nextHouse = recomputeDerivedHouseTopology(nextHouse);
      break;
    }

    case "add_window": {
      const roomId = action.roomId || nextHouse.rooms[0]?.id || null;
      const candidateWall =
        (action.wallId &&
          nextHouse.walls.find((w) => w.id === action.wallId)) ||
        nextHouse.walls.find(
          (w) => w.kind === "exterior" && w.roomIds.includes(roomId),
        ) ||
        nextHouse.walls.find((w) => w.roomIds.includes(roomId)) ||
        nextHouse.walls[0];

      const defaultPos = candidateWall
        ? [
            round3((candidateWall.start[0] + candidateWall.end[0]) / 2),
            round3((candidateWall.start[1] + candidateWall.end[1]) / 2),
          ]
        : [0, 0];
      const rawPos = isFinitePoint2D(action.position)
        ? [round3(action.position[0]), round3(action.position[1])]
        : defaultPos;
      const nearest = findNearestWall(rawPos, nextHouse.walls);
      const position = nearest ? nearest.point : rawPos;

      let suffix = nextHouse.windows.length + 1;
      let id = `window-manual-${suffix}`;
      while (nextHouse.windows.some((w) => w.id === id)) {
        suffix += 1;
        id = `window-manual-${suffix}`;
      }

      nextHouse.windows.push({
        id,
        type: "window",
        wallId: nearest?.wall?.id ?? candidateWall?.id ?? null,
        roomId: slugifyId(roomId, roomId),
        position,
        width:
          action.width != null && action.width !== ""
            ? round3(Number(action.width))
            : 1.4,
        sillHeight: 0.9,
        headHeight: 2.15,
        confidence: 1,
      });
      nextHouse = recomputeDerivedHouseTopology(nextHouse);
      break;
    }

    case "remove_window": {
      nextHouse.windows = nextHouse.windows.filter(
        (w) => w.id !== action.windowId,
      );
      break;
    }

    default:
      break;
  }

  const validation = validateHouseGeometry(nextHouse);
  return {
    ...session,
    house: nextHouse,
    validation,
    calibrationRequired: validation.calibrationRequired,
    manuallyEdited: true,
  };
}

/**
 * Strip any transient fields and return a pure meters-only House JSON ready for
 * downstream whole-home rendering and simulation.
 */
export function toCleanHouseContract(house) {
  return {
    id: house.id,
    houseId: house.houseId || house.id,
    name: house.name,
    units: HOUSE_UNITS,
    ceilingHeight: house.ceilingHeight,
    bounds: structuredClone(house.bounds),
    calibration: structuredClone(house.calibration),
    confidence: house.confidence,
    warnings: [...(house.warnings || [])],
    rooms: structuredClone(house.rooms),
    walls: structuredClone(house.walls),
    doors: structuredClone(house.doors),
    windows: structuredClone(house.windows),
    adjacency: structuredClone(house.adjacency),
    fixtures: house.fixtures.map((f) => ({
      ...structuredClone(f),
      locked: true,
    })),
    objects: structuredClone(house.objects || []),
    environment: structuredClone(house.environment || {}),
  };
}

/**
 * Validate and commit an imported house as the active confirmed whole-home geometry.
 *
 * @param {object} sessionOrHouse
 * @returns {object} Validated House JSON in meters
 */
export function confirmImportedHouse(sessionOrHouse) {
  const candidateHouse = sessionOrHouse?.house
    ? sessionOrHouse.house
    : sessionOrHouse;
  const validation = validateHouseGeometry(candidateHouse);
  if (!validation.valid) {
    const firstReason =
      validation.errors[0]?.message ||
      "House geometry failed deterministic validation.";
    throw new Error(firstReason);
  }
  const cleanHouse = toCleanHouseContract(candidateHouse);
  confirmedImportedHouse = cleanHouse;
  writeStoredHouse(cleanHouse);
  notifyConfirmedHouse(cleanHouse);
  return structuredClone(cleanHouse);
}

/**
 * Downstream interface for the `feat/whole-home-scene` renderer branch:
 *
 * ```js
 * const house = getConfirmedImportedHouse();
 * if (house) renderHouse(house);
 * ```
 *
 * Returns validated House geometry in meters, or `null` when no floorplan
 * has been confirmed yet.
 */
export function getConfirmedImportedHouse() {
  if (confirmedImportedHouse) {
    return structuredClone(confirmedImportedHouse);
  }
  const stored = readStoredHouse();
  if (stored) {
    confirmedImportedHouse = stored;
    return structuredClone(stored);
  }
  return null;
}

export function setConfirmedImportedHouse(house) {
  if (!house) {
    confirmedImportedHouse = null;
    writeStoredHouse(null);
    notifyConfirmedHouse(null);
    return null;
  }
  return confirmImportedHouse(house);
}

export function clearConfirmedImportedHouse() {
  confirmedImportedHouse = null;
  writeStoredHouse(null);
  notifyConfirmedHouse(null);
}

export function onConfirmedHouseChange(listener) {
  confirmedListeners.add(listener);
  return () => confirmedListeners.delete(listener);
}
