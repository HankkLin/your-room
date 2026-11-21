import { formatLocalTime } from "./environment-context.js";
import "./environment-panel.css";

function angle(value) { return value.toFixed(1) + "°"; }
function measure(value, unit) { return Number.isFinite(value) ? value + unit : "Unavailable"; }

async function request(path, params, signal) {
  const response = await fetch("/api/environment/" + path + "?" + new URLSearchParams(params), { signal });
  if (!response.ok) throw new Error((await response.json()).error || "Could not load environment.");
  return response.json();
}

export function mountEnvironmentPanel(container, onSave) {
  container.innerHTML = `<summary>Local environment</summary>
    <form class="environment-form">
      <label>U.S. street address<input name="address" maxlength="240" autocomplete="off" placeholder="350 5th Ave, New York, NY 10118"></label>
      <button class="secondary" type="button" data-find>Find address</button>
      <label data-choices hidden>Matching addresses<select name="match"></select></label>
      <label>Simulation time (UTC)<input type="datetime-local" name="instant" required></label>
      <label>Compass bearing of plan top (−Z)<input type="number" name="bearing" min="0" max="359.99" step="any" placeholder="0° north, 90° east"></label>
      <button class="secondary" type="submit" disabled>Use these conditions</button>
    </form><p role="status" class="studio-replay-message" data-message></p>
    <dl data-conditions></dl><small>Addresses from U.S. Census. Hourly weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.</small>`;
  const form = container.querySelector("form");
  const { address, match, instant, bearing } = form.elements;
  const find = container.querySelector("[data-find]");
  const submit = form.querySelector("[type=submit]");
  const message = container.querySelector("[data-message]");
  const choices = container.querySelector("[data-choices]");
  const conditions = container.querySelector("[data-conditions]");
  let matches = [];
  let saved;
  let active;

  function selectLocation() { return match.value === "" ? null : matches[Number(match.value)]; }
  function cancel() { active?.abort(); active = null; }
  function resetMatches() {
    matches = [];
    match.replaceChildren();
    choices.hidden = true;
    submit.disabled = true;
  }
  function fillMatches(found) {
    matches = found;
    match.replaceChildren();
    if (found.length > 1) match.add(new Option("Choose the intended address", ""));
    found.forEach((loc, i) => match.add(new Option(loc.label, String(i))));
    choices.hidden = found.length < 2;
    submit.disabled = !selectLocation();
  }

  function show(snapshot) {
    if (saved === snapshot) return;
    saved = snapshot;
    cancel();
    resetMatches();
    conditions.replaceChildren();
    message.textContent = "";
    address.value = snapshot?.location.label ?? "";
    instant.value = (snapshot?.instant || new Date().toISOString()).slice(0, 16);
    bearing.value = snapshot?.orientationDegrees ?? "";
    if (!snapshot) return;
    fillMatches([snapshot.location]);
    const w = snapshot.weather;
    const rows = [
      ["Address", snapshot.location.label], ["Local time", formatLocalTime(snapshot)],
      ["Temperature", measure(w?.temperatureC, " °C")], ["Humidity", measure(w?.humidityPercent, "%")],
      ["Wind", [measure(w?.windSpeedMps, " m/s"), measure(w?.windDirectionDegrees, "° from true north")].join(" · ")],
      ["Solar position", angle(snapshot.solar.azimuthDegrees) + " true bearing · " + angle(snapshot.solar.elevationDegrees) + " elevation"],
      ["Scene sun", snapshot.sun ? angle(snapshot.sun.azimuthDegrees) + " clockwise from plan top" : "Home orientation missing. Enter its bearing to map sunlight."],
      ["Weather source", w ? w.source + " · " + w.hour.slice(0, 16).replace("T", " ") + " UTC" : "Weather unavailable for this hour"],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      conditions.append(term, detail);
    }
  }

  address.addEventListener("input", () => { cancel(); resetMatches(); message.textContent = ""; });
  for (const control of [match, bearing, instant]) {
    control.addEventListener("input", () => { cancel(); submit.disabled = !selectLocation(); message.textContent = ""; });
  }
  find.onclick = async () => {
    cancel();
    resetMatches();
    if (!address.value.trim()) { message.textContent = "Enter a U.S. street address."; return; }
    const controller = active = new AbortController();
    message.textContent = "Finding matching addresses…";
    try {
      const data = await request("addresses", { address: address.value.trim() }, controller.signal);
      if (controller !== active) return;
      fillMatches(data.matches);
      message.textContent = matches.length > 1 ? "Several addresses match. Choose one to continue." :
        matches.length ? "Address found: " + matches[0].label : "No matching address. Add a city, state or ZIP code and try again.";
    } catch (error) {
      if (controller === active) message.textContent = error.message;
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const location = selectLocation();
    if (!location || submit.disabled) return;
    cancel();
    const controller = active = new AbortController();
    submit.disabled = true;
    message.textContent = "Loading local conditions…";
    try {
      const { snapshot } = await request("snapshot", { ...location, instant: new Date(instant.value + "Z").toISOString(),
        orientation: bearing.value }, controller.signal);
      if (controller === active) onSave(snapshot);
    } catch (error) {
      if (controller === active) message.textContent = error.message;
    } finally {
      if (controller === active) submit.disabled = !selectLocation();
    }
  };

  return { show, reset() { saved = undefined; show(null); } };
}
