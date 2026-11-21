import { isFlexibleActivity, resolveSchedule } from '../persona/resolve-schedule.js';

export const personaActivities = Object.freeze([
  'sleep', 'work', 'study', 'cook', 'eat', 'relax', 'watchTv',
  'bathroom', 'socialize', 'exercise', 'other',
]);

const ageGroups = ['child', 'teen', 'adult', 'olderAdult'];
const needNames = ['privacy', 'quiet', 'accessibility', 'daylight', 'social'];
const minutesPerDay = 1440;
const limits = { people: 12, rooms: 50, schedule: 32, name: 80, list: 12, preference: 120 };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = (value, max = Infinity) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validatePersonaRooms(rooms) {
  if (!Array.isArray(rooms) || !rooms.length || rooms.length > limits.rooms) {
    return `Provide between 1 and ${limits.rooms} available rooms.`;
  }
  const ids = new Set();
  for (const room of rooms) {
    if (!isRecord(room) || !validText(room.id) || !validText(room.name, limits.name)) {
      return 'Each available room needs a valid ID and name.';
    }
    if (ids.has(room.id)) return 'Available rooms must have unique IDs.';
    ids.add(room.id);
  }
  return null;
}

function validTimeRange(start, end) {
  return Number.isInteger(start) && Number.isInteger(end) &&
    start >= 0 && start < end && end <= minutesPerDay;
}

function validateScheduleEntries(schedule, roomIds, name) {
  if (!Array.isArray(schedule) || schedule.length > limits.schedule) {
    return `${name} can have up to ${limits.schedule} schedule entries.`;
  }
  for (const entry of schedule) {
    if (!isRecord(entry) || !personaActivities.includes(entry.activity)) {
      return `Choose a valid activity for ${name}.`;
    }
    const { roomId, startMinute, endMinute } = entry;
    if (!roomIds.has(roomId)) return `Choose an available room for each of ${name}’s activities.`;
    if (isFlexibleActivity(entry)) {
      const { windowStartMinute, windowEndMinute, durationMinutes } = entry;
      if (Object.hasOwn(entry, 'startMinute') || Object.hasOwn(entry, 'endMinute') ||
          !validTimeRange(windowStartMinute, windowEndMinute) || !Number.isInteger(durationMinutes) ||
          durationMinutes <= 0 || durationMinutes > windowEndMinute - windowStartMinute) {
        return `Check ${name}’s flexible window and duration. The activity must fit inside the window.`;
      }
    } else if (!validTimeRange(startMinute, endMinute)) {
      return `Check ${name}’s activity times. Use an end time after the start, and split overnight activities at midnight.`;
    }
  }
  return null;
}

function evaluateHousehold(personas, rooms) {
  if (!Array.isArray(personas) || personas.length > limits.people) {
    return { error: `A household can have up to ${limits.people} people.` };
  }
  if (!personas.length) return { replay: [] };
  const roomsError = validatePersonaRooms(rooms);
  if (roomsError) return { error: roomsError };
  const roomIds = new Set(rooms.map(({ id }) => id));
  const ids = new Set();
  const validList = (list) => Array.isArray(list) && list.length <= limits.list &&
    list.every((entry) => validText(entry, limits.preference));

  const replay = [];
  for (const persona of personas) {
    if (!isRecord(persona) || !validText(persona.id, limits.name) || !validText(persona.name, limits.name)) {
      return { error: 'Each household member needs a valid ID and name.' };
    }
    const { id, name, ageGroup, preferences, dislikes, needs, schedule } = persona;
    if (ids.has(id)) return { error: 'Household members must have unique IDs.' };
    ids.add(id);
    if (!ageGroups.includes(ageGroup) || !validList(preferences) || !validList(dislikes)) {
      return { error: `Check ${name}’s age group, preferences, and dislikes.` };
    }
    if (!isRecord(needs) || Object.keys(needs).length !== needNames.length || needNames.some((key) =>
      !Object.hasOwn(needs, key) || !Number.isFinite(needs[key]) || needs[key] < 0 || needs[key] > 1)) {
      return { error: `${name}’s needs must each be a number from 0 to 1.` };
    }
    const scheduleError = validateScheduleEntries(schedule, roomIds, name);
    if (scheduleError) return { error: scheduleError };
    const result = resolveSchedule(schedule);
    if (result.error === 'overlap') return { error: `${name} has overlapping activities.` };
    if (result.error === 'window') {
      return { error: `${name} has a flexible activity that cannot fit. Adjust its window, duration, or other activities.` };
    }
    if (result.schedule.length) replay.push({ ...persona, schedule: result.schedule });
  }
  return { replay };
}

export function validatePersonas(personas, rooms) {
  return evaluateHousehold(personas, rooms).error ?? null;
}

export function prepareHouseholdReplay(personas, rooms) {
  const { error, replay } = evaluateHousehold(personas, rooms);
  if (error) throw new Error(error);
  return structuredClone(replay);
}

const objectSchema = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const stringEnum = (values) => ({ type: 'string', enum: [...values] });
const textListSchema = { type: 'array', items: { type: 'string' } };
const minuteSchema = { type: 'integer', minimum: 0, maximum: minutesPerDay };
const destinationSchema = { activity: stringEnum(personaActivities), roomId: { type: 'string' } };

// Gemini drafts omit IDs. The server supplies them after parsing the response.
export const personaDraftSchema = objectSchema({
  personas: {
    type: 'array', minItems: 1,
    items: objectSchema({
      name: { type: 'string' },
      ageGroup: stringEnum(ageGroups),
      preferences: textListSchema,
      dislikes: textListSchema,
      needs: objectSchema(Object.fromEntries(needNames.map((key) => [key, {
        type: 'number', minimum: 0, maximum: 1,
      }]))),
      schedule: {
        type: 'array',
        items: { anyOf: [
          objectSchema({ ...destinationSchema, startMinute: minuteSchema, endMinute: minuteSchema }),
          objectSchema({
            ...destinationSchema,
            windowStartMinute: minuteSchema,
            windowEndMinute: minuteSchema,
            durationMinutes: { type: 'integer', minimum: 1 },
          }),
        ] },
      },
    }),
  },
});
