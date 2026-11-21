import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  createSimulationSceneLayer,
  deriveAgentStyle,
  formatFindingEvidenceChips,
  formatSimulationClock,
  mapFindingToOverlaySpec,
  selectVisibleRoutes,
} from "./src/components/avatar/simulation-scene-layer.js";
import { createSimulationPlaybackController } from "./src/components/simulation/playback-controller.js";
import { createDemoControlsController } from "./src/components/simulation/demo-controls.js";
import {
  createMockPlaybackDataset,
  getMockSimulationSnapshotAt,
} from "./demo-playback-mock.js";
import { createWholeHomeDemoHouse } from "./house-demo.js";

test("U1 — Creates a 3D avatar mesh for each snapshot agent with deterministic color identity", () => {
  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  const meta = new Map([
    ["kevin", { name: "Kevin" }],
    ["alice", { name: "Alice" }],
  ]);

  layer.updateAvatars(
    [
      { agentId: "kevin", position: [-2.1, -1.8], yaw: 0, moving: true },
      { agentId: "alice", position: [2.6, 1.4], yaw: Math.PI / 2, moving: true },
    ],
    meta,
  );

  assert.equal(layer.getAvatarCount(), 2);
  assert.equal(layer.avatarsGroup.children.length, 2);
  assert.equal(deriveAgentStyle("kevin").color, deriveAgentStyle("kevin").color);
  assert.notEqual(layer.getAvatarMesh("kevin"), null);
  assert.notEqual(layer.getAvatarMesh("alice"), null);
  assert.deepEqual(
    [layer.getAvatarMesh("kevin").position.x, layer.getAvatarMesh("kevin").position.z],
    [-2.1, -1.8],
  );
  layer.dispose();
});

test("U2 — Same agent updates position and heading in-place instead of duplicating meshes", () => {
  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  const meta = new Map([["kevin", { name: "Kevin" }]]);

  layer.updateAvatars(
    [{ agentId: "kevin", position: [-1.0, 0.5], yaw: 0, moving: true }],
    meta,
  );
  const meshBefore = layer.getAvatarMesh("kevin");
  assert.equal(layer.getAvatarCount(), 1);

  layer.updateAvatars(
    [{ agentId: "kevin", position: [1.8, 2.2], yaw: Math.PI / 4, moving: true }],
    meta,
  );
  const meshAfter = layer.getAvatarMesh("kevin");

  assert.equal(meshBefore, meshAfter);
  assert.equal(layer.getAvatarCount(), 1);
  assert.equal(layer.avatarsGroup.children.length, 1);
  assert.ok(Math.abs(meshAfter.position.x - 1.8) < 1e-6);
  assert.ok(Math.abs(meshAfter.position.z - 2.2) < 1e-6);
  layer.dispose();
});

test("U3 — Reset / clear removes all playback avatars, route polylines, finding hotspots, and patch transitions", () => {
  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  const house = createWholeHomeDemoHouse();
  const dataset = createMockPlaybackDataset("dinner-party-8-guests", {
    house,
    items: house.objects,
  });

  const snaps = getMockSimulationSnapshotAt(
    dataset.simulation,
    dataset.simulation.startSecond + 180,
  );
  assert.equal(snaps.length, 10);

  const visibleRoutes = selectVisibleRoutes({
    routes: dataset.simulation.routes,
    snapshots: snaps,
    timestampSeconds: dataset.simulation.startSecond + 180,
    showAllRoutes: true,
  });

  layer.updateAvatars(snaps, new Map(dataset.simulation.agents.map((a) => [a.id, a])));
  layer.updateRoutes(visibleRoutes);
  layer.setFindings(dataset.findings, { house, items: house.objects });
  layer.showPatchTransition(dataset.patchChanges);

  assert.equal(layer.getAvatarCount(), 10);
  assert.ok(layer.routesGroup.children.length > 0);
  assert.ok(layer.getOverlayCount() > 0);
  assert.ok(layer.patchGroup.children.length > 0);

  layer.clear();

  assert.equal(layer.getAvatarCount(), 0);
  assert.equal(layer.avatarsGroup.children.length, 0);
  assert.equal(layer.routesGroup.children.length, 0);
  assert.equal(layer.findingsGroup.children.length, 0);
  assert.equal(layer.patchGroup.children.length, 0);
  layer.dispose();
});

test("U4 — Speed state (1× / 5× / 20×) integrates between Demo Controls and Playback Controller", () => {
  const playback = createSimulationPlaybackController({
    baseSimSecondsPerRealSecond: 10,
  });
  const controls = createDemoControlsController({
    onSimulationSpeedChange: (mult) => playback.setSpeed(mult),
  });

  playback.load({
    simulation: {
      startSecond: 0,
      endSecond: 1000,
      agents: [{ id: "kevin", name: "Kevin" }],
      routes: [],
      timeline: [
        { timestamp: 0, minute: 0, agentId: "kevin", position: [0, 0], yaw: 0, moving: true },
        { timestamp: 1000, minute: 16.6, agentId: "kevin", position: [4, 2], yaw: 0, moving: false },
      ],
    },
  });
  playback.play();

  // 1x: 1000ms * 10 simSec/s * 1 = +10s
  playback.step(1000);
  assert.equal(playback.getState().currentSecond, 10);

  // 5x: 1000ms * 10 simSec/s * 5 = +50s -> 60s
  controls.selectSpeed(5);
  playback.step(1000);
  assert.equal(playback.getState().currentSecond, 60);

  // 20x: 1000ms * 10 simSec/s * 20 = +200s -> 260s
  controls.selectSpeed(20);
  playback.step(1000);
  assert.equal(playback.getState().currentSecond, 260);

  assert.equal(formatSimulationClock({ minute: 462, mode: "clock" }), "07:42 AM");
  assert.equal(formatSimulationClock({ timestampSeconds: 18, mode: "elapsed" }), "00:18 elapsed");
  playback.dispose();
});

test("U5 — CONGESTION finding maps exact floor hotspot coordinates and real evidence chips", () => {
  const finding = {
    id: "cong-kitchen",
    type: "CONGESTION",
    severity: 0.72,
    location: { roomId: "kitchen", position: [3.58, 0.82] },
    evidence: {
      agentCount: 2,
      agentIds: ["kevin", "alice"],
      durationSeconds: 1498,
      minimumClearanceMeters: 0.11,
    },
  };

  const spec = mapFindingToOverlaySpec(finding);
  assert.equal(spec.kind, "hotspot");
  assert.deepEqual(spec.position, [3.58, 0.82]);
  assert.deepEqual(spec.relatedAgentIds, ["kevin", "alice"]);

  const chips = formatFindingEvidenceChips(finding);
  assert.deepEqual(chips, ["2 people", "25.0 min", "0.11 m min clearance"]);
});

test("U6 — PRIVACY_SIGHTLINE finding maps exact observerPosition -> targetPosition dashed sightline ray", () => {
  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  const finding = {
    id: "priv-bath",
    type: "PRIVACY_SIGHTLINE",
    severity: 0.68,
    location: { roomId: "bathroom", position: [3.8, -3.52] },
    evidence: {
      sourceType: "entry",
      sourceId: "door-front-entry",
      targetType: "toilet",
      targetObjectId: "fixture-bathroom-toilet",
      observerPosition: [-3.4, 4.0],
      targetPosition: [3.8, -3.52],
      distanceMeters: 10.41,
      directLineOfSight: true,
    },
  };

  const spec = mapFindingToOverlaySpec(finding);
  assert.equal(spec.kind, "sightline");
  assert.equal(spec.dashed, true);
  assert.deepEqual(spec.from, [-3.4, 4.0]);
  assert.deepEqual(spec.to, [3.8, -3.52]);

  layer.setFindings([finding]);
  assert.equal(layer.getOverlayCount(), 1);
  const lineNode = layer.findingsGroup.children[0].children.find((n) => n.isLine);
  assert.ok(lineNode, "Expected 3D dashed sightline Line mesh");
  assert.ok(lineNode.material.isLineDashedMaterial);
  layer.dispose();
});

test("U7 — Unknown finding types and missing coordinates degrade gracefully without crashing", () => {
  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  const house = createWholeHomeDemoHouse();

  assert.equal(mapFindingToOverlaySpec(null), null);
  assert.equal(mapFindingToOverlaySpec({ type: "FUTURE_METRIC_NO_POS" }), null);

  const roomFallbackSpec = mapFindingToOverlaySpec(
    {
      id: "future-room-metric",
      type: "FUTURE_ACOUSTIC_ECHO",
      roomId: "living-room",
    },
    { house },
  );
  assert.equal(roomFallbackSpec.kind, "hotspot");
  assert.equal(roomFallbackSpec.position.length, 2);

  assert.doesNotThrow(() => {
    layer.setFindings(
      [
        null,
        { type: "FUTURE_METRIC_NO_POS" },
        { id: "future-room-metric", type: "FUTURE_ACOUSTIC_ECHO", roomId: "living-room" },
      ],
      { house },
    );
    layer.focusFinding({ type: "FUTURE_METRIC_NO_POS" });
    layer.focusFinding(null);
  });

  assert.equal(layer.getOverlayCount(), 1);
  layer.dispose();
});

test("U8 — Wheelchair avatar mesh & ACCESSIBILITY_CLEARANCE 3D overlay + Grandparents Stayover deterministic clearance check", async () => {
  const { runTwinScenario } = await import("./src/twin-integration.js");
  const { importSampleFloorplan } = await import("./src/spatial/floorplan-importer.js");

  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  const meta = new Map([
    [
      "grandma-evelyn",
      { name: "Grandma Evelyn", wheelchair: true, ageGroup: "olderAdult", color: "#2f6b8a" },
    ],
    ["maya", { name: "Maya", ageGroup: "child", color: "#b4823e" }],
  ]);

  layer.updateAvatars(
    [
      { agentId: "grandma-evelyn", position: [1.5, 2.0], yaw: 0, moving: true },
      { agentId: "maya", position: [2.2, 2.0], yaw: 0, moving: true },
    ],
    meta,
  );
  assert.equal(layer.getAvatarCount(), 2);
  const grandmaGroup = layer.getAvatarMesh("grandma-evelyn");
  const grandmaBody = grandmaGroup.children.find((c) => c.isGroup);
  assert.equal(grandmaBody.children.length, 6, "Wheelchair avatar body renders 2 side wheel rings");

  // Sample 5-room Mercer apartment has 0.76 m bathroom door & 0.82 m kitchen-hall door (< 0.90 m wheelchair standard)
  const { house } = importSampleFloorplan();
  const dataset = runTwinScenario("grandparents-stayover", {
    house,
    items: [],
    state: {},
  });
  assert.equal(dataset.displayPersonas.length, 5);
  const accessFindings = dataset.findings.filter(
    (f) => f.type === "ACCESSIBILITY_CLEARANCE",
  );
  assert.ok(accessFindings.length >= 2, "Detects narrow doorway pinches < 0.90 m");

  const spec = mapFindingToOverlaySpec(accessFindings[0], { house });
  assert.equal(spec.kind, "accessibility");
  layer.setFindings(accessFindings, { house });
  assert.equal(layer.getOverlayCount(), accessFindings.length);
  layer.dispose();
});
