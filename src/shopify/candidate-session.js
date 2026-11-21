const resultLifetimeMs = 10 * 60 * 1000;

// Kept outside project state: browsing an alternative never adds a scene object or saved line.
export function createCandidateSession(now = Date.now) {
  let snapshot = null;
  return {
    read() {
      if (snapshot && now() >= snapshot.expiresAt) snapshot = null;
      return snapshot;
    },
    remember({ query, kind, products, warnings, source }, expiresAt = now() + resultLifetimeMs) {
      snapshot = { query, kind, products: [...products], warnings: [...warnings], expiresAt, ...(source ? { source } : {}) };
      return snapshot;
    },
    clear() { snapshot = null; },
  };
}
