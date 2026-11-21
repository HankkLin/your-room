import assert from "node:assert/strict";
import test from "node:test";
import { createWholeHomeDemoHouse, createWholeHomeDemoState } from "./house-demo.js";
import { createProductCandidate } from "./src/contracts/product.js";
import { PATCH_ERROR_CODES } from "./src/contracts/scene-patch.js";
import { DEMO_CHECKPOINT_TYPES, FINDING_TYPES, SUPPORTED_FRIEND_COUNTS } from "./src/contracts/simulation.js";
import { savedProductsForPatch } from "./src/shopify/scene-candidate.js";
import {
  ASSET_REPRESENTATION_TIERS,
  buildNavigationModel,
  buildOwnedCandidatesFromDetections,
  createOwnedFurnitureCandidate,
  createRegionSelection,
  designEmptyHouse,
  findPath,
  ownedCandidateToSceneObject,
  productCandidateToSceneObject,
  resolveProduct3DRepresentation,
  runScopedRegionRedesign,
  updateOwnedFurnitureDimensions,
} from "./src/simulation/index.js";
import { importSampleFloorplan } from "./src/spatial/floorplan-importer.js";
import { buildDeterministicFurnishingPlan } from "./src/spatial/spatial-design-engine.js";
import { runTwinScenario } from "./src/twin-integration.js";

function createSampleShopifyCandidate({
  withModel = true,
  withDimensions = true,
  widthCm = 165,
  depthCm = 88,
  heightCm = 79,
} = {}) {
  const variant = {
    id: "gid://shopify/ProductVariant/99887766",
    seller_product_id: "gid://shopify/Product/445566",
    title: "Oatmeal Linen",
    url: "https://shop-example.myshopify.com/products/nordic-sofa?variant=99887766",
    seller: { name: "Nordic Home Co", domain: "shop-example.myshopify.com" },
    price: { amount: 129500, currency: "USD" },
    availability: { available: true },
    options: [{ label: "Oatmeal Linen" }],
    media: [
      { type: "image", url: "https://cdn.shopify.com/s/files/1/sofa.jpg" },
      ...(withModel
        ? [
            {
              type: "model_3d",
              sources: [
                { url: "https://cdn.shopify.com/3d/models/nordic-sofa.glb" },
              ],
            },
          ]
        : []),
    ],
    ...(withDimensions
      ? {
          dimensions: {
            unit: "cm",
            width: widthCm,
            depth: depthCm,
            height: heightCm,
          },
        }
      : {}),
  };
  const product = {
    id: "gid://shopify/Product/445566",
    title: "Nordic 2-Seat Sofa",
    variants: [variant],
    media: variant.media,
  };
  return createProductCandidate(product, variant);
}

test("D1 — ProductCandidate → Spatial SceneObject preserves all Shopify metadata and generates spatial fields", () => {
  const candidate = {
    ...createSampleShopifyCandidate({ withModel: true, withDimensions: true }),
    checkoutUrl: "https://shop-example.myshopify.com/checkouts/cn/abc123",
  };

  const sceneObj = productCandidateToSceneObject(candidate, {
    id: "living-nordic-sofa",
    kind: "sofa",
    roomId: "living-room",
    position: [2.4, 0, 2.8],
    rotation: [0, Math.PI / 2, 0],
  });

  assert.equal(sceneObj.id, "living-nordic-sofa");
  assert.equal(sceneObj.type, "shopify");
  assert.equal(sceneObj.roomId, "living-room");
  assert.equal(sceneObj.locked, false);
  assert.equal(sceneObj.owned, false);

  // Preserved commerce & asset metadata
  assert.equal(sceneObj.productId, "gid://shopify/Product/445566");
  assert.equal(sceneObj.variantId, "gid://shopify/ProductVariant/99887766");
  assert.equal(sceneObj.merchant, "Nordic Home Co");
  assert.equal(sceneObj.price, 1295);
  assert.equal(
    sceneObj.productUrl,
    "https://shop-example.myshopify.com/products/nordic-sofa?variant=99887766",
  );
  assert.equal(
    sceneObj.checkoutUrl,
    "https://shop-example.myshopify.com/checkouts/cn/abc123",
  );
  assert.equal(sceneObj.dimensionSource, "merchant");
  assert.equal(
    sceneObj.modelUrl,
    "https://cdn.shopify.com/3d/models/nordic-sofa.glb",
  );

  // Generated spatial geometry
  assert.deepEqual(sceneObj.position, [2.4, 0, 2.8]);
  assert.equal(sceneObj.rotation, 90);
  assert.deepEqual(sceneObj.dimensions, { width: 1.65, height: 0.79, depth: 0.88 });
  assert.deepEqual(sceneObj.collisionDimensions, {
    width: 1.65,
    height: 0.79,
    depth: 0.88,
  });
  assert.equal(sceneObj.footprint.length, 4);
});

test("D2 — Real merchant dimensions drive simulation collision footprint & pathfinding clearance", () => {
  const { house } = importSampleFloorplan();

  // `door-living-kitchen` sits at [5.8, 2.3] (width 1.1m).
  // Compact 0.70 m table at [4.8, 0, 2.3] leaves ample clearance to walk through `door-living-kitchen`;
  // Giant 2.20 m × 1.80 m merchant table centered at [5.2, 0, 2.3] blocks `door-living-kitchen` directly!
  const compactCand = createSampleShopifyCandidate({
    widthCm: 70,
    depthCm: 55,
    heightCm: 75,
  });
  const giantCand = createSampleShopifyCandidate({
    widthCm: 220,
    depthCm: 180,
    heightCm: 75,
  });

  const compactObj = productCandidateToSceneObject(compactCand, {
    id: "test-table",
    kind: "table",
    roomId: "living-room",
    position: [4.8, 0, 2.3],
  });
  const giantObj = productCandidateToSceneObject(giantCand, {
    id: "test-table",
    kind: "table",
    roomId: "living-room",
    position: [5.2, 0, 2.3],
  });

  const navCompact = buildNavigationModel({ ...house, objects: [compactObj] });
  const navGiant = buildNavigationModel({ ...house, objects: [giantObj] });

  const pathWithCompact = findPath({
    navigation: navCompact,
    start: [2.5, 2.3],
    goal: [7.8, 2.3],
  });
  const pathWithGiant = findPath({
    navigation: navGiant,
    start: [2.5, 2.3],
    goal: [7.8, 2.3],
  });

  assert.equal(pathWithCompact.success, true);
  assert(pathWithCompact.doorsTraversed.includes("door-living-kitchen"));
  assert.equal(navGiant.isPointWalkable(5.2, 2.3), false);
  assert(
    !pathWithGiant.success ||
      !pathWithGiant.doorsTraversed.includes("door-living-kitchen"),
  );
  if (pathWithGiant.success) {
    assert(pathWithGiant.distanceMeters > pathWithCompact.distanceMeters + 2.0);
  }
});

test("D3 — 3D asset representation distinguishes verified GLB, representative category GLB, and procedural proxy", () => {
  const verifiedSofa = productCandidateToSceneObject(
    createSampleShopifyCandidate({ withModel: true }),
    { id: "s1", kind: "sofa" },
  );
  assert.equal(
    verifiedSofa.assetRepresentation,
    ASSET_REPRESENTATION_TIERS.VERIFIED_3D_ASSET,
  );

  // If the remote GLB fails to load, falls back cleanly to representative 3D asset (still preserving exact collision dims)
  const failedLoadFallback = resolveProduct3DRepresentation(verifiedSofa, {
    modelLoadFailed: true,
  });
  assert.equal(
    failedLoadFallback.tier,
    ASSET_REPRESENTATION_TIERS.REPRESENTATIVE_3D_ASSET,
  );
  assert.equal(failedLoadFallback.isApproximateVisual, true);
  assert.deepEqual(failedLoadFallback.collisionDimensions, verifiedSofa.dimensions);

  // Sofa without product GLB -> representative 3D asset
  const repSofa = productCandidateToSceneObject(
    createSampleShopifyCandidate({ withModel: false }),
    { id: "s2", kind: "sofa" },
  );
  assert.equal(
    repSofa.assetRepresentation,
    ASSET_REPRESENTATION_TIERS.REPRESENTATIVE_3D_ASSET,
  );

  // Table without product GLB -> procedural approximation (honestly labeled, never claimed photorealistic)
  const procTable = productCandidateToSceneObject(
    createSampleShopifyCandidate({ withModel: false, widthCm: 120, depthCm: 70, heightCm: 74 }),
    { id: "t1", kind: "table" },
  );
  assert.equal(
    procTable.assetRepresentation,
    ASSET_REPRESENTATION_TIERS.PROCEDURAL_APPROXIMATION,
  );
  assert.deepEqual(procTable.collisionDimensions, {
    width: 1.2,
    height: 0.74,
    depth: 0.7,
  });
});

test("D4 & D5 — Empty House + StyleBrief design furnishes rooms cleanly while rejecting invalid Gemini placements", async () => {
  const { house: emptyHouse } = importSampleFloorplan();
  assert.equal(emptyHouse.objects.length, 0);

  const liveSofa = {
    ...createSampleShopifyCandidate({ widthCm: 195, depthCm: 90, heightCm: 84 }),
    kind: "sofa",
  };

  // D5: Inject an invalid Gemini proposal that tries to place a sofa out-of-bounds / through a wall -> deterministically rejected!
  const result = await designEmptyHouse({
    house: emptyHouse,
    styleBrief: { style: "Warm minimal", budget: 4500, brief: "Quiet family home" },
    productCandidates: [liveSofa],
    proposePatchFn: async () => ({
      id: "bad-gemini-furnish",
      reasoning: "Place sofa outside the exterior wall.",
      targetFindings: [],
      operations: [
        {
          type: "add",
          objectId: "bad-wall-sofa",
          position: [-4.5, 0, -3.0],
          rotation: [0, 0, 0],
          object: {
            id: "bad-wall-sofa",
            kind: "sofa",
            name: "Out of Bounds Sofa",
            dimensions: { width: 2.0, height: 0.85, depth: 0.9 },
          },
        },
      ],
    }),
  });

  // Invalid proposal was recorded & rejected, and deterministic planner produced a valid furnished home
  assert.equal(result.rejectedProposals.length, 1);
  assert(
    result.rejectedProposals[0].errors.some(
      (e) =>
        e.code === PATCH_ERROR_CODES.OUTSIDE_ROOM_BOUNDS ||
        e.code === PATCH_ERROR_CODES.WALL_INTERSECTION,
    ),
  );
  assert(result.house.objects.length >= 4);
  assert.equal(result.evaluation.simulation.summary.pathFailures, 0);
  // Locked fixtures remain 100% untouched
  assert.deepEqual(result.house.fixtures, emptyHouse.fixtures);
});

test("D6 — Existing furniture photo intake estimates dimensions, supports user correction, and excludes owned items from checkout", async () => {
  // Simulate `detectFurnishings()` photo detection output
  const detectedGroups = [
    {
      kind: "sofa",
      name: "Sofa",
      count: 1,
      positions: [{ x: 0.48, y: 0.72, color: "#7b6c5e", aspectRatio: 2.5 }],
    },
  ];
  const ownedCandidates = buildOwnedCandidatesFromDetections(detectedGroups);
  assert.equal(ownedCandidates.length, 1);
  assert.equal(ownedCandidates[0].owned, true);
  assert.equal(ownedCandidates[0].dimensionSource, "estimated");

  // User corrects dimensions to exact measured tape-measure values
  const corrected = updateOwnedFurnitureDimensions(ownedCandidates[0], {
    width: 2.05,
    depth: 0.92,
    height: 0.84,
  });
  assert.equal(corrected.dimensionSource, "user_corrected");
  assert.deepEqual(corrected.dimensions, { width: 2.05, height: 0.84, depth: 0.92 });

  const ownedSceneObj = ownedCandidateToSceneObject(corrected, {
    id: "owned-family-sofa",
    roomId: "living-room",
    position: [2.8, 0, 2.4],
  });
  assert.equal(ownedSceneObj.owned, true);
  assert.equal(ownedSceneObj.price, 0);
  assert.equal(ownedSceneObj.shopify, undefined);

  // Furnish empty house around this owned sofa -> owned sofa is kept in `ownedObjects` and excluded from `purchasableObjects` & `savedProducts`
  const { house: emptyHouse } = importSampleFloorplan();
  const designed = await designEmptyHouse({
    house: emptyHouse,
    styleBrief: { style: "Warm minimal", budget: 3200 },
    existingFurniture: [ownedSceneObj],
  });

  assert(designed.ownedObjects.some((o) => o.id === "owned-family-sofa"));
  assert(!designed.purchasableObjects.some((o) => o.id === "owned-family-sofa"));

  const savedRows = savedProductsForPatch(
    [],
    {
      operations: designed.house.objects.map((o) => ({
        type: "add",
        objectId: o.id,
      })),
    },
    designed.house.objects,
  );
  assert(!savedRows.some((r) => r.id === "owned-family-sofa"));
});

test("D7 — RegionSelection scopes ScenePatch strictly to selected region and rejects out-of-region mutations", async () => {
  const house = createWholeHomeDemoHouse();

  // Select a polygon covering ONLY the Kitchen (`x: [1.6, 4.8], z: [-0.4, 4.0]`)
  const kitchenRegion = createRegionSelection(
    {
      polygonXZ: [
        [1.65, -0.35],
        [4.75, -0.35],
        [4.75, 3.95],
        [1.65, 3.95],
      ],
    },
    house,
  );

  assert.deepEqual(kitchenRegion.roomIds, ["kitchen"]);
  assert(kitchenRegion.selectedObjectIds.includes("kitchen-table-1"));
  assert(!kitchenRegion.selectedObjectIds.includes("home-sofa"));
  assert(!kitchenRegion.selectedObjectIds.includes("fixture-kitchen-stove")); // locked fixture excluded!

  // Attempt 1 tries to move `home-sofa` (in living room, outside region!) -> rejected!
  // Attempt 2 moves `kitchen-table-1` cleanly inside Kitchen -> accepted!
  let call = 0;
  const outcome = await runScopedRegionRedesign({
    house,
    regionSelection: kitchenRegion,
    userPrompt: "Make this kitchen corner less crowded.",
    maxAttempts: 2,
    patchGenerator: async () => {
      call += 1;
      if (call === 1) {
        return {
          id: "out-of-scope-attempt",
          reasoning: "Move living room sofa.",
          targetFindings: [],
          operations: [
            {
              type: "move",
              objectId: "home-sofa",
              position: [-2.0, 0, 2.0],
              rotation: [0, 0, 0],
            },
          ],
        };
      }
      return {
        id: "in-scope-kitchen-move",
        reasoning: "Shift breakfast table into clear northwest kitchen space.",
        targetFindings: [],
        operations: [
          {
            type: "move",
            objectId: "kitchen-table-1",
            position: [2.45, 0, 0.45],
            rotation: [0, 0, 0],
          },
        ],
      };
    },
  });

  assert.equal(call, 2);
  assert.equal(outcome.attempts[0].valid, false);
  assert.match(outcome.attempts[0].rejectedBecause[0], /outside the selected region/i);
  assert.equal(outcome.accepted, true);

  // Living-room sofa & locked kitchen fixtures are completely untouched
  const sofaBefore = house.objects.find((o) => o.id === "home-sofa");
  const sofaAfter = outcome.afterHouse.objects.find((o) => o.id === "home-sofa");
  assert.deepEqual(sofaAfter.position, sofaBefore.position);
  assert.deepEqual(outcome.afterHouse.fixtures, house.fixtures);
});

test("D8 — Wheelchair accessibility redesign clears movable furniture while honestly reporting immutable narrow doorway architecture", async () => {
  const { house: mercerHouse } = importSampleFloorplan();
  // Place a movable storage console blocking the bedroom's 1.50 m turning circle
  const clutteredMercer = structuredClone(mercerHouse);
  clutteredMercer.objects = [
    ownedCandidateToSceneObject(
      createOwnedFurnitureCandidate({
        id: "blocking-hamper",
        kind: "console",
        name: "Large Storage Trunk",
        dimensions: { width: 1.5, depth: 1.1, height: 0.75 },
      }),
      {
        id: "blocking-hamper",
        roomId: "bedroom",
        position: [3.2, 0, 7.6],
      },
    ),
  ];

  const wheelchairHousehold = [
    {
      id: "grandpa-arthur",
      name: "Grandpa Arthur",
      usesWheelchair: true,
      needs: { accessibility: 0.98, quiet: 0.8, privacy: 0.7, daylight: 0.7, social: 0.7 },
      schedule: [],
    },
  ];

  const bedroomRegion = createRegionSelection({ roomIds: ["bedroom"] }, clutteredMercer);
  const outcome = await runScopedRegionRedesign({
    house: clutteredMercer,
    regionSelection: bedroomRegion,
    userPrompt: "Make this route wheelchair accessible and clear turning space.",
    household: wheelchairHousehold,
    patchGenerator: async () => ({
      id: "clear-wheelchair-space",
      reasoning: "Move storage trunk against southwest wall to open bedroom turning circle.",
      targetFindings: [],
      operations: [
        {
          type: "move",
          objectId: "blocking-hamper",
          position: [1.1, 0, 8.6],
          rotation: [0, 0, 0],
        },
      ],
    }),
  });

  assert.equal(outcome.accepted, true);
  // Fixed Mercer bathroom doorway (0.76 m < 0.82 m) is NOT faked or widened; it is honestly reported in `architecturalLimits`
  assert.deepEqual(outcome.afterHouse.doors, clutteredMercer.doors);
  assert(
    outcome.architecturalLimits.some((lim) => lim.doorId === "door-bathroom"),
    "Expected honest architectural limit report for fixed 0.76 m bathroom doorway",
  );
});

test("D9 & D10 — Configurable crowd counts (4, 6, 8, 12, 16) and all believability scenarios & demoHooks remain green", () => {
  const house = createWholeHomeDemoHouse();
  const state = createWholeHomeDemoState();

  assert.deepEqual(SUPPORTED_FRIEND_COUNTS, [4, 6, 8, 12, 16]);

  for (const friendCount of SUPPORTED_FRIEND_COUNTS) {
    const run = runTwinScenario("friends-arrival", {
      house,
      items: house.objects,
      state,
      friendCount,
    });
    assert.equal(
      run.simulation.agents.length,
      4 + friendCount,
      `Expected 4 family + ${friendCount} friends`,
    );
    assert.equal(run.simulation.summary.pathFailures, 0);
    assert(
      run.checkpoints.some((c) => c.type === DEMO_CHECKPOINT_TYPES.FRIENDS_ARRIVE),
    );
  }

  // Verify Morning Routine & Grandparents Visit checkpoints remain intact (D10)
  const morning = runTwinScenario("morning-routine", {
    house,
    items: house.objects,
    state,
  });
  assert(
    morning.checkpoints.some((c) => c.type === DEMO_CHECKPOINT_TYPES.MORNING_START),
  );
  assert(
    morning.checkpoints.some(
      (c) => c.type === DEMO_CHECKPOINT_TYPES.BREAKFAST_CONGESTION,
    ),
  );

  const grandparents = runTwinScenario("grandparents-visit", {
    house,
    items: house.objects,
    state,
  });
  assert(
    grandparents.checkpoints.some(
      (c) => c.type === DEMO_CHECKPOINT_TYPES.GRANDPARENTS_ARRIVE,
    ),
  );
  assert(
    grandparents.checkpoints.some(
      (c) => c.type === DEMO_CHECKPOINT_TYPES.WHEELCHAIR_ACCESS_CHECK,
    ),
  );
});

test("an empty apartment receives sleeping, dining and seating before decorative pieces", () => {
  const { house } = importSampleFloorplan();
  const plan = buildDeterministicFurnishingPlan({
    house: { ...house, objects: [] },
    styleBrief: { budget: 4800 },
    hasWheelchairNeed: true,
  });
  const placements = plan.patch.operations.map(({ object }) => [object.roomId, object.kind]);
  for (const [room, kinds] of [
    ["bedroom", ["bed"]], ["kitchen", ["table"]], ["kitchen", ["chair"]], ["living-room", ["sofa", "chair"]],
  ]) {
    assert.ok(placements.some(([id, kind]) => id === room && kinds.includes(kind)), `Missing ${kinds} in ${room}`);
  }
  assert.ok(plan.spentUsd <= 4800);
});
