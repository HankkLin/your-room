import { personaActivities, validatePersonas } from "../../contracts/persona.js";
import { createSampleHousehold } from "../../persona/sample-household.js";

function formatTime(minute) {
  if (!Number.isInteger(minute)) return "";
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function parseTime(text) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function field(text, control) {
  const label = document.createElement("label");
  label.className = "field";
  const title = document.createElement("span");
  title.textContent = text;
  label.append(title, control);
  return label;
}

function button(text, style = "secondary") {
  const control = document.createElement("button");
  control.type = "button";
  control.className = style;
  control.textContent = text;
  return control;
}

function displayLabel(value) {
  if (value === "watchTv") return "Watch TV";
  if (value === "olderAdult") return "Older adult";
  return value[0].toUpperCase() + value.slice(1);
}

function memberDetails(member) {
  const details = document.createElement("details");
  details.className = "household-member-details";
  const summary = document.createElement("summary");
  summary.textContent = "Preferences and needs";
  const list = document.createElement("dl");
  const needs = Object.entries(member.needs).map(
    ([name, value]) => `${displayLabel(name)} ${Math.round(value * 100)}%`,
  );
  for (const [label, value] of [
    ["Age group", displayLabel(member.ageGroup)],
    ["Preferences", member.preferences.join(", ")],
    ["Dislikes", member.dislikes.join(", ")],
    ["Needs", needs.join(", ")],
  ]) {
    if (!value) continue;
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    list.append(term, definition);
  }
  details.append(summary, list);
  return details;
}

function timeField(label, entry, key) {
  const input = document.createElement("input");
  input.value = formatTime(entry[key]);
  input.maxLength = 5;
  input.placeholder = "HH:MM";
  input.setAttribute("aria-describedby", "household-time-help");
  input.addEventListener("input", () => {
    entry[key] = parseTime(input.value);
  });
  return field(label, input);
}

function durationField(entry) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "1440";
  if (Number.isFinite(entry.durationMinutes)) input.value = entry.durationMinutes;
  input.addEventListener("input", () => {
    entry.durationMinutes = input.valueAsNumber;
  });
  return field("Duration (minutes)", input);
}

function memberCard(member, rooms, onRemoveGuest) {
  const card = document.createElement("article");
  card.className = "household-member";
  const heading = document.createElement("h3");
  const fallbackName = onRemoveGuest ? "Guest" : "Household member";
  heading.textContent = member.name || fallbackName;
  const name = document.createElement("input");
  name.value = member.name;
  name.maxLength = 80;
  name.addEventListener("input", () => {
    member.name = name.value;
    heading.textContent = name.value.trim() || fallbackName;
  });
  const nameField = field("Name", name);
  nameField.classList.add("household-member-name");

  const entries = document.createElement("div");
  entries.className = "household-schedule";
  const noRoutine = document.createElement("p");
  noRoutine.className = "muted";
  noRoutine.textContent = "No routine";
  noRoutine.hidden = member.schedule.length > 0;
  entries.append(noRoutine);
  const add = button("Add activity");

  function appendEntry(initialEntry) {
    let entry = initialEntry;
    const row = document.createElement("div");
    row.className = "household-schedule-entry";
    const activity = document.createElement("select");
    activity.append(...personaActivities.map((value) => new Option(displayLabel(value), value)));
    activity.value = entry.activity;
    activity.addEventListener("change", () => {
      entry.activity = activity.value;
    });
    const room = document.createElement("select");
    room.append(new Option("Choose a room", ""), ...rooms.map(({ id, name }) => new Option(name, id)));
    room.value = rooms.some(({ id }) => id === entry.roomId) ? entry.roomId : "";
    room.addEventListener("change", () => {
      entry.roomId = room.value;
    });
    const timing = document.createElement("select");
    timing.append(new Option("Fixed time", "fixed"), new Option("Flexible window", "flexible"));
    timing.value = Object.hasOwn(entry, "windowStartMinute") ? "flexible" : "fixed";
    const timingFields = document.createElement("div");
    timingFields.className = "household-timing-fields";

    function renderTimingFields() {
      const flexible = timing.value === "flexible";
      row.classList.toggle("household-schedule-flexible", flexible);
      timingFields.replaceChildren(...(flexible ? [
        timeField("Earliest start", entry, "windowStartMinute"),
        timeField("Latest finish", entry, "windowEndMinute"),
        durationField(entry),
      ] : [
        timeField("Start time", entry, "startMinute"),
        timeField("End time", entry, "endMinute"),
      ]));
    }

    timing.addEventListener("change", () => {
      const index = member.schedule.indexOf(entry);
      const { activity, roomId, startMinute, endMinute, windowStartMinute, durationMinutes } = entry;
      if (timing.value === "flexible") {
        entry = {
          activity, roomId, windowStartMinute: startMinute, windowEndMinute: endMinute,
          durationMinutes: endMinute - startMinute,
        };
      } else {
        entry = {
          activity, roomId, startMinute: windowStartMinute,
          endMinute: windowStartMinute + durationMinutes,
        };
      }
      member.schedule[index] = entry;
      renderTimingFields();
    });
    renderTimingFields();
    const remove = button("Remove", "text-btn");
    remove.setAttribute("aria-label", "Remove activity");
    remove.addEventListener("click", () => {
      member.schedule.splice(member.schedule.indexOf(entry), 1);
      row.remove();
      noRoutine.hidden = member.schedule.length > 0;
      add.focus();
    });
    row.append(
      field("Activity", activity),
      field("Room", room),
      field("Timing", timing),
      timingFields,
      remove,
    );
    entries.append(row);
    return activity;
  }

  member.schedule.forEach(appendEntry);
  add.addEventListener("click", () => {
    const entry = { activity: "other", roomId: rooms[0]?.id ?? "", startMinute: NaN, endMinute: NaN };
    member.schedule.push(entry);
    noRoutine.hidden = true;
    appendEntry(entry).focus();
  });
  const header = document.createElement("header");
  header.className = "household-member-header";
  header.append(heading);
  if (onRemoveGuest) {
    const removeGuest = button("Remove guest", "text-btn");
    removeGuest.addEventListener("click", onRemoveGuest);
    header.append(removeGuest);
  }
  card.append(header, nameField, memberDetails(member), entries, add);
  return card;
}

export function createHouseholdPage(container, { onSave, onSkip }) {
  const title = container.querySelector("#household-title");
  const form = container.querySelector("#household-form");
  const description = container.querySelector("#household-description");
  const generate = container.querySelector("#generate-household");
  const sample = container.querySelector("#sample-household");
  const roomList = container.querySelector("#household-rooms-list");
  const review = container.querySelector("#household-review");
  const members = container.querySelector("#household-members");
  const addGuest = container.querySelector("#add-household-guest");
  const save = container.querySelector("#save-household");
  const skip = container.querySelector("#skip-household");
  const generationStatus = container.querySelector("#household-status");
  const saveStatus = container.querySelector("#household-save-status");
  let rooms = [];
  let draft = [];
  let activeRequest = null;

  function announce(status, message = "", error = false) {
    status.textContent = message;
    status.toggleAttribute("data-error", error);
  }

  function updateControls() {
    const pending = Boolean(activeRequest);
    generate.disabled = pending || !rooms.length;
    sample.disabled = !rooms.length;
    save.disabled = pending || !draft.length;
    members.disabled = pending;
    addGuest.disabled = pending;
  }

  function updateDraft() {
    review.hidden = !draft.length;
    announce(saveStatus);
    updateControls();
  }

  function replaceDraft(personas) {
    draft = structuredClone(personas);
    members.replaceChildren(...draft.map((member) => memberCard(member, rooms)));
    updateDraft();
  }

  function close() {
    activeRequest?.abort();
    activeRequest = null;
  }

  function open({ personas, rooms: availableRooms }) {
    close();
    rooms = availableRooms;
    const items = rooms.map(({ name }) => {
      const item = document.createElement("li");
      item.textContent = name;
      return item;
    });
    roomList.replaceChildren(...items);
    description.value = "";
    announce(generationStatus);
    replaceDraft(personas);
    title.focus({ preventScroll: true });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (activeRequest) return;
    const text = description.value.trim();
    if (!text) {
      announce(generationStatus, "Describe your household to generate a draft.", true);
      return;
    }
    const request = new AbortController();
    activeRequest = request;
    updateControls();
    announce(generationStatus, "Generating your household…");
    const fallbackError = "Could not generate a household. Please try again.";

    try {
      const response = await fetch("/api/personas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text, rooms }),
        signal: request.signal,
      });
      const result = await response.json();
      if (activeRequest !== request) return;
      if (!response.ok) {
        const message = typeof result?.error === "string" ? result.error : fallbackError;
        announce(generationStatus, message, true);
        return;
      }
      const error = validatePersonas(result?.personas, rooms);
      if (error || !result.personas.length) {
        announce(generationStatus, error || fallbackError, true);
        return;
      }
      replaceDraft(result.personas);
      announce(generationStatus, "Household draft ready. Review it before saving.");
    } catch {
      if (activeRequest === request) announce(generationStatus, fallbackError, true);
    } finally {
      if (activeRequest === request) {
        activeRequest = null;
        updateControls();
      }
    }
  });

  sample.addEventListener("click", () => {
    close();
    replaceDraft(createSampleHousehold(rooms));
    announce(generationStatus, "Sample household loaded. Review it before saving.");
  });

  addGuest.addEventListener("click", () => {
    const guest = {
      id: crypto.randomUUID(),
      name: "",
      ageGroup: "adult",
      preferences: [],
      dislikes: [],
      needs: { privacy: 0.5, quiet: 0.5, accessibility: 0.5, daylight: 0.5, social: 0.5 },
      schedule: [],
    };
    const card = memberCard(guest, rooms, () => {
      draft.splice(draft.indexOf(guest), 1);
      card.remove();
      updateDraft();
      addGuest.focus();
    });
    draft.push(guest);
    members.append(card);
    updateDraft();
    card.querySelector(".household-member-name input").focus();
  });

  save.addEventListener("click", () => {
    const personas = draft.map((member) => ({
      ...member,
      name: member.name.trim(),
      schedule: [...member.schedule].sort((left, right) =>
        (left.windowStartMinute ?? left.startMinute) - (right.windowStartMinute ?? right.startMinute)),
    }));
    const error = validatePersonas(personas, rooms);
    if (error) announce(saveStatus, error, true);
    else onSave(personas);
  });

  skip.addEventListener("click", onSkip);
  return { open, close };
}
