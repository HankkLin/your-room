import test from "node:test";
import assert from "node:assert/strict";
import { createEnvironmentSnapshot, environmentInputs, formatLocalTime, solarPosition } from "./environment-context.js";
import { findAddresses, loadEnvironment } from "./environment-api.js";
import { runStudioReplay, captureStudioLayout } from "../simulation/studio-replay.js";
import { createBlockedRouteDemo } from "../simulation/studio-replay-demo.js";
import { importSampleFloorplan } from "../spatial/floorplan-importer.js";

const location = { label: "350 5TH AVE, NEW YORK, NY, 10118", latitude: 40.747850846857, longitude: -73.985075577551 };
const instant = "2026-11-01T13:00:00.000Z";
const timeZone = "America/New_York";
const base = { location, instant, timeZone, orientationDegrees: 90, weather: null };
const snapshot = (values = {}) => createEnvironmentSnapshot({ ...base, ...values });
const json = (value) => new Response(JSON.stringify(value));

test("New York solar angles agree with JPL Horizons on the day daylight saving ends", () => {
  // JPL Horizons DE441, Sun observing site 40.747851 N, 73.985076 W, geometric horizon.
  for (const [when, azimuth, elevation] of [[instant, 124.96214, 14.954459], ["2026-11-01T19:00:00Z", 218.188241, 25.778181]]) {
    const actual = solarPosition(location.latitude, location.longitude, when);
    assert(Math.abs(actual.azimuthDegrees - azimuth) < 0.1);
    assert(Math.abs(actual.elevationDegrees - elevation) < 0.1);
  }
  const morning = snapshot();
  assert(Math.abs(environmentInputs(morning).sun.azimuthDegrees - 34.96214) < 0.1);
  assert.equal(snapshot({ orientationDegrees: null }).sun, null);
  assert.deepEqual(snapshot({ orientationDegrees: 0 }).sun, morning.solar);
});

test("both occurrences of 1:30 local time on DST fallback retain their distinct offsets", () => {
  assert.match(formatLocalTime(snapshot({ instant: "2026-11-01T05:30:00Z" })), /1:30 AM EDT/);
  assert.match(formatLocalTime(snapshot({ instant: "2026-11-01T06:30:00Z" })), /1:30 AM EST/);
});

test("street geocoding preserves ambiguous Census matches for user selection", async () => {
  const address = "350 5th Ave, New York, NY 10118";
  const choices = await findAddresses(address, (url) => {
    assert.equal(url.searchParams.get("address"), address);
    assert.equal(url.pathname, "/geocoder/locations/onelineaddress");
    return json({ result: { addressMatches: [
      { matchedAddress: location.label, coordinates: { x: location.longitude, y: location.latitude } },
      { matchedAddress: "350 FIFTH AVE, ANOTHER CITY", coordinates: { x: -75, y: 38 } },
      { matchedAddress: "incomplete" },
    ] } });
  });
  assert.equal(choices.length, 2);
  assert.deepEqual(choices[0], location);
});

test("weather selects the exact UTC hour including missing fields and repeated local hours", async () => {
  const seconds = Date.parse("2026-11-01T05:00:00Z") / 1000;
  const fetchWeather = (url) => {
    assert.equal(url.hostname, "archive-api.open-meteo.com");
    assert.equal(url.searchParams.get("timeformat"), "unixtime");
    return json({ timezone: timeZone, hourly: { time: [seconds, seconds + 3600], temperature_2m: [12, 11],
      relative_humidity_2m: [60, null], wind_speed_10m: [2, 0], wind_direction_10m: [359, 0] } });
  };
  const result = await loadEnvironment({ ...base, instant: "2026-11-01T06:52:00.000Z" }, fetchWeather, Date.parse("2026-11-20T00:00:00Z"));
  assert.deepEqual(result.weather, { source: "Open-Meteo historical reanalysis", hour: "2026-11-01T06:00:00.000Z",
    temperatureC: 11, humidityPercent: null, windSpeedMps: 0, windDirectionDegrees: 0 });
});

test("weather outage preserves geographical sun and uses the NWS time zone", async () => {
  const result = await loadEnvironment({ ...base, orientationDegrees: null }, (url) =>
    url.hostname === "api.weather.gov" ? json({ properties: { timeZone } }) : new Response(null, { status: 503 }));
  assert.equal(result.weather, null);
  assert.equal(result.timeZone, timeZone);
  assert.equal(result.sun, null);
  assert(result.solar.elevationDegrees > 14);
});

test("real before and after Studio runs share the baseline snapshot and approved schedule", async () => {
  const { house } = importSampleFloorplan();
  const { items, householdDraft: personas } = createBlockedRouteDemo();
  const beforeScene = captureStudioLayout(house, items);
  const afterScene = captureStudioLayout(house, []);
  const environment = snapshot();
  beforeScene.environment.snapshot = environment;
  afterScene.environment.snapshot = snapshot({ instant: "2026-11-01T19:00:00Z" });
  const { before, after } = await runStudioReplay({ beforeScene, afterScene, personas, rooms: house.rooms });
  assert.equal(before.environment, environment);
  assert.equal(after.environment, environment);
  assert.equal(before.summary.pathFailures, 1);
  assert.equal(after.summary.pathFailures, 0);
  assert.deepEqual(before.agents.map((agent) => agent.id), after.agents.map((agent) => agent.id));
});
