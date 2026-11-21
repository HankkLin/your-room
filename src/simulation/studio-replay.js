import { withFurnitureFootprint } from "../spatial/furniture-footprint.js";
import { getObjectBoundingBox, syncHouseObjects } from '../../house-model.js';
import { environmentInputs } from '../environment/environment-context.js';
import { compareHouseholdLayouts } from '../persona/compare-household-layouts.js';

function studioObstacle(object) {
  if (object.kind === 'rug' || object.passable === true || getObjectBoundingBox(object).walkable) {
    return { ...object, passable: true };
  }

  return withFurnitureFootprint(object);
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
  return compareHouseholdLayouts({
    beforeScene,
    afterScene,
    personas,
    rooms,
    simulate: (scene, household) => simulateStudioLayout(scene, household, beforeScene?.environment?.snapshot ?? null),
  });
}

export async function simulateStudioLayout(scene, resolvedHousehold, snapshot = scene.environment?.snapshot ?? null) {
  const [{ simulateHouse }, { evaluateHouseholdExperience }] = await Promise.all([
    import('./simulation-engine.js'), import('./validators/household-evaluation.js'),
  ]);
  // Keep the approved schedule available for replays after the layout changes.
  const inputs = environmentInputs(snapshot);
  const house = { ...scene, environment: { ...scene.environment, snapshot: inputs.environment } };
  const result = simulateHouse(house, structuredClone(resolvedHousehold), { timelineSampleSeconds: 60, ...inputs });
  const evaluation = evaluateHouseholdExperience({
    house, household: resolvedHousehold, simulation: result, sun: inputs.sun,
  });
  return { ...result, evaluation, environment: inputs.environment };
}
