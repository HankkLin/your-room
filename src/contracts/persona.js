export const personaActivities = Object.freeze([
  'sleep', 'work', 'study', 'cook', 'eat', 'relax', 'watchTv',
  'bathroom', 'socialize', 'exercise', 'other',
]);

const ageGroups = ['child', 'teen', 'adult', 'olderAdult'];
const needNames = ['privacy', 'quiet', 'accessibility', 'daylight', 'social'];
const minutesPerDay = 1440;
const limits = { people: 12, rooms: 50, schedule: 32, name: 80, list: 12, preference: 120 };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validatePersonaRooms(rooms) {
  if (!Array.isArray(rooms) || !rooms.length || rooms.length > limits.rooms) {
    return `Provide between 1 and ${limits.rooms} available rooms.`;
  }
  const ids = new Set();
  for (const room of rooms) {
    if (!isRecord(room) || !validText(room.id, limits.name) || !validText(room.name, limits.name)) {
      return 'Each available room needs a valid ID and name.';
    }
    if (ids.has(room.id)) return 'Available rooms must have unique IDs.';
    ids.add(room.id);
  }
  return null;
}

function validateSchedule(schedule, roomIds, name) {
  if (!Array.isArray(schedule) || !schedule.length || schedule.length > limits.schedule) {
    return `${name} needs between 1 and ${limits.schedule} schedule entries.`;
  }
  for (const entry of schedule) {
    if (!isRecord(entry) || !personaActivities.includes(entry.activity)) {
      return `Choose a valid activity for ${name}.`;
    }
    const { roomId, startMinute, endMinute } = entry;
    if (!roomIds.has(roomId)) return `Choose an available room for each of ${name}’s activities.`;
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) ||
        startMinute < 0 || startMinute >= endMinute || endMinute > minutesPerDay) {
      return `Check ${name}’s activity times. Use an end time after the start, and split overnight activities at midnight.`;
    }
  }
  const ordered = [...schedule].sort((a, b) => a.startMinute - b.startMinute);
  if (ordered.some((entry, index) => index > 0 && entry.startMinute < ordered[index - 1].endMinute)) {
    return `${name} has overlapping activities.`;
  }
  return null;
}

export function validatePersonas(personas, rooms) {
  if (!Array.isArray(personas) || personas.length > limits.people) {
    return `A household can have up to ${limits.people} people.`;
  }
  if (!personas.length) return null;
  const roomsError = validatePersonaRooms(rooms);
  if (roomsError) return roomsError;
  const roomIds = new Set(rooms.map(({ id }) => id));
  const ids = new Set();
  const validList = (list) => Array.isArray(list) && list.length <= limits.list &&
    list.every((entry) => validText(entry, limits.preference));

  for (const persona of personas) {
    if (!isRecord(persona) || !validText(persona.id, limits.name) || !validText(persona.name, limits.name)) {
      return 'Each household member needs a valid ID and name.';
    }
    const { id, name, ageGroup, preferences, dislikes, needs, schedule } = persona;
    if (ids.has(id)) return 'Household members must have unique IDs.';
    ids.add(id);
    if (!ageGroups.includes(ageGroup) || !validList(preferences) || !validList(dislikes)) {
      return `Check ${name}’s age group, preferences, and dislikes.`;
    }
    if (!isRecord(needs) || Object.keys(needs).length !== needNames.length || needNames.some((key) =>
      !Object.hasOwn(needs, key) || !Number.isFinite(needs[key]) || needs[key] < 0 || needs[key] > 1)) {
      return `${name}’s needs must each be a number from 0 to 1.`;
    }
    const scheduleError = validateSchedule(schedule, roomIds, name);
    if (scheduleError) return scheduleError;
  }
  return null;
}

const objectSchema = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const stringEnum = (values) => ({ type: 'string', enum: [...values] });
const textListSchema = { type: 'array', items: { type: 'string' } };
const minuteSchema = { type: 'integer', minimum: 0, maximum: minutesPerDay };

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
        type: 'array', minItems: 1,
        items: objectSchema({
          activity: stringEnum(personaActivities),
          roomId: { type: 'string' },
          startMinute: minuteSchema,
          endMinute: minuteSchema,
        }),
      },
    }),
  },
});
