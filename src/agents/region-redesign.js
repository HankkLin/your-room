import { getObjectBoundingBox } from "../../house-model.js";
import { isRegionFinding, measuredFinding } from "./regional-findings.js";
import { parseReplayGeometry, parseReplayProposal, replayProposalSchema } from "./replay-suggestion-contract.js";

const maxOperations = 10;
const maxFindings = 16;
const text = (value, max = 160) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

export function validRegion(bounds) {
  return Array.isArray(bounds) && bounds.length === 4 && Array.from(bounds).every(Number.isFinite)
    && bounds[0] < bounds[2] && bounds[1] < bounds[3];
}

export function intersectsRegion([left, top, right, bottom], box) {
  return box.minX < right && box.maxX > left && box.minZ < bottom && box.maxZ > top;
}

export function regionContainsItem(region, item) {
  const box = getObjectBoundingBox(item);
  return box.minX >= region[0] && box.maxX <= region[2] && box.minZ >= region[1] && box.maxZ <= region[3];
}

function withinRegion(region, object, position) {
  const [width, height, depth] = object.dimensions;
  return regionContainsItem(region, { width, height, depth, position, rotation: object.rotation });
}

export function isRegionTarget(region, object) {
  return !object.locked && withinRegion(region, object, object.position);
}

function findingTag(finding) {
  return finding.type + ":" + (finding.roomId || finding.location.roomId || "home");
}

export function parseRegionInput(value) {
  if (!validRegion(value?.region) || !text(value.instruction, 800)
      || !Array.isArray(value.findings) || value.findings.length > maxFindings) {
    throw new Error("Select an area and enter an instruction of up to 800 characters.");
  }
  const geometry = parseReplayGeometry(value);
  const { region } = value;
  const roomIds = new Set(geometry.rooms.filter(({ bounds: [minX, minZ, maxX, maxZ] }) =>
    intersectsRegion(region, { minX, minZ, maxX, maxZ })).map(({ id }) => id));
  const findings = value.findings.map(measuredFinding);
  if (!roomIds.size || findings.some(finding => !isRegionFinding(finding, region, roomIds))) {
    throw new Error("The selected area and its replay findings do not match.");
  }
  return { ...geometry, region, instruction: value.instruction.trim(), findings };
}

export const regionPatchSchema = {
  type: "object", additionalProperties: false, required: ["id", "reasoning", "targetFindings", "operations"],
  properties: {
    id: { type: "string" }, reasoning: { type: "string" },
    targetFindings: { type: "array", items: { type: "string" } },
    operations: { ...replayProposalSchema.properties.scenePatch.properties.operations, maxItems: maxOperations },
  },
};

export function parseRegionPatch(patch, input) {
  if (!patch || Object.keys(patch).length !== 4 || !text(patch.id) || !text(patch.reasoning, 400)
      || !Array.isArray(patch.targetFindings) || patch.targetFindings.length > maxFindings
      || !Array.isArray(patch.operations) || !patch.operations.length || patch.operations.length > maxOperations) {
    throw new Error("Gemini returned an invalid regional ScenePatch.");
  }
  const tags = new Set(input.findings.map(findingTag));
  if (patch.targetFindings.some(tag => !tags.has(tag))) throw new Error("The patch refers to an unmeasured finding.");
  const ids = new Set();
  for (const op of patch.operations) {
    parseReplayProposal({ explanation: patch.reasoning, scenePatch: { operations: [op] } }, input.objects);
    const target = input.objects.find(object => object.id === op.objectId);
    if (!withinRegion(input.region, target, target.position) || !withinRegion(input.region, target, op.position)) {
      throw new Error("The furniture or its proposed destination extends outside the selected area.");
    }
    if (ids.has(target.id)) throw new Error("A regional patch can move each piece only once.");
    ids.add(target.id);
  }
  return { id: patch.id, reasoning: patch.reasoning.trim(), targetFindings: patch.targetFindings, operations: patch.operations };
}
