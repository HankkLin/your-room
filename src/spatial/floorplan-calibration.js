import { normalizeCalibrationSource } from "../contracts/scene.js";

export const METERS_PER_FOOT = 0.3048;
export const METERS_PER_INCH = 0.0254;

const round = (value, decimals = 4) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Convert feet and optional inches to exact meters.
 * @param {number} feet
 * @param {number} [inches=0]
 * @returns {number}
 */
export function feetInchesToMeters(feet, inches = 0) {
  const ft = Number(feet);
  const inch = Number(inches ?? 0);
  if (!Number.isFinite(ft) || !Number.isFinite(inch) || ft < 0 || inch < 0) {
    throw new Error("Feet and inches must be non-negative finite numbers.");
  }
  const meters = ft * METERS_PER_FOOT + inch * METERS_PER_INCH;
  if (meters <= 0) {
    throw new Error("Physical distance must be greater than zero.");
  }
  return meters;
}

/**
 * Convert a numeric measurement in a supported unit into meters.
 * @param {number | { feet?: number, inches?: number }} value
 * @param {"meters" | "m" | "feet" | "ft" | "inches" | "in" | "feet_inches" | "cm" | "mm"} [unit="meters"]
 * @returns {number}
 */
export function convertDistanceToMeters(value, unit = "meters") {
  const normalizedUnit = String(unit ?? "meters").trim().toLowerCase();
  if (normalizedUnit === "feet_inches" || (value && typeof value === "object")) {
    const ft = Number(value?.feet ?? 0);
    const inch = Number(value?.inches ?? 0);
    return feetInchesToMeters(ft, inch);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Distance must be a positive finite number.");
  }

  switch (normalizedUnit) {
    case "m":
    case "meter":
    case "meters":
    case "metre":
    case "metres":
      return numeric;
    case "ft":
    case "foot":
    case "feet":
      return numeric * METERS_PER_FOOT;
    case "in":
    case "inch":
    case "inches":
      return numeric * METERS_PER_INCH;
    case "cm":
    case "centimeter":
    case "centimeters":
      return numeric / 100;
    case "mm":
    case "millimeter":
    case "millimeters":
      return numeric / 1000;
    default:
      throw new Error(`Unsupported distance unit: ${unit}`);
  }
}

/**
 * Parse a single printed architectural dimension string (e.g. `12' 6"`, `3.65 m`, `365 cm`)
 * into meters. Returns null when no unambiguous real-world unit is present.
 *
 * @param {string} rawText
 * @returns {number | null}
 */
export function parseDimensionTextToMeters(rawText) {
  if (typeof rawText !== "string") return null;
  const text = rawText
    .trim()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/\s+/g, " ");
  if (!text) return null;

  // Feet + optional inches: e.g. 12' 6", 12'-6", 12 ft 6 in, 12'
  const ftInMatch = text.match(
    /^(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet)\s*(?:-\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|in\.?|inch(?:es)?)?)?$/i,
  );
  if (ftInMatch) {
    const ft = Number(ftInMatch[1]);
    const inch = ftInMatch[2] != null ? Number(ftInMatch[2]) : 0;
    const meters = ft * METERS_PER_FOOT + inch * METERS_PER_INCH;
    return meters > 0 ? meters : null;
  }

  // Inches only: e.g. 36", 36 in
  const inMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:"|in\.?|inch(?:es)?)$/i);
  if (inMatch) {
    const meters = Number(inMatch[1]) * METERS_PER_INCH;
    return meters > 0 ? meters : null;
  }

  // Metric meters / cm / mm: e.g. 4.2 m, 420 cm, 4200 mm
  const metricMatch = text.match(
    /^(\d+(?:\.\d+)?)\s*(mm|millimeters?|cm|centimeters?|m|meters?|metres?)$/i,
  );
  if (metricMatch) {
    const amount = Number(metricMatch[1]);
    const unitToken = metricMatch[2].toLowerCase();
    if (unitToken.startsWith("mm") || unitToken.startsWith("millimeter")) {
      return amount > 0 ? amount / 1000 : null;
    }
    if (unitToken.startsWith("cm") || unitToken.startsWith("centimeter")) {
      return amount > 0 ? amount / 100 : null;
    }
    return amount > 0 ? amount : null;
  }

  return null;
}

/**
 * Parse a printed room dimension pair such as `12' 6" × 10' 2"` or `5.4 m x 4.2 m`.
 *
 * @param {string} rawText
 * @returns {{ firstMeters: number, secondMeters: number } | null}
 */
export function parseDimensionPairToMeters(rawText) {
  if (typeof rawText !== "string") return null;
  const parts = rawText.split(/\s*(?:×|x|X|by)\s*/);
  if (parts.length !== 2) return null;
  const firstMeters = parseDimensionTextToMeters(parts[0]);
  const secondMeters = parseDimensionTextToMeters(parts[1]);
  if (!firstMeters || !secondMeters) return null;
  return { firstMeters, secondMeters };
}

/**
 * Deterministically calculate pixel distance between two 2D points.
 * @param {[number, number]} pointA
 * @param {[number, number]} pointB
 * @returns {number}
 */
export function calculatePixelDistance(pointA, pointB) {
  if (
    !Array.isArray(pointA) ||
    !Array.isArray(pointB) ||
    pointA.length < 2 ||
    pointB.length < 2
  ) {
    throw new Error("Two 2D calibration points [x, y] are required.");
  }
  const [ax, ay] = pointA.map(Number);
  const [bx, by] = pointB.map(Number);
  if (![ax, ay, bx, by].every(Number.isFinite)) {
    throw new Error("Calibration points must have finite coordinates.");
  }
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Compute deterministic manual calibration metadata from two pixel points
 * and a user-supplied physical distance.
 *
 * @param {object} params
 * @param {[number, number]} params.pointA
 * @param {[number, number]} params.pointB
 * @param {number} [params.knownDistanceMeters]
 * @param {number | { feet?: number, inches?: number }} [params.distanceValue]
 * @param {string} [params.unit]
 * @returns {{
 *   source: "manual_calibration",
 *   knownDistanceMeters: number,
 *   pixelDistance: number,
 *   metersPerPixel: number,
 *   pointA: [number, number],
 *   pointB: [number, number]
 * }}
 */
export function computeManualCalibration({
  pointA,
  pointB,
  knownDistanceMeters,
  distanceValue,
  unit = "meters",
}) {
  const pixelDistance = calculatePixelDistance(pointA, pointB);
  if (pixelDistance < 1) {
    throw new Error(
      "Select two distinct points on the floorplan (at least 1 pixel apart).",
    );
  }

  const meters =
    knownDistanceMeters != null
      ? convertDistanceToMeters(knownDistanceMeters, "meters")
      : convertDistanceToMeters(distanceValue, unit);

  if (meters < 0.1 || meters > 250) {
    throw new Error(
      "Known wall distance must be between 0.1 m and 250 m for residential calibration.",
    );
  }

  const metersPerPixel = meters / pixelDistance;
  return {
    source: "manual_calibration",
    knownDistanceMeters: round(meters, 4),
    pixelDistance: round(pixelDistance, 2),
    metersPerPixel: Number(metersPerPixel.toPrecision(7)),
    pointA: [round(Number(pointA[0]), 2), round(Number(pointA[1]), 2)],
    pointB: [round(Number(pointB[0]), 2), round(Number(pointB[1]), 2)],
  };
}

function polygonPixelSpan(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of polygon) {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const widthPx = maxX - minX;
  const heightPx = maxY - minY;
  return widthPx > 1 && heightPx > 1 ? { widthPx, heightPx } : null;
}

/**
 * Determine real-world scale strictly from explicit printed dimensions or a scale bar.
 * Never fabricates real-world scale when evidence is absent.
 *
 * @param {object} candidate
 * @returns {{
 *   calibration: {
 *     source: "printed_dimension" | "manual_calibration" | "scale_bar" | "unknown",
 *     knownDistanceMeters: number | null,
 *     pixelDistance: number | null,
 *     metersPerPixel: number | null
 *   },
 *   calibrationRequired: boolean,
 *   scaleWarnings: string[]
 * }}
 */
export function resolveCandidateScale(candidate = {}) {
  const scaleWarnings = [];

  // Preserve explicit valid calibration if already attached (e.g. re-normalization).
  if (candidate.calibration && candidate.calibration.source) {
    const source = normalizeCalibrationSource(candidate.calibration.source);
    const mpp = Number(candidate.calibration.metersPerPixel);
    if (source !== "unknown" && Number.isFinite(mpp) && mpp > 0) {
      return {
        calibration: {
          source,
          knownDistanceMeters:
            candidate.calibration.knownDistanceMeters != null
              ? Number(candidate.calibration.knownDistanceMeters)
              : null,
          pixelDistance:
            candidate.calibration.pixelDistance != null
              ? Number(candidate.calibration.pixelDistance)
              : null,
          metersPerPixel: mpp,
          ...(candidate.calibration.pointA
            ? { pointA: candidate.calibration.pointA }
            : {}),
          ...(candidate.calibration.pointB
            ? { pointB: candidate.calibration.pointB }
            : {}),
        },
        calibrationRequired: false,
        scaleWarnings,
      };
    }
  }

  // Case 1: Printed dimensions (span lines or room callouts like `12' 6" × 10' 2"`).
  const samples = [];
  const printedList = Array.isArray(candidate.printedDimensions)
    ? candidate.printedDimensions
    : [];

  for (const entry of printedList) {
    if (!entry || (entry.confidence != null && Number(entry.confidence) < 0.6)) {
      continue;
    }
    const text = String(entry.text ?? "").trim();
    if (Array.isArray(entry.startPx) && Array.isArray(entry.endPx)) {
      const singleMeters = parseDimensionTextToMeters(text);
      if (singleMeters) {
        try {
          const px = calculatePixelDistance(entry.startPx, entry.endPx);
          if (px >= 8) {
            samples.push({
              knownDistanceMeters: singleMeters,
              pixelDistance: px,
              metersPerPixel: singleMeters / px,
            });
            continue;
          }
        } catch {
          // Ignore malformed printed span endpoints
        }
      }
    }

    // Room-level dimension callout (e.g., "14' 6\" × 11' 0\"") matched to room pixel polygon
    const pair = parseDimensionPairToMeters(text);
    if (pair && entry.roomId && Array.isArray(candidate.rooms)) {
      const room = candidate.rooms.find((r) => r?.id === entry.roomId);
      const span = polygonPixelSpan(room?.polygonPx ?? room?.polygon);
      if (span) {
        const roomMajorPx = Math.max(span.widthPx, span.heightPx);
        const dimMajorM = Math.max(pair.firstMeters, pair.secondMeters);
        if (roomMajorPx >= 12) {
          samples.push({
            knownDistanceMeters: dimMajorM,
            pixelDistance: roomMajorPx,
            metersPerPixel: dimMajorM / roomMajorPx,
          });
        }
      }
    }
  }

  if (samples.length > 0) {
    const sorted = [...samples].sort(
      (a, b) => a.metersPerPixel - b.metersPerPixel,
    );
    const chosen = sorted[Math.floor(sorted.length / 2)];
    if (sorted.length > 1) {
      const spread =
        (sorted.at(-1).metersPerPixel - sorted[0].metersPerPixel) /
        chosen.metersPerPixel;
      if (spread > 0.12) {
        scaleWarnings.push(
          "Printed dimensions vary slightly across rooms; verify critical wall lengths.",
        );
      }
    }
    return {
      calibration: {
        source: "printed_dimension",
        knownDistanceMeters: round(chosen.knownDistanceMeters, 4),
        pixelDistance: round(chosen.pixelDistance, 2),
        metersPerPixel: Number(chosen.metersPerPixel.toPrecision(7)),
      },
      calibrationRequired: false,
      scaleWarnings,
    };
  }

  // Case 2: Scale bar
  const bar = candidate.scaleBar;
  if (
    bar &&
    Array.isArray(bar.startPx) &&
    Array.isArray(bar.endPx) &&
    (bar.confidence == null || Number(bar.confidence) >= 0.65)
  ) {
    const barMeters = parseDimensionTextToMeters(String(bar.text ?? bar.label ?? ""));
    if (barMeters) {
      try {
        const px = calculatePixelDistance(bar.startPx, bar.endPx);
        if (px >= 8) {
          return {
            calibration: {
              source: "scale_bar",
              knownDistanceMeters: round(barMeters, 4),
              pixelDistance: round(px, 2),
              metersPerPixel: Number((barMeters / px).toPrecision(7)),
            },
            calibrationRequired: false,
            scaleWarnings,
          };
        }
      } catch {
        // Fall through to unknown scale
      }
    }
  }

  // Case 3: No scale evidence — NEVER pretend dimensions are known.
  scaleWarnings.push("No printed scale detected; manual calibration required.");
  return {
    calibration: {
      source: "unknown",
      knownDistanceMeters: null,
      pixelDistance: null,
      metersPerPixel: null,
    },
    calibrationRequired: true,
    scaleWarnings,
  };
}
