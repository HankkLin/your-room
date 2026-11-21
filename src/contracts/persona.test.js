import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareHouseholdReplay, validatePersonaRooms, validatePersonas } from './persona.js';
import { compareHouseholdLayouts } from '../persona/compare-household-layouts.js';
import { listPersonaRooms } from '../persona/rooms.js';
import { createSampleHousehold } from '../persona/sample-household.js';
import { importSampleFloorplan } from '../spatial/floorplan-importer.js';

const rooms = [{ id: 'study', name: 'Study' }, { id: 'living-room', name: 'Living room' }];
const singleRoom = listPersonaRooms({ roomName: 'Family room' });

function flexibleActivity(activity, overrides = {}) {
  return { activity, roomId: 'room-1', windowStartMinute: 510, windowEndMinute: 720, durationMinutes: 45, ...overrides };
}

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

test('imported room IDs survive room edits and reach both replay runs unchanged', async () => {
  const { house, validation } = importSampleFloorplan();
  assert.equal(validation.valid, true);
  const before = { roomName: house.name, room: { width: 5 }, importedHouse: house };
  const after = { ...before, roomName: 'Updated apartment', room: { width: 6 } };
  const importedRooms = listPersonaRooms(before);
  assert.deepEqual(importedRooms, house.rooms.map(({ id, name }) => ({ id, name })));
  assert.deepEqual(listPersonaRooms(after), importedRooms);

  const [alex] = createSampleHousehold(importedRooms);
  alex.schedule = [
    { activity: 'sleep', roomId: 'bedroom', startMinute: 420, endMinute: 510 },
    flexibleActivity('cook', { roomId: 'kitchen', durationMinutes: 30 }),
  ];
  assert.equal(validatePersonas([alex], listPersonaRooms(after)), null);
  assert.match(validatePersonas([alex], singleRoom), /available room/);

  const expected = [
    { activity: 'sleep', roomId: 'bedroom', startMinute: 420, endMinute: 510 },
    { activity: 'cook', roomId: 'kitchen', startMinute: 510, endMinute: 540 },
  ];
  const outcomes = await compareHouseholdLayouts({
    beforeScene: before, afterScene: after, personas: [alex], rooms: importedRooms,
    simulate(scene, [resident]) {
      const destinations = new Set(listPersonaRooms(scene).map(({ id }) => id));
      assert.ok(resident.schedule.every(({ roomId }) => destinations.has(roomId)));
      return { width: scene.room.width, schedule: resident.schedule };
    },
  });
  assert.deepEqual(outcomes, {
    before: { width: 5, schedule: expected },
    after: { width: 6, schedule: expected },
  });
});

test('an imported room keeps its canonical ID even when its display name needs shortening', () => {
  const importedRoom = { id: 'canonical-'.repeat(10), name: 'Reading room '.repeat(8) };
  const destinations = listPersonaRooms({ importedHouse: { rooms: [importedRoom] } });
  assert.equal(destinations[0].id, importedRoom.id);
  assert.equal(destinations[0].name.length, 80);
  assert.equal(validatePersonaRooms(destinations), null);
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

test('flexible windows resolve deterministically around fixed times and retain destinations', () => {
  const [alex] = createSampleHousehold(singleRoom);
  alex.schedule = [
    { activity: 'work', roomId: 'room-1', startMinute: 540, endMinute: 600 },
    flexibleActivity('exercise'),
    flexibleActivity('eat', { durationMinutes: 30 }),
    flexibleActivity('relax', { windowStartMinute: 1410, windowEndMinute: 1440, durationMinutes: 30 }),
  ];
  const before = structuredClone(alex);
  const replay = prepareHouseholdReplay([alex], singleRoom);
  assert.deepEqual(replay[0].schedule, [
    { activity: 'work', roomId: 'room-1', startMinute: 540, endMinute: 600 },
    { activity: 'exercise', roomId: 'room-1', startMinute: 600, endMinute: 645 },
    { activity: 'eat', roomId: 'room-1', startMinute: 645, endMinute: 675 },
    { activity: 'relax', roomId: 'room-1', startMinute: 1410, endMinute: 1440 },
  ]);
  assert.deepEqual(alex, before);
});

test('an unscheduled guest keeps their profile and has no events in the daily replay', () => {
  const [guest] = createSampleHousehold(singleRoom);
  guest.schedule = [];
  assert.equal(validatePersonas([guest], singleRoom), null);
  assert.deepEqual(prepareHouseholdReplay([guest], singleRoom), []);
  assert.equal(guest.preferences[0], 'Quiet workspace');
});

test('a before/after comparison reuses the resolved household despite changes during the first run', async () => {
  const [alex, guest] = createSampleHousehold(singleRoom);
  const work = { activity: 'work', roomId: 'room-1', startMinute: 540, endMinute: 600 };
  alex.schedule = [flexibleActivity('exercise'), work];
  guest.schedule = [];
  const expected = [{ ...alex, schedule: [
    work,
    { activity: 'exercise', roomId: 'room-1', startMinute: 600, endMinute: 645 },
  ] }];
  const scenes = [{ layout: 'before' }, { layout: 'after' }];
  const calls = [];
  const result = await compareHouseholdLayouts({
    beforeScene: scenes[0], afterScene: scenes[1], personas: [alex, guest], rooms: singleRoom,
    async simulate(scene, replay) {
      calls.push({ scene, replay: structuredClone(replay) });
      replay[0].schedule[0].roomId = 'mutated';
      alex.schedule[0].windowStartMinute = 630;
      return scene.layout;
    },
  });
  assert.deepEqual(result, { before: 'before', after: 'after' });
  assert.deepEqual(calls, scenes.map((scene) => ({ scene, replay: expected })));
});

test('a flexible activity blocked by a fixed activity produces an error before replay', async () => {
  const [alex] = createSampleHousehold(singleRoom);
  alex.schedule = [
    { activity: 'work', roomId: 'room-1', startMinute: 540, endMinute: 600 },
    flexibleActivity('exercise', { windowEndMinute: 600 }),
  ];
  assert.match(validatePersonas([alex], singleRoom), /cannot fit/);
  await assert.rejects(compareHouseholdLayouts({
    beforeScene: {}, afterScene: {}, personas: [alex], rooms: singleRoom,
    simulate: () => assert.fail('Invalid schedules should not reach the simulator'),
  }), /cannot fit/);
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
  ['missing schedule', ([alex]) => { delete alex.schedule; }, /schedule entries/],
  ['incomplete flexible window', ([alex]) => {
    alex.schedule = [{ activity: 'work', roomId: 'study', windowStartMinute: 540 }];
  }, /window and duration/],
  ['duration longer than the window', ([alex]) => {
    alex.schedule = [flexibleActivity('work', { roomId: 'study', durationMinutes: 211 })];
  }, /window and duration/],
  ['mixed fixed and flexible timing', ([alex]) => {
    alex.schedule[0].durationMinutes = 45;
  }, /window and duration/],
  ['flexible time outside the day', ([alex]) => {
    alex.schedule = [flexibleActivity('work', { roomId: 'study', windowEndMinute: 1441 })];
  }, /window and duration/],
  ['same-person overlap', ([, sam]) => { sam.schedule[1].startMinute = 959; }, /overlapping/],
];

for (const [description, mutate, error] of invalidCases) {
  test(`persona validation rejects ${description}`, () => {
    const personas = createSampleHousehold(rooms);
    mutate(personas);
    assert.match(validatePersonas(personas, rooms), error);
  });
}
