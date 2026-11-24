// Move existing saves to the new project name on first use.
export function resolveStorageKey(suffix) {
  if (import.meta.env?.MODE === "portfolio") return `living-blueprint.portfolio.${suffix}`;
  const key = `living-blueprint.${suffix}`;
  const previousKey = `stillroom.${suffix}`;
  if (typeof window === "undefined") return key;
  try {
    const storage = window.localStorage;
    const previous = storage.getItem(previousKey);
    if (previous === null) return key;
    if (storage.getItem(key) === null) {
      try {
        storage.setItem(key, previous);
      } catch {
        // A large photo may fill the quota. Keep using its original save slot.
        return previousKey;
      }
    }
    storage.removeItem(previousKey);
  } catch {
    // The app supports session-only projects when browser storage is disabled.
  }
  return key;
}
