import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM, autoStyle, canPlaceItem, catalog, clearsDoorways, createOwnedItems, fitItem, footprintsOverlap, getSpend, initialState, withinRoom } from './model.js';

function assertLayout(items, room = ROOM) {
  for (const [index, item] of items.entries()) {
    assert.equal(withinRoom(item, room), true, `${item.name} crosses a wall`);
    assert.equal(items.slice(index + 1).some((other) => footprintsOverlap(item, other)), false, `${item.name} overlaps another piece`);
  }
}

test('the demo room opens furnished with purchase references and a clear entry', () => {
  const state = initialState();
  const entrance = { x: -2.18, z: 1.48, width: 1.04, depth: 1.24, rotation: 0 };
  assertLayout(state.items);
  assert.equal(state.items.some((item) => footprintsOverlap(item, entrance)), false);
  assert.equal(state.items.filter((item) => item.owned).length, 2);
  assert(state.items.some((item) => item.url && item.merchantProduct));
  assert.equal(getSpend(state.items), state.spent);
  assert(state.spent <= state.budget);
});

test('a styling request keeps owned furniture, enforces an explicit budget and applies exclusions', () => {
  const original = initialState();
  const owned = original.items.filter((item) => item.owned);
  const request = { ...original, brief: 'Earthy eclectic with storage and no plants under $620' };
  const styled = autoStyle(request);

  assert.equal(styled.style, 'Earthy eclectic');
  assert.equal(styled.budget, 620);
  assert(styled.spent <= 620);
  assert.equal(styled.items.some((item) => item.kind === 'plant'), false);
  assert.equal(styled.items.some((item) => item.kind === 'console'), true);
  assert.deepEqual(styled.items.filter((item) => item.owned), owned);
  assert.deepEqual(styled, autoStyle(request));
  assertLayout(styled.items);
});

test('a zero budget keeps all owned pieces and buys nothing', () => {
  const first = initialState();
  const styled = autoStyle({ ...first, brief: 'Soft modern under $0' });
  assert.equal(styled.style, 'Soft modern');
  assert.equal(styled.spent, 0);
  assert.deepEqual(styled.items, first.items.filter((item) => item.owned));
});

test('an explicit UI style and budget change take precedence over an earlier brief', () => {
  const original = initialState();
  const state = { ...original, brief: 'Warm minimal with no plants under $500' };
  const styled = autoStyle(state, { style: 'Soft modern', budget: 200 });
  assert.equal(styled.style, 'Soft modern');
  assert.equal(styled.budget, 200);
  assert(styled.spent <= 200);
  assert.equal(styled.items.some((item) => item.kind === 'plant'), false);
});

test('every preview product carries a merchant product-page reference', () => {
  for (const { url, merchantProduct } of catalog) {
    assert(merchantProduct);
    assert.match(new URL(url).pathname, /\/products\//);
  }
  const state = autoStyle({ ...initialState(), brief: '', budget: 80 });
  assert.equal(state.items.filter((item) => !item.owned && item.url).length, 1);
});

test('an owned list handles colors, quantities, exclusions, and repeated intake', () => {
  const intake = 'Blue sofa, oak desk, two chairs, no lamps';
  const items = createOwnedItems(intake);
  assert.deepEqual(items.map((item) => item.kind), ['sofa', 'desk', 'chair', 'chair']);
  assert.equal(items[0].name, 'Blue sofa');
  assert.equal(items[1].name, 'Oak desk');
  assert.equal(items.every((item) => item.owned && item.price === 0), true);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.deepEqual(createOwnedItems(intake, items), []);
  assertLayout(items);
});

test('planning around different owned furniture honors available room dimensions', () => {
  const room = { width: 4.1, depth: 3.3, height: 2.52 };
  const items = createOwnedItems('couch, chair, bookcase', [], room);
  const styled = autoStyle({ items, room, style: 'Soft modern', budget: 900, brief: '' });
  assertLayout(styled.items, room);
  assert(styled.spent <= 900);
  assert.deepEqual(styled.items.filter((item) => item.owned), items);
});

test('footprints account for rotation while permitting a rug under furniture', () => {
  const long = { x: 0, z: 0, width: 2, depth: 0.4, rotation: 90, kind: 'sofa' };
  const other = { x: 0, z: 0.7, width: 0.3, depth: 0.3, rotation: 0, kind: 'plant' };
  assert.equal(footprintsOverlap(long, other), true);
  assert.equal(footprintsOverlap({ ...long, rotation: 0 }, other), false);
  assert.equal(footprintsOverlap(long, { ...other, kind: 'rug' }), false);
  assert.equal(footprintsOverlap({ ...long, kind: 'rug' }, { ...other, kind: 'rug' }), true);
});

test('an alcove reserves the missing corner, including rotated furniture footprints', () => {
  const room = { ...ROOM, shape: 'alcove', openings: [] };
  const chair = { id: 'chair-one', kind: 'chair', x: 1.5, z: 1.2, width: 0.70, depth: 0.68, rotation: 0 };
  assert.equal(withinRoom(chair, ROOM), true);
  assert.equal(withinRoom(chair, room), false);
  assert.equal(withinRoom({ ...chair, x: 0.33, z: 0.85, rotation: 45 }, room), true);
  assert.equal(withinRoom({ ...chair, x: 0.45, z: 0.85, rotation: 45 }, room), false);

  const moved = fitItem(chair, room);
  assert.equal(moved.id, chair.id);
  assert.equal(withinRoom(moved, room), true);
});

test('door clearance uses alcove wall lengths and leaves windows unreserved', () => {
  const room = { ...ROOM, shape: 'alcove', openings: [{ kind: 'door', wall: 'front', offset: 0.75 }] };
  const chair = { id: 'chair-one', kind: 'chair', x: 0, z: 1.5, width: 0.70, depth: 0.65, rotation: 0 };
  assert.equal(withinRoom(chair, room), true);
  assert.equal(clearsDoorways(chair, room), false);
  assert.equal(canPlaceItem(chair, room), false);
  assert.equal(clearsDoorways(chair, { ...room, openings: [{ kind: 'window', wall: 'front', offset: 0.75 }] }), true);

  const rightDoor = { ...room, openings: [{ kind: 'door', wall: 'right', offset: 0.75 }] };
  assert.equal(clearsDoorways({ ...chair, x: 2.15, z: -0.08 }, rightDoor), false);
  assert.equal(clearsDoorways({ ...chair, x: 2.15, z: -1.30 }, rightDoor), true);
  assert.equal(canPlaceItem(chair, { ...room, openings: [] }, [chair]), true);
});

test('auto styling keeps alcove and door clear', () => {
  const room = { ...ROOM, shape: 'alcove', openings: [{ kind: 'door', wall: 'front', offset: 0.6 }] };
  const items = createOwnedItems('sofa, bookcase', [], room);
  const styled = autoStyle({ ...initialState(), items, room });
  assertLayout(styled.items, room);
  assert.equal(styled.items.every((item) => clearsDoorways(item, room)), true);
});
