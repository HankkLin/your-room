export {
  MAX_SCENE_PATCH_OPERATIONS,
  PATCH_ERROR_CODES,
  SCENE_PATCH_GEMINI_SCHEMA,
  SCENE_PATCH_JSON_SCHEMA,
  SCENE_PATCH_OPERATION_TYPES,
  formatFindingTag,
} from "../contracts/scene-patch.js";

export {
  REDESIGN_MODELS,
  buildRedesignPromptContext,
  callGeminiRedesignApi,
  createRedesignApiMiddleware,
  generateScenePatch,
  normalizeGeneratedScenePatch,
  redesignApiPath,
} from "../agents/redesign-agent.js";

export {
  applyScenePatch,
  describePatchActions,
  lookupCandidateProduct,
  parsePositionTriple,
  parseRotationTriple,
} from "./apply-scene-patch.js";

export { validateScenePatch } from "./validate-scene-patch.js";

export {
  compareEvaluations,
  extractCategoryScoreMap,
  findingIdentityKey,
} from "./compare-evaluations.js";

export {
  buildFallbackScenePatch,
  createRedesignDemoHouse,
} from "./fallback-patch.js";

export {
  evaluateCandidatePatch,
  runRedesignReplay,
  toRedesignUiPayload,
} from "./redesign-replay.js";
