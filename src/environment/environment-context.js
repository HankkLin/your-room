const degrees = 180 / Math.PI;
const radians = Math.PI / 180;
const wrap = (angle) => ((angle % 360) + 360) % 360;

export function validTimeZone(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

// Equatorial coordinates from the Sun's mean anomaly and ecliptic longitude,
// rotated into the observer's local horizon. Elevation is geometric.
export function solarPosition(latitude, longitude, instant) {
  const days = new Date(instant).getTime() / 86400000 - 10957.5; // J2000.0
  const anomaly = radians * wrap(357.5291 + 0.98560028 * days);
  const longitudeSun = radians * wrap(280.4665 + 0.98564736 * days +
    1.9148 * Math.sin(anomaly) + 0.0200 * Math.sin(2 * anomaly));
  const tilt = radians * (23.4393 - 0.00000036 * days);
  const ascension = Math.atan2(Math.cos(tilt) * Math.sin(longitudeSun), Math.cos(longitudeSun));
  const declination = Math.asin(Math.sin(tilt) * Math.sin(longitudeSun));
  const hourAngle = radians * wrap(280.46061837 + 360.98564736629 * days + longitude) - ascension;
  const lat = latitude * radians;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat));
  return { azimuthDegrees: wrap(180 + azimuth * degrees), elevationDegrees: elevation * degrees };
}

export function createEnvironmentSnapshot({ location, instant, timeZone, orientationDegrees, weather }) {
  const solar = solarPosition(location.latitude, location.longitude, instant);
  const sun = orientationDegrees === null ? null : {
    azimuthDegrees: wrap(solar.azimuthDegrees - orientationDegrees),
    elevationDegrees: solar.elevationDegrees,
  };
  return { location, instant, timeZone: validTimeZone(timeZone), orientationDegrees, solar, sun, weather };
}

export function formatLocalTime(snapshot) {
  if (!snapshot?.timeZone) return "Local time zone unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: snapshot.timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(snapshot.instant));
}

// These options can also be passed to Kevin's evaluateHouseholdExperience or runRedesignReplay.
export function environmentInputs(snapshot) {
  return { environment: snapshot ?? null, sun: snapshot?.sun ?? null };
}
