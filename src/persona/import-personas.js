import { validateImportedPersonaDraft } from '../contracts/persona.js';

export const maxPersonaImportBytes = 256 * 1024;

function selectFields(record, keys) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
}

const activityFields = ['activity', 'roomId', 'startMinute', 'endMinute', 'windowStartMinute', 'windowEndMinute', 'durationMinutes'];

export function parsePersonaImport(text, rooms) {
  if (new TextEncoder().encode(text).length > maxPersonaImportBytes) {
    throw new Error('Choose a JSON export up to 256 KB.');
  }

  let data;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error('Could not read the JSON. Paste the export shown in the example or choose a JSON file.');
  }
  const members = Array.isArray(data) ? data : data?.personas;
  if (!Array.isArray(members) || !members.length) throw new Error('Include at least one member in the personas array.');

  const personas = members.map((record) => {
    const member = selectFields(record, ['id', 'name', 'ageGroup', 'preferences', 'dislikes', 'needs', 'schedule']);
    if (!member || typeof member !== 'object' || Array.isArray(member)) return member;
    if (!Object.hasOwn(member, 'id')) member.id = crypto.randomUUID();
    if (Array.isArray(member.schedule)) member.schedule = member.schedule.map((entry) => selectFields(entry, activityFields));
    return member;
  });
  const error = validateImportedPersonaDraft(personas, rooms);
  if (error) throw new Error(error);
  return personas;
}
