import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePersonaRooms, validatePersonas } from './persona.js';
import { listPersonaRooms } from '../persona/rooms.js';
import { createSampleHousehold } from '../persona/sample-household.js';

const rooms = [{ id: 'study', name: 'Study' }, { id: 'living-room', name: 'Living room' }];

test('the two-room handoff preserves Sam’s destination and the overlap with Alex’s work', () => {
  const personas = createSampleHousehold(rooms);
  const [alex, sam] = personas;
  assert.equal(validatePersonas(personas, rooms), null);
  assert.deepEqual(alex.schedule[0], { activity: 'work', roomId: 'study', startMinute: 540, endMinute: 1020 });
  assert.deepEqual(sam.schedule.map(({ roomId }) => roomId), ['study', 'living-room']);
  assert.equal(sam.schedule[0].endMinute, sam.schedule[1].startMinute);
  assert.equal(sam.schedule[1].startMinute, 960);
  assert.equal(sam.schedule[1].endMinute, 1020);
  assert.equal(Math.min(alex.schedule[0].endMinute, sam.schedule[1].endMinute) -
    Math.max(alex.schedule[0].startMinute, sam.schedule[1].startMinute), 60);
});

test('the single-room adapter keeps the same destination after the room is renamed', () => {
  const original = listPersonaRooms({ roomName: 'My room' });
  const renamed = listPersonaRooms({ roomName: 'Family room' });
  assert.deepEqual(renamed, [{ id: original[0].id, name: 'Family room' }]);
  assert.equal(validatePersonas(createSampleHousehold(original), renamed), null);
  assert.match(validatePersonaRooms([...original, ...renamed]), /unique IDs/);
  assert.equal(validatePersonas([], original), null);
});

test('a schedule can use midnight and adjacent entries regardless of input order', () => {
  const [alex] = createSampleHousehold(rooms);
  alex.schedule = [
    { activity: 'sleep', roomId: 'study', startMinute: 1320, endMinute: 1440 },
    { activity: 'sleep', roomId: 'study', startMinute: 0, endMinute: 420 },
    { activity: 'eat', roomId: 'study', startMinute: 420, endMinute: 450 },
  ];
  assert.equal(validatePersonas([alex], rooms), null);
  assert.equal(alex.schedule[0].startMinute, 1320);
});

const invalidCases = [
  ['blank name', ([alex]) => { alex.name = ' '; }, /ID and name/],
  ['duplicate person ID', ([alex, sam]) => { sam.id = alex.id; }, /unique IDs/],
  ['unknown activity', ([alex]) => { alex.schedule[0].activity = 'fly'; }, /valid activity/],
  ['unknown destination', ([alex]) => { alex.schedule[0].roomId = 'imaginary'; }, /available room/],
  ['out-of-range need', ([alex]) => { alex.needs.quiet = 1.01; }, /number from 0 to 1/],
  ['non-finite need', ([alex]) => { alex.needs.quiet = NaN; }, /number from 0 to 1/],
  ['unknown need', ([alex]) => { alex.needs.unexpected = 0.5; }, /number from 0 to 1/],
  ['reversed times', ([alex]) => { alex.schedule[0].endMinute = 500; }, /activity times/],
  ['fractional times', ([alex]) => { alex.schedule[0].endMinute = 541.5; }, /activity times/],
  ['after midnight', ([alex]) => { alex.schedule[0].endMinute = 1441; }, /activity times/],
  ['empty schedule', ([alex]) => { alex.schedule = []; }, /schedule entries/],
  ['same-person overlap', ([, sam]) => { sam.schedule[1].startMinute = 959; }, /overlapping/],
];

for (const [description, mutate, error] of invalidCases) {
  test(`persona validation rejects ${description}`, () => {
    const personas = createSampleHousehold(rooms);
    mutate(personas);
    assert.match(validatePersonas(personas, rooms), error);
  });
}
