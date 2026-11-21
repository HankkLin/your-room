import { getObjectBoundingBox, syncHouseObjects } from '../../house-model.js';
import { compareHouseholdLayouts } from '../persona/compare-household-layouts.js';

function studioObstacle(object) {
  if (object.kind === 'rug' || object.passable === true || getObjectBoundingBox(object).walkable) {
    return { ...object, passable: true };
  }

  const { x, z, width, depth, rotationRadians } = object;
  const cos = Math.cos(rotationRadians[1]);
  const sin = Math.sin(rotationRadians[1]);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const corners = [
    [-halfWidth, -halfDepth], [halfWidth, -halfDepth],
    [halfWidth, halfDepth], [-halfWidth, halfDepth],
  ];

  // Project the Studio's Three.js Y rotation onto the X/Z floor plane.
  const footprint = corners.map(([localX, localZ]) => [
    x + localX * cos + localZ * sin,
    z - localX * sin + localZ * cos,
  ]);
  return { ...object, footprint };
}

export function captureStudioLayout(house, items) {
  if (!house) return null;
  const fixtureIds = new Set((house.fixtures ?? []).map(({ id }) => id));
  const liveItems = items.filter((item) => !item.fromHouseFixture && !fixtureIds.has(item.id));
  const layout = syncHouseObjects(house, liveItems);
  layout.objects = layout.objects.map(studioObstacle);
  // The committed Studio items supersede any legacy objects stored on the House.
  delete layout.items;
  return structuredClone(layout);
}

export async function runStudioReplay({ beforeScene, afterScene, personas, rooms }) {
  const { simulateHouse } = await import('./simulation-engine.js');
  return compareHouseholdLayouts({
    beforeScene,
    afterScene,
    personas,
    rooms,
    // The Studio reports findings and metrics without displaying every timeline frame.
    simulate: (house, household) => simulateHouse(house, household, { timelineSampleSeconds: 60 }),
  });
}
