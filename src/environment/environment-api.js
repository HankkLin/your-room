import { createEnvironmentSnapshot, validTimeZone } from "./environment-context.js";

const day = 86400000;
const fields = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m"];
const headers = { Accept: "application/json", "User-Agent": "Living-Blueprint (https://github.com/HankkLin/your-room)" };

async function readJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw new Error("Provider unavailable");
  return response.json();
}

function inRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export async function findAddresses(address, fetchImpl = fetch) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  const response = await readJson(fetchImpl, url);
  if (!Array.isArray(response?.result?.addressMatches)) throw new Error("Invalid geocoder response");
  const matches = new Map();
  for (const match of response.result.addressMatches) {
    const latitude = match.coordinates?.y;
    const longitude = match.coordinates?.x;
    const label = match.matchedAddress;
    if (typeof label === "string" && label.trim() && inRange(latitude, -90, 90) && inRange(longitude, -180, 180)) {
      matches.set(JSON.stringify([label, latitude, longitude]), { label, latitude, longitude });
    }
  }
  return [...matches.values()];
}

async function fetchWeather(location, instant, fetchImpl, now) {
  const when = Date.parse(instant);
  const historical = when < now - 5 * day;
  const url = new URL(historical ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast");
  const date = (time) => new Date(time).toISOString().slice(0, 10);
  // Request neighboring dates to cover local midnight, DST folds and UTC date changes.
  url.search = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude,
    start_date: date(when - day), end_date: date(when + day), timezone: "auto", timeformat: "unixtime",
    hourly: fields.join(","), temperature_unit: "celsius", wind_speed_unit: "ms" });
  const data = await readJson(fetchImpl, url);
  const timeZone = validTimeZone(data.timezone);
  const epochHour = Math.floor(when / 3600000) * 3600;
  const index = data.hourly?.time?.indexOf(epochHour) ?? -1;
  if (index < 0) return { timeZone, weather: null };
  const [temperatureC, humidityPercent, windSpeedMps, windDirectionDegrees] = fields.map((field) => {
    const value = data.hourly[field]?.[index];
    return Number.isFinite(value) ? value : null;
  });
  if ([temperatureC, humidityPercent, windSpeedMps, windDirectionDegrees].every((value) => value === null)) {
    return { timeZone, weather: null };
  }
  return { timeZone, weather: { source: historical ? "Open-Meteo historical reanalysis" : "Open-Meteo forecast",
    hour: new Date(epochHour * 1000).toISOString(), temperatureC, humidityPercent, windSpeedMps, windDirectionDegrees } };
}

export async function loadEnvironment({ location, instant, orientationDegrees }, fetchImpl = fetch, now = Date.now()) {
  let { timeZone, weather } = await fetchWeather(location, instant, fetchImpl, now).catch(() => ({ timeZone: null, weather: null }));
  if (!timeZone) {
    const url = new URL("https://api.weather.gov/points/" + location.latitude.toFixed(4) + "," + location.longitude.toFixed(4));
    const point = await readJson(fetchImpl, url).catch(() => null);
    timeZone = validTimeZone(point?.properties?.timeZone);
  }
  return createEnvironmentSnapshot({ location, instant, orientationDegrees, timeZone, weather });
}

function numberParam(params, name) {
  const raw = params.get(name);
  return raw?.trim() ? Number(raw) : null;
}

export function createEnvironmentMiddleware({ fetchImpl = fetch } = {}) {
  return async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    const addressRoute = url.pathname === "/api/environment/addresses";
    if (!addressRoute && url.pathname !== "/api/environment/snapshot") return next();
    function send(status, data) {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    }
    if (req.method !== "GET") return send(405, { error: "Use GET to look up the environment." });
    const params = url.searchParams;
    try {
      if (addressRoute) {
        const address = params.get("address")?.trim();
        if (!address || address.length > 240) return send(400, { error: "Enter a U.S. street address (up to 240 characters)." });
        return send(200, { matches: await findAddresses(address, fetchImpl) });
      }
      const location = { label: params.get("label")?.trim(), latitude: numberParam(params, "latitude"),
        longitude: numberParam(params, "longitude") };
      const instant = params.get("instant");
      const orientationDegrees = numberParam(params, "orientation");
      if (!location.label || location.label.length > 300 || !inRange(location.latitude, -90, 90) ||
          !inRange(location.longitude, -180, 180) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant) ||
          !Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString() !== instant ||
          (orientationDegrees !== null && !inRange(orientationDegrees, 0, 359.999999))) {
        return send(400, { error: "Choose a valid address, UTC time and compass bearing from 0 to less than 360°." });
      }
      return send(200, { snapshot: await loadEnvironment({ location, instant, orientationDegrees }, fetchImpl) });
    } catch {
      return send(502, { error: "Address lookup is unavailable. Try again." });
    }
  };
}
