import { prepareHouseholdReplay } from '../contracts/persona.js';

export async function compareHouseholdLayouts({ beforeScene, afterScene, personas, rooms, simulate }) {
  const replay = prepareHouseholdReplay(personas, rooms);
  // Each run starts from the approved snapshot even if the simulator mutates its input.
  const before = await simulate(beforeScene, structuredClone(replay));
  const after = await simulate(afterScene, structuredClone(replay));
  return { before, after };
}
