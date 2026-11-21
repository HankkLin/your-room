import {
  CALIBRATION_SOURCES,
  DOOR_KINDS,
  HOUSE_UNITS,
  normalizeCalibrationSource,
} from "../../contracts/scene.js";
import {
  findNearestWall,
  hasPolygonSelfIntersection,
  isFinitePoint2D,
  polygonArea,
  polygonBounds,
} from "../../spatial/floorplan-geometry.js";

function issue(code, message, path = "", details = undefined) {
  return {
    code,
    message,
    path,
    ...(details ? { details } : {}),
  };
}

function isFiniteTriple(arr) {
  return (
    Array.isArray(arr) &&
    arr.length === 3 &&
    arr.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/**
 * Deterministic validator for whole-home House JSON geometry.
 * Never mutates the input geometry.
 *
 * @param {object} house
 * @returns {{
 *   valid: boolean,
 *   calibrationRequired: boolean,
 *   errors: Array<{ code: string, message: string, path: string }>,
 *   warnings: Array<{ code: string, message: string, path: string }>,
 *   summary: {
 *     roomCount: number,
 *     wallCount: number,
 *     doorCount: number,
 *     windowCount: number,
 *     fixtureCount: number
 *   }
 * }}
 */
export function validateHouseGeometry(house) {
  const errors = [];
  const warnings = [];
  let calibrationRequired = false;

  if (!house || typeof house !== "object") {
    return {
      valid: false,
      calibrationRequired: false,
      errors: [issue("INVALID_HOUSE_OBJECT", "House geometry must be an object.", "")],
      warnings: [],
      summary: {
        roomCount: 0,
        wallCount: 0,
        doorCount: 0,
        windowCount: 0,
        fixtureCount: 0,
      },
    };
  }

  if (!house.id || typeof house.id !== "string" || !house.id.trim()) {
    errors.push(issue("MISSING_HOUSE_ID", "House must have a non-empty string id.", "id"));
  }

  if (house.units !== HOUSE_UNITS) {
    errors.push(
      issue(
        "INVALID_UNITS",
        `House units must be "${HOUSE_UNITS}", received "${String(house.units)}".`,
        "units",
      ),
    );
  }

  const ceilingHeight = Number(house.ceilingHeight);
  if (!Number.isFinite(ceilingHeight) || ceilingHeight < 1.8 || ceilingHeight > 8.0) {
    errors.push(
      issue(
        "INVALID_CEILING_HEIGHT",
        "Ceiling height must be a finite value between 1.8 m and 8.0 m.",
        "ceilingHeight",
      ),
    );
  }

  // Calibration / unknown scale check
  if (house.calibration != null) {
    const source = normalizeCalibrationSource(house.calibration.source);
    if (!CALIBRATION_SOURCES.includes(source) || source === "unknown") {
      calibrationRequired = true;
      errors.push(
        issue(
          "MISSING_SCALE",
          "No verified scale is set; manual calibration is required before confirming import.",
          "calibration.source",
        ),
      );
    } else {
      const mpp = Number(house.calibration.metersPerPixel);
      if (!Number.isFinite(mpp) || mpp <= 0) {
        calibrationRequired = true;
        errors.push(
          issue(
            "INVALID_CALIBRATION_SCALE",
            "Calibration metersPerPixel must be a positive finite number.",
            "calibration.metersPerPixel",
          ),
        );
      }
    }
  } else {
    warnings.push(
      issue(
        "MISSING_CALIBRATION_METADATA",
        "Calibration metadata omitted; assuming coordinates were authored directly in meters.",
        "calibration",
      ),
    );
  }

  const rooms = Array.isArray(house.rooms) ? house.rooms : null;
  const walls = Array.isArray(house.walls) ? house.walls : [];
  const doors = Array.isArray(house.doors) ? house.doors : [];
  const windows = Array.isArray(house.windows) ? house.windows : [];
  const fixtures = Array.isArray(house.fixtures) ? house.fixtures : [];

  if (!rooms || rooms.length === 0) {
    errors.push(
      issue("NO_ROOMS", "House geometry must contain at least one room.", "rooms"),
    );
  }

  const roomIds = new Set();
  const allHousePoints = [];

  if (rooms) {
    rooms.forEach((room, index) => {
      const basePath = `rooms[${index}]`;
      const id = typeof room?.id === "string" ? room.id.trim() : "";
      if (!id) {
        errors.push(
          issue("MISSING_ROOM_ID", `Room at index ${index} is missing an id.`, `${basePath}.id`),
        );
      } else if (roomIds.has(id)) {
        errors.push(
          issue("DUPLICATE_ROOM_ID", `Duplicate room id "${id}".`, `${basePath}.id`),
        );
      } else {
        roomIds.add(id);
      }

      const poly = room?.polygon;
      if (!Array.isArray(poly) || poly.length < 3) {
        errors.push(
          issue(
            "INVALID_POLYGON_VERTICES",
            `Room "${id || index}" polygon must have at least 3 vertices.`,
            `${basePath}.polygon`,
          ),
        );
        return;
      }

      let hasBadCoord = false;
      poly.forEach((pt, vIdx) => {
        if (!isFinitePoint2D(pt)) {
          hasBadCoord = true;
          errors.push(
            issue(
              "INVALID_COORDINATES",
              `Room "${id || index}" vertex ${vIdx} contains non-finite or missing coordinates.`,
              `${basePath}.polygon[${vIdx}]`,
            ),
          );
        } else {
          allHousePoints.push(pt);
        }
      });
      if (hasBadCoord) return;

      const selfIntersects = hasPolygonSelfIntersection(poly);
      if (selfIntersects) {
        errors.push(
          issue(
            "SELF_INTERSECTING_POLYGON",
            `Room "${id || index}" polygon has self-intersecting or folded edges.`,
            `${basePath}.polygon`,
          ),
        );
      }

      const area = polygonArea(poly);
      if (!Number.isFinite(area) || area <= 1e-4) {
        errors.push(
          issue(
            "ZERO_AREA_POLYGON",
            `Room "${id || index}" polygon has zero or degenerate area.`,
            `${basePath}.polygon`,
          ),
        );
        return;
      }

      if (selfIntersects) return;

      // Scale sanity per room (only enforce physical bounds when scale is claimed known)
      if (!calibrationRequired) {
        const bounds = polygonBounds(poly);
        const minSpan = Math.min(bounds.width, bounds.depth);
        const maxSpan = Math.max(bounds.width, bounds.depth);

        if (minSpan < 0.45 || area < 0.35 || maxSpan > 85) {
          errors.push(
            issue(
              "ABSURD_ROOM_SCALE",
              `Room "${room.name || id}" dimensions (${bounds.width.toFixed(2)} m × ${bounds.depth.toFixed(2)} m, ${area.toFixed(2)} m²) are outside residential sanity bounds.`,
              `${basePath}.polygon`,
            ),
          );
        } else if (
          ["living", "bedroom", "kitchen"].includes(room.kind) &&
          (minSpan < 1.6 || area < 3.2)
        ) {
          warnings.push(
            issue(
              "UNUSUALLY_SMALL_ROOM",
              `Room "${room.name || id}" (${bounds.width.toFixed(2)} m × ${bounds.depth.toFixed(2)} m) is unusually narrow for a ${room.kind}; verify scale calibration.`,
              `${basePath}.polygon`,
            ),
          );
        }
      }
    });
  }

  // Overall house scale sanity
  if (!calibrationRequired && allHousePoints.length >= 3) {
    const houseBounds = polygonBounds(allHousePoints);
    if (
      houseBounds.width < 1.2 ||
      houseBounds.depth < 1.2 ||
      houseBounds.width > 150 ||
      houseBounds.depth > 150
    ) {
      errors.push(
        issue(
          "ABSURD_HOUSE_SCALE",
          `Overall house footprint (${houseBounds.width.toFixed(2)} m × ${houseBounds.depth.toFixed(2)} m) is outside plausible residential bounds (1.2 m – 150 m).`,
          "bounds",
        ),
      );
    } else if (houseBounds.width > 45 || houseBounds.depth > 45) {
      warnings.push(
        issue(
          "LARGE_HOUSE_FOOTPRINT",
          `House footprint (${houseBounds.width.toFixed(1)} m × ${houseBounds.depth.toFixed(1)} m) is very large; double-check calibration units.`,
          "bounds",
        ),
      );
    }
  }

  // Walls validation
  const wallIds = new Set();
  walls.forEach((wall, index) => {
    const basePath = `walls[${index}]`;
    const id = typeof wall?.id === "string" ? wall.id.trim() : "";
    if (!id) {
      errors.push(issue("MISSING_WALL_ID", `Wall ${index} is missing an id.`, `${basePath}.id`));
    } else if (wallIds.has(id)) {
      errors.push(issue("DUPLICATE_WALL_ID", `Duplicate wall id "${id}".`, `${basePath}.id`));
    } else {
      wallIds.add(id);
    }

    if (!isFinitePoint2D(wall?.start) || !isFinitePoint2D(wall?.end)) {
      errors.push(
        issue(
          "INVALID_COORDINATES",
          `Wall "${id || index}" has invalid start/end coordinates.`,
          basePath,
        ),
      );
      return;
    }

    const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    if (len < 0.02) {
      errors.push(
        issue("ZERO_LENGTH_WALL", `Wall "${id || index}" has zero length.`, basePath),
      );
    }
  });

  // Doors validation
  const doorIds = new Set();
  doors.forEach((door, index) => {
    const basePath = `doors[${index}]`;
    const id = typeof door?.id === "string" ? door.id.trim() : "";
    if (!id) {
      errors.push(issue("MISSING_DOOR_ID", `Door ${index} is missing an id.`, `${basePath}.id`));
    } else if (doorIds.has(id)) {
      errors.push(issue("DUPLICATE_DOOR_ID", `Duplicate door id "${id}".`, `${basePath}.id`));
    } else {
      doorIds.add(id);
    }

    if (!isFinitePoint2D(door?.position)) {
      errors.push(
        issue(
          "INVALID_COORDINATES",
          `Door "${id || index}" has invalid position coordinates.`,
          `${basePath}.position`,
        ),
      );
    }

    const kind = door?.kind ?? "interior";
    if (!DOOR_KINDS.includes(kind)) {
      errors.push(
        issue(
          "INVALID_DOOR_KIND",
          `Door "${id || index}" has unsupported kind "${String(kind)}".`,
          `${basePath}.kind`,
        ),
      );
    }

    if (!door?.roomA || !roomIds.has(door.roomA)) {
      errors.push(
        issue(
          "INVALID_DOOR_ROOM_REF",
          `Door "${id || index}" references unknown roomA "${String(door?.roomA)}".`,
          `${basePath}.roomA`,
        ),
      );
    }

    if (door?.roomB != null && !roomIds.has(door.roomB)) {
      errors.push(
        issue(
          "INVALID_DOOR_ROOM_REF",
          `Door "${id || index}" references unknown roomB "${String(door?.roomB)}".`,
          `${basePath}.roomB`,
        ),
      );
    }

    if (kind === "interior") {
      if (!door?.roomB) {
        warnings.push(
          issue(
            "INCOMPLETE_INTERIOR_DOOR",
            `Interior door "${id || index}" has only one connected room (${door?.roomA ?? "none"}).`,
            `${basePath}.roomB`,
          ),
        );
      } else if (door.roomA === door.roomB) {
        errors.push(
          issue(
            "INVALID_DOOR_CONNECTION",
            `Door "${id || index}" connects room "${door.roomA}" to itself.`,
            basePath,
          ),
        );
      }
    }

    if (door?.width != null) {
      const w = Number(door.width);
      if (!Number.isFinite(w) || w <= 0.2 || w > 6.0) {
        errors.push(
          issue(
            "INVALID_DOOR_WIDTH",
            `Door "${id || index}" width (${String(door.width)} m) must be null or between 0.2 m and 6.0 m.`,
            `${basePath}.width`,
          ),
        );
      }
    }

    if (walls.length > 0 && isFinitePoint2D(door?.position)) {
      const nearest = findNearestWall(door.position, walls);
      if (nearest && nearest.distance > 0.45) {
        warnings.push(
          issue(
            "DOOR_OFF_WALL",
            `Door "${id || index}" lies ${nearest.distance.toFixed(2)} m away from the nearest wall.`,
            `${basePath}.position`,
          ),
        );
      }
    }
  });

  // Windows validation
  const windowIds = new Set();
  windows.forEach((win, index) => {
    const basePath = `windows[${index}]`;
    const id = typeof win?.id === "string" ? win.id.trim() : "";
    if (!id) {
      errors.push(
        issue("MISSING_WINDOW_ID", `Window ${index} is missing an id.`, `${basePath}.id`),
      );
    } else if (windowIds.has(id)) {
      errors.push(
        issue("DUPLICATE_WINDOW_ID", `Duplicate window id "${id}".`, `${basePath}.id`),
      );
    } else {
      windowIds.add(id);
    }

    if (!isFinitePoint2D(win?.position)) {
      errors.push(
        issue(
          "INVALID_COORDINATES",
          `Window "${id || index}" has invalid position coordinates.`,
          `${basePath}.position`,
        ),
      );
      return;
    }

    if (win?.roomId != null && !roomIds.has(win.roomId)) {
      errors.push(
        issue(
          "INVALID_WINDOW_ROOM_REF",
          `Window "${id || index}" references unknown room "${String(win.roomId)}".`,
          `${basePath}.roomId`,
        ),
      );
    }

    if (win?.wallId != null && wallIds.size > 0 && !wallIds.has(win.wallId)) {
      errors.push(
        issue(
          "INVALID_WINDOW_WALL_REF",
          `Window "${id || index}" references unknown wall "${String(win.wallId)}".`,
          `${basePath}.wallId`,
        ),
      );
    }

    if (walls.length > 0) {
      const nearest = findNearestWall(win.position, walls);
      if (!nearest || nearest.distance > 0.45) {
        errors.push(
          issue(
            "WINDOW_OFF_WALL",
            `Window "${id || index}" does not lie on or near a wall (distance ${nearest ? nearest.distance.toFixed(2) : "unknown"} m).`,
            `${basePath}.position`,
          ),
        );
      } else if (nearest.distance > 0.15) {
        warnings.push(
          issue(
            "WINDOW_WALL_OFFSET",
            `Window "${id || index}" is slightly offset (${nearest.distance.toFixed(2)} m) from wall "${nearest.wall.id}".`,
            `${basePath}.position`,
          ),
        );
      }
    }
  });

  // Fixtures validation
  const fixtureIds = new Set();
  fixtures.forEach((fix, index) => {
    const basePath = `fixtures[${index}]`;
    const id = typeof fix?.id === "string" ? fix.id.trim() : "";
    if (!id) {
      errors.push(
        issue("MISSING_FIXTURE_ID", `Fixture ${index} is missing an id.`, `${basePath}.id`),
      );
    } else if (fixtureIds.has(id)) {
      errors.push(
        issue("DUPLICATE_FIXTURE_ID", `Duplicate fixture id "${id}".`, `${basePath}.id`),
      );
    } else {
      fixtureIds.add(id);
    }

    if (fix?.locked !== true) {
      errors.push(
        issue(
          "UNLOCKED_FIXTURE",
          `Imported fixed fixture "${id || index}" must have locked: true.`,
          `${basePath}.locked`,
        ),
      );
    }

    if (!isFiniteTriple(fix?.position)) {
      errors.push(
        issue(
          "INVALID_COORDINATES",
          `Fixture "${id || index}" must have finite 3D position [x, y, z].`,
          `${basePath}.position`,
        ),
      );
    }

    if (fix?.roomId != null && !roomIds.has(fix.roomId)) {
      errors.push(
        issue(
          "INVALID_FIXTURE_ROOM_REF",
          `Fixture "${id || index}" references unknown room "${String(fix.roomId)}".`,
          `${basePath}.roomId`,
        ),
      );
    }

    if (Array.isArray(fix?.footprint)) {
      fix.footprint.forEach((pt, vIdx) => {
        if (!isFinitePoint2D(pt)) {
          errors.push(
            issue(
              "INVALID_COORDINATES",
              `Fixture "${id || index}" footprint vertex ${vIdx} is invalid.`,
              `${basePath}.footprint[${vIdx}]`,
            ),
          );
        }
      });
    }
  });

  // Preserve upstream semantic uncertainty warnings in validator output
  if (Array.isArray(house.warnings)) {
    for (const msg of house.warnings) {
      if (typeof msg === "string" && msg.trim()) {
        const alreadyListed = warnings.some((w) => w.message === msg.trim());
        if (!alreadyListed) {
          warnings.push(issue("IMPORT_UNCERTAINTY", msg.trim(), "warnings"));
        }
      }
    }
  }

  return {
    valid: errors.length === 0 && !calibrationRequired,
    calibrationRequired,
    errors,
    warnings,
    summary: {
      roomCount: rooms?.length ?? 0,
      wallCount: walls.length,
      doorCount: doors.length,
      windowCount: windows.length,
      fixtureCount: fixtures.length,
    },
  };
}
