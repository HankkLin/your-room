import { expect, test } from "@playwright/test";

const ref = {
  variantId: "gid://shopify/ProductVariant/12345",
  sellerDomain: "fixture-shop.myshopify.com",
};
const lamp = {
  ...ref,
  title: "Linen Arc Floor Lamp",
  variantTitle: "Natural linen",
  merchant: "Fixture Lighting",
  priceMinor: 18900,
  currency: "USD",
  available: true,
  imageUrl: null,
  productUrl: "https://fixture-shop.myshopify.com/products/linen-arc-lamp?variant=12345",
};
const checkoutUrl = "https://fixture-shop.myshopify.com/checkouts/example";
const project = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));

async function mockShopify(page, handlers = {}) {
  const calls = [];
  const replies = {
    search: () => ({ json: { products: [lamp], warnings: [] } }),
    variant: () => ({ json: { product: lamp, warnings: [] } }),
    lookup: () => ({ json: { products: [lamp], warnings: [] } }),
    checkout: () => ({
      json: {
        continueUrl: checkoutUrl,
        totals: [{ label: "Total", amountMinor: 18900 }],
        links: [],
        warnings: [],
        currency: "USD",
      },
    }),
    ...handlers,
  };
  await page.route("**/api/shopify/*", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.split("/").at(-1);
    expect(request.method()).toBe("POST");
    expect(replies).toHaveProperty(endpoint);
    const body = request.postDataJSON();
    calls.push({ endpoint, body });
    await route.fulfill(replies[endpoint](body));
  });
  return calls;
}

async function loadDemo(page) {
  await page.goto("/");
  await page.locator("#explore-demo").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  const existingLamp = (await project(page)).items.find(({ kind }) => kind === "lamp");
  await page.locator(`[data-item="${existingLamp.id}"]`).click();
  return existingLamp;
}

async function searchForProduct(
  page,
  { query = "linen floor lamp", kind = "lamp", title = lamp.title } = {},
) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Shopify", exact: true }).click();
  await dialog.getByLabel("Search Shopify").fill(query);
  await dialog.getByLabel("Preview type").selectOption(kind);
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  return dialog;
}

async function addLampAndSaveRoom(page) {
  await loadDemo(page);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Add furniture" }).click();
  const dialog = await searchForProduct(page);
  await dialog.getByRole("button", { name: "Add to room" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#inventory")).toContainText(lamp.title);
  await page.getByRole("button", { name: "Save room & review products" }).click();
  const card = page.locator(".shop-card").filter({ hasText: lamp.title });
  await expect(card).toBeVisible();
  return card;
}

test("a live Shopify pick survives reload and opens a checkout link for its variant", async ({
  page,
}) => {
  const calls = await mockShopify(page);
  const card = await addLampAndSaveRoom(page);
  expect(calls).toContainEqual({
    endpoint: "search",
    body: { query: "linen floor lamp" },
  });
  expect(calls).toContainEqual({ endpoint: "variant", body: { ref } });

  await page.reload();
  await expect(card).toBeVisible();
  await expect(card).toContainText(lamp.variantTitle);
  const saved = await project(page);
  expect(saved.items).toContainEqual(expect.objectContaining({ shopify: ref }));
  expect(saved.savedProducts).toContainEqual(expect.objectContaining({ shopify: ref }));
  expect(calls).toContainEqual({ endpoint: "lookup", body: { refs: [ref] } });

  await page.getByRole("region", { name: ref.sellerDomain }).getByRole("button", { name: "Start checkout" }).click();
  await expect(page.getByRole("link", { name: "Continue to Shopify checkout" }))
    .toHaveAttribute("href", checkoutUrl);
  expect(calls).toContainEqual({ endpoint: "checkout", body: { lines: [lineFor(lamp)] } });
});

test("a live Shopify swap preserves the whole-home room and locked fixtures", async ({ page }) => {
  await mockShopify(page);
  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  const fixture = page.locator('[data-item="fixture-bathroom-toilet"]');
  await fixture.click();
  await expect(page.locator("#objectbar").getByRole("button", { name: "Swap" })).toHaveCount(0);
  const originalFixture = (await project(page)).items.find(({ id }) => id === "fixture-bathroom-toilet");
  await page.locator('[data-item="home-lamp"]').click();
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  const dialog = await searchForProduct(page);
  await dialog.getByRole("button", { name: "Swap piece" }).click();
  await expect(dialog).toBeHidden();

  const updated = await project(page);
  expect(updated.items).toContainEqual(originalFixture);
  expect(updated.items.some(({ id }) => id === "home-lamp")).toBe(false);
  expect(updated.house.objects).toContainEqual(expect.objectContaining({
    shopify: ref,
    roomId: "living-room",
    dimensionsSource: "estimated",
  }));

  await page.getByRole("button", { name: "Save piece", exact: true }).click();
  await page.locator("#shop").click();
  await page.reload();
  await expect(page.locator(".shop-card").filter({ hasText: lamp.title })).toBeVisible();
});

test("an unconfirmed Shopify checkout retains the merchant product link", async ({ page }) => {
  const error = "Shopify could not confirm a checkout link. Visit the merchant to continue.";
  const calls = await mockShopify(page, {
    checkout: () => ({ status: 502, json: { error, uncertain: true } }),
  });
  const card = await addLampAndSaveRoom(page);
  const merchantLink = card.getByRole("link", { name: `View product at ${lamp.merchant}` });
  const group = page.getByRole("region", { name: ref.sellerDomain });
  const startCheckout = group.getByRole("button", { name: "Start checkout" });

  await expect(merchantLink).toHaveAttribute("href", lamp.productUrl);
  await startCheckout.click();
  await expect(group.getByText(error)).toBeVisible();
  await expect(merchantLink).toBeVisible();
  await expect(merchantLink).toHaveAttribute("href", lamp.productUrl);
  await expect(startCheckout).toBeDisabled();
  await expect(group.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveCount(0);
  expect(calls.filter(({ endpoint }) => endpoint === "checkout")).toEqual([
    { endpoint: "checkout", body: { lines: [lineFor(lamp)] } },
  ]);
});

test("an unavailable Shopify variant cannot replace the selected room piece", async ({
  page,
}) => {
  await mockShopify(page, {
    variant: () => ({ json: { product: { ...lamp, available: false }, warnings: [] } }),
  });
  const existingLamp = await loadDemo(page);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  const before = await project(page);
  const dialog = await searchForProduct(page);
  await dialog.getByRole("button", { name: "Swap piece" }).click();
  await expect(dialog).toContainText(/unavailable|no longer available|out of stock|sold out/i);
  expect((await project(page)).items).toEqual(before.items);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator("#objectbar")).toContainText(existingLamp.name);
});

test("a Shopify swap that has no clear placement preserves the layout", async ({ page }) => {
  const sofa = {
    ...lamp,
    title: "Linen Sectional Sofa",
    variantTitle: "Sand",
    productUrl: "https://fixture-shop.myshopify.com/products/linen-sectional?variant=12345",
  };
  await mockShopify(page, {
    search: () => ({ json: { products: [sofa], warnings: [] } }),
    variant: () => ({ json: { product: sofa, warnings: [] } }),
  });

  await page.goto("/");
  await page.locator("#custom-room").click();
  await page.locator("#room-shape").selectOption("alcove");
  await page.locator("#room-width").fill("3");
  await page.locator("#room-depth").fill("3");
  await page.locator("#setup-next").click();
  await page.locator("#owned-kind").selectOption("bed");
  await page.locator("#add-owned").click();
  await page.locator("#setup-next").click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.locator("#budget").fill("0");
  await page.locator("#generate").click();
  await page.getByRole("button", { name: "Add furniture" }).click();
  await page.locator('[data-product="brass-lamp"]').click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const before = await project(page);
  expect(before.items.map(({ kind }) => kind)).toEqual(["bed", "lamp"]);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  const dialog = await searchForProduct(page, {
    query: "linen sectional sofa",
    kind: "sofa",
    title: sofa.title,
  });
  await dialog.getByRole("button", { name: "Swap piece" }).click();
  await expect(dialog).toContainText(/needs more clear space/i);
  expect((await project(page)).items).toEqual(before.items);
});

test("a Shopify pick that becomes unavailable stays visible and removable", async ({ page }) => {
  let available = true;
  await mockShopify(page, {
    lookup: () => ({ json: { products: [{ ...lamp, available }], warnings: [] } }),
  });
  const card = await addLampAndSaveRoom(page);
  available = false;
  await page.reload();
  await expect(card).toContainText(/unavailable|out of stock|sold out/i);
  const checkout = page.getByRole("region", { name: ref.sellerDomain }).getByRole("button", { name: "Start checkout" });
  await expect
    .poll(async () => (await checkout.count()) === 0 || !(await checkout.isEnabled()))
    .toBe(true);
  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
});

function lineFor(product, quantity = 1) {
  const { variantId, sellerDomain, priceMinor, currency } = product;
  return { ref: { variantId, sellerDomain }, quantity, priceMinor, currency };
}

const shade = { ...lamp, title: "Woven shade", variantId: "gid://shopify/ProductVariant/222" };
const rug = { ...lamp, title: "Wool rug", sellerDomain: "rug-shop.example", merchant: "Rug Shop" };
const rugCheckout = "https://rug-shop.example/checkouts/rug";
const products = [lamp, shade, rug];

async function openSavedMerchants(page, handlers = {}) {
  const calls = await mockShopify(page, {
    lookup: ({ refs }) => ({
      json: { products: products.filter(p => refs.some(r => r.sellerDomain === p.sellerDomain && r.variantId === p.variantId)) },
    }),
    checkout: ({ lines }) => ({
      json: { continueUrl: lines[0].ref.sellerDomain === rug.sellerDomain ? rugCheckout : checkoutUrl },
    }),
    ...handlers,
  });
  await loadDemo(page);
  await page.locator("#shop").click();
  // Existing projects may have several placed rows with the same variant and no saved price.
  const rows = [lamp, lamp, shade, rug].map((p, i) => ({
    id: `saved-${i}`, name: p.title, shopify: lineFor(p).ref, url: "https://unrelated.example/old-saved-product",
  }));
  await page.evaluate(rows => {
    const key = "living-blueprint.project.v1";
    const saved = JSON.parse(localStorage.getItem(key));
    saved.savedProducts = rows;
    localStorage.setItem(key, JSON.stringify(saved));
  }, rows);
  await page.reload();
  return {
    calls,
    a: page.getByRole("region", { name: ref.sellerDomain }),
    b: page.getByRole("region", { name: rug.sellerDomain }),
    all: page.getByRole("button", { name: "Prepare all merchant checkouts" }),
  };
}

test("whole-home checkout groups duplicate placements and keeps separate merchant links", async ({ page }) => {
  const { calls, a, b, all } = await openSavedMerchants(page);
  await all.click();
  await expect(a.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", checkoutUrl);
  await expect(b.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", rugCheckout);
  expect(calls.filter(c => c.endpoint === "checkout").map(c => c.body)).toEqual(expect.arrayContaining([
    { lines: [lineFor(lamp, 2), lineFor(shade)] }, { lines: [lineFor(rug)] },
  ]));
  expect(calls.filter(c => c.endpoint === "checkout")).toHaveLength(2);
  await expect(page.locator("#saved-total")).toContainText("$756");
  await a.getByLabel(`Include ${lamp.title} in checkout`).first().uncheck();
  await expect(page.locator("#saved-total")).toContainText("$567");
  await expect(a.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveCount(0);
  await expect(b.getByRole("link", { name: "Continue to Shopify checkout" })).toBeVisible();
  await a.getByRole("button", { name: "Start checkout" }).click();
  await expect(a.getByRole("link", { name: "Continue to Shopify checkout" })).toBeVisible();
  expect(calls.filter(c => c.endpoint === "checkout").at(-1).body.lines).toEqual([lineFor(lamp), lineFor(shade)]);
});

test("whole-home review saves room context and checks out exact quantities per merchant", async ({ page }, testInfo) => {
  const ikea = process.env.PLAYWRIGHT_PLANNER === "ikea";
  const revised = { ...lamp, priceMinor: 19900 };
  const calls = await mockShopify(page, {
    lookup: ({ refs }) => ({ json: { products: products.filter(p => refs.some(r =>
      r.sellerDomain === p.sellerDomain && r.variantId === p.variantId)) } }),
    checkout: ({ lines }) => {
      if (lines[0].ref.sellerDomain === rug.sellerDomain) return { json: { continueUrl: rugCheckout } };
      if (lines.some(line => line.ref.variantId === ref.variantId && line.priceMinor === lamp.priceMinor)) {
        return { status: 409, json: { error: "The lamp price changed.", products: [revised, shade] } };
      }
      return { json: { continueUrl: checkoutUrl } };
    },
  });
  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  const placements = [
    ["home-lamp", lamp], ["home-desk", lamp], ["home-coffee-table", shade], ["home-rug", rug],
  ].map(([id, product]) => ({ id, name: product.title, shopify: lineFor(product).ref }));
  const reason = "Light the reading chair in the living room.";
  await page.evaluate(({ placements, reason }) => {
    const key = "living-blueprint.project.v1";
    const saved = JSON.parse(localStorage.getItem(key));
    saved.items = saved.items.flatMap(item => {
      const placement = placements.find(row => row.id === item.id);
      if (!placement) return item.owned || item.locked ? [item] : [];
      return [{ ...item, ...placement, type: "shopify", suggestedReason: item.id === "home-lamp" ? reason : undefined }];
    });
    saved.savedProducts = [{ ...placements[0], quantity: 2, savedPrice: { priceMinor: 18900, currency: "USD" } }];
    localStorage.setItem(key, JSON.stringify(saved));
  }, { placements, reason });
  await page.reload();
  const a = page.getByRole("region", { name: ref.sellerDomain });
  const b = page.getByRole("region", { name: rug.sellerDomain });
  const handoff = { name: "Continue to Shopify checkout" };
  const checkoutCalls = () => calls.filter(call => call.endpoint === "checkout");
  const reviewEntries = ikea ? ["#tray-review-products", '[data-journey-action="shop"]'] : ["#save-room", "#save-room"];
  for (const [index, entry] of reviewEntries.entries()) {
    await page.locator(entry).click();
    await expect(a.getByRole("button", { name: "Start checkout" })).toBeEnabled();
    await expect(page.locator(".shop-card")).toHaveCount(4);
    const card = page.locator(".shop-card").filter({ has: page.locator('[data-include="home-lamp"]') });
    await expect(card.getByText("Living Room", { exact: true })).toHaveCount(1);
    await expect(card.getByText(reason, { exact: true })).toHaveCount(1);
    const rows = (await project(page)).savedProducts;
    expect(rows.map(row => row.id).sort()).toEqual(placements.map(row => row.id).sort());
    expect(rows.find(row => row.id === "home-lamp")).toMatchObject({ quantity: 2, shopify: ref,
      savedPrice: { priceMinor: 18900, currency: "USD" }, roomLabel: "Living Room", suggestedReason: reason });
    expect(rows.find(row => row.id === "home-desk").roomLabel).toBe("Bedroom");
    expect(checkoutCalls()).toHaveLength(0);
    if (index === 0) {
      // Reopen the saved project, then use its other review entry on the next pass.
      await page.reload();
      await page.locator("#back-to-tour").click();
    }
  }
  await page.getByRole("button", { name: "Prepare all merchant checkouts" }).click();
  await expect(b.getByRole("link", handoff)).toHaveAttribute("href", rugCheckout);
  await expect(a.getByText("The lamp price changed.")).toBeVisible();
  await expect(a.getByRole("link", handoff)).toHaveCount(0);
  expect(checkoutCalls()).toHaveLength(2);
  const firstLines = checkoutCalls().map(call => call.body.lines);
  expect(firstLines).toContainEqual([lineFor(rug)]);
  const lightingLines = firstLines.find(lines => lines[0].ref.sellerDomain === ref.sellerDomain);
  expect(lightingLines).toHaveLength(2);
  expect(lightingLines).toEqual(expect.arrayContaining([lineFor(lamp, 3), lineFor(shade)]));
  await a.getByRole("button", { name: "Start checkout" }).click();
  await expect(a.getByRole("link", handoff)).toHaveAttribute("href", checkoutUrl);
  await expect(b.getByRole("link", handoff)).toHaveAttribute("href", rugCheckout);
  expect(checkoutCalls()).toHaveLength(3);
  expect(checkoutCalls()[2].body.lines).toEqual(expect.arrayContaining([lineFor(revised, 3), lineFor(shade)]));
  if (ikea) await page.locator("#shop-page").screenshot({ path: testInfo.outputPath("step-7-merchant-groups.png") });
});

test("a price change requires another click and leaves the other merchant handoff available", async ({ page }) => {
  const newLamp = { ...lamp, priceMinor: 19900 };
  const { calls, a, b, all } = await openSavedMerchants(page, {
    checkout: ({ lines }) => {
      if (lines[0].ref.sellerDomain === rug.sellerDomain) return { json: { continueUrl: rugCheckout } };
      if (lines[0].priceMinor === lamp.priceMinor) {
        return { status: 409, json: { error: "The price of Linen Arc Floor Lamp changed.", products: [newLamp, shade] } };
      }
      return { json: { continueUrl: checkoutUrl } };
    },
  });
  await all.click();
  await expect(a.getByText(/price of .* changed/)).toBeVisible();
  await expect(a.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveCount(0);
  await expect(b.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", rugCheckout);
  await expect(a.getByText("$199.00", { exact: true }).first()).toBeVisible();
  await a.getByRole("button", { name: "Start checkout" }).click();
  await expect(a.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", checkoutUrl);
  expect(calls.filter(c => c.endpoint === "checkout").at(-1).body.lines).toEqual([lineFor(newLamp, 2), lineFor(shade)]);
});

test("whole-home review keeps legacy quantities and shows a partial subtotal for unpriced pieces", async ({ page }) => {
  const calls = await mockShopify(page);
  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await page.evaluate(({ ref, lampName }) => {
    const key = "living-blueprint.project.v1";
    const saved = JSON.parse(localStorage.getItem(key));
    const archive = { id: "home-chair", productId: "old-chair", merchant: "Archived store", url: "https://archive.example/products/chair" };
    saved.items = saved.items.flatMap(item => {
      if (item.id === archive.id) return [{ ...item, ...archive, variant: undefined, variantId: undefined, price: null, shopify: undefined }];
      if (item.id === "home-desk") return [{ ...item, name: "Legacy desk", productId: null, shopify: { sellerDomain: "incomplete.example" },
        price: null, variantId: null, url: null, merchant: "Retired store" }];
      if (item.id === "home-lamp") return [{ ...item, name: lampName, shopify: ref }];
      return [];
    });
    saved.savedProducts = [{ ...archive, quantity: 2, price: 40 }];
    localStorage.setItem(key, JSON.stringify(saved));
  }, { ref, lampName: lamp.title });
  await page.reload();
  await page.locator("#save-room").click();
  await expect(page.locator(".shop-card")).toHaveCount(3);
  await expect(page.locator("#saved-total")).toHaveText("Partial estimated subtotal · $269");
  expect((await project(page)).savedProducts.find(row => row.id === "home-chair")).toMatchObject({ quantity: 2, price: 40 });
  await page.getByRole("region", { name: ref.sellerDomain }).getByRole("button", { name: "Start checkout" }).click();
  await expect(page.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", checkoutUrl);
  expect(calls.filter(call => call.endpoint === "checkout").map(call => call.body)).toEqual([{ lines: [lineFor(lamp)] }]);
});

test("re-saving the same placement keeps the original unit quote and saved quantity", async ({ page }) => {
  let livePrice = lamp.priceMinor;
  const calls = await mockShopify(page, {
    lookup: () => ({ json: { products: [{ ...lamp, priceMinor: livePrice }] } }),
  });
  const card = await addLampAndSaveRoom(page);
  const firstSave = (await project(page)).savedProducts.find(row => row.shopify?.variantId === ref.variantId && row.shopify.sellerDomain === ref.sellerDomain);
  expect(firstSave.savedPrice).toEqual({ priceMinor: lamp.priceMinor, currency: lamp.currency });
  await page.evaluate(id => {
    const key = "living-blueprint.project.v1";
    const saved = JSON.parse(localStorage.getItem(key));
    saved.savedProducts.find(row => row.id === id).quantity = 3;
    localStorage.setItem("stillroom.project.v1", JSON.stringify(saved));
    localStorage.removeItem(key);
  }, firstSave.id);
  livePrice = 19900;
  await page.reload();
  await expect(card).toContainText("Price changed since saving");
  await page.locator("#back-to-tour").click();
  await page.locator("#save-room").click();
  const again = (await project(page)).savedProducts.find(row => row.id === firstSave.id);
  expect(again.savedPrice).toEqual(firstSave.savedPrice);
  expect(again.quantity).toBe(3);
  await page.getByRole("region", { name: ref.sellerDomain }).getByRole("button", { name: "Start checkout" }).click();
  expect(calls.filter(c => c.endpoint === "checkout").at(-1).body.lines)
    .toEqual([lineFor({ ...lamp, priceMinor: livePrice }, 3)]);
});

test("an included variant without a price blocks its merchant until deselected", async ({ page }) => {
  const { a } = await openSavedMerchants(page, {
    lookup: ({ refs }) => ({
      json: { products: refs[0].sellerDomain === ref.sellerDomain ? [lamp, { ...shade, priceMinor: null }] : [rug] },
    }),
  });
  await expect(a.getByText("Price unconfirmed")).toBeVisible();
  await expect(page.locator("#saved-total")).toContainText("Partial");
  await expect(a.getByRole("button", { name: "Start checkout" })).toBeDisabled();
  await a.getByLabel(`Include ${shade.title} in checkout`).uncheck();
  await expect(a.getByRole("button", { name: "Start checkout" })).toBeEnabled();
  await expect(page.locator("#saved-total")).not.toContainText("Partial");
  await expect(page.locator("#saved-total")).toContainText("$567");
});

test("a merchant lookup outage on reload leaves the other merchant ready", async ({ page }) => {
  const { a, b, all, calls } = await openSavedMerchants(page, {
    lookup: ({ refs }) => refs[0].sellerDomain === ref.sellerDomain
      ? { status: 502, json: { error: "Catalog temporarily unavailable." } }
      : { json: { products: [rug] } },
  });
  await expect(page.getByText(/Catalog temporarily unavailable/)).toBeVisible();
  await expect(a.locator("a[href*='unrelated.example']")).toHaveCount(0);
  await expect(a.getByRole("button", { name: "Start checkout" })).toBeDisabled();
  await all.click();
  await expect(b.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", rugCheckout);
  expect(calls.filter(c => c.endpoint === "checkout").map(c => c.body)).toEqual([{ lines: [lineFor(rug)] }]);
});

// Observe Three's real scene graph through its existing devtools hook.
async function observeFurniture(page) {
  await page.addInitScript(() => {
    globalThis.__THREE_DEVTOOLS__ = new EventTarget();
    globalThis.__THREE_DEVTOOLS__.addEventListener("observe", ({ detail }) => {
      if (detail.isScene && !globalThis.studioTestScene) globalThis.studioTestScene = detail;
    });
  });
}

async function renderedFurniture(page, id) {
  return page.evaluate((id) => {
    let furniture;
    globalThis.studioTestScene?.traverse((node) => {
      if (node.userData.itemId === id) furniture = node;
    });
    if (!furniture) return null;
    furniture.updateWorldMatrix(true, true);
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const materials = [];
    furniture.traverse((mesh) => {
      if (!mesh.isMesh) return;
      materials.push(...[mesh.material].flat().map((material) => material.name));
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      for (const [i, axis] of ["x", "y", "z"].entries()) {
        bounds[i] = Math.min(bounds[i], box.min[axis]);
        bounds[i + 3] = Math.max(bounds[i + 3], box.max[axis]);
      }
    });
    return { modelUrl: furniture.userData.modelUrl ?? null, bounds, materials };
  }, id);
}

test("merchant geometry loads at scene scale, survives reload and falls back after a failed load", async ({ page }) => {
  await observeFurniture(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const modelUrl = "https://cdn.shopify.com/3d/models/fixture.glb";
  const piece = { ...lamp, modelUrl, modelScope: "variant", dimensionsSource: "merchant",
    dimensions: { width: 0.42, height: 0.85, depth: 0.40 } };
  const calls = await mockShopify(page, {
    search: () => ({ json: { products: [piece], warnings: [] } }),
    variant: () => ({ json: { product: piece, warnings: [] } }),
    lookup: () => ({ json: { products: [piece], warnings: [] } }),
  });
  await page.route(modelUrl, (route) => route.fulfill({
    path: "public/assets/SheenChair.glb", contentType: "model/gltf-binary", headers: { "Access-Control-Allow-Origin": "*" },
  }));
  await loadDemo(page);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  const dialog = await searchForProduct(page);
  await dialog.getByRole("button", { name: "Swap piece" }).click();
  await expect(dialog).toBeHidden();
  const item = (await project(page)).items.find((item) => item.shopify);
  expect(item).toMatchObject({ shopify: ref, modelUrl, width: 0.42, height: 0.85, depth: 0.40 });
  await expect(page.locator("#inventory")).toContainText("Merchant dimensions");
  const checkMesh = async () => {
    await expect.poll(async () => (await renderedFurniture(page, item.id))?.modelUrl).toBe(modelUrl);
    const { bounds, materials } = await renderedFurniture(page, item.id);
    expect(materials.length).toBeGreaterThan(0);
    expect(bounds[1]).toBeCloseTo(0, 2);
    for (const [i, axis] of ["width", "height", "depth"].entries()) {
      expect(bounds[i + 3] - bounds[i]).toBeGreaterThan(0.01);
      expect(bounds[i + 3] - bounds[i]).toBeLessThanOrEqual(item[axis] + 0.02);
    }
  };
  await checkMesh();
  await page.reload();
  await checkMesh();
  expect((await project(page)).items.find((i) => i.id === item.id)).toEqual(item);
  expect(calls).toContainEqual({ endpoint: "variant", body: { ref } });

  await page.unroute(modelUrl);
  await page.route(modelUrl, (route) => route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" } }));
  const failed = page.waitForResponse((reply) => reply.url() === modelUrl && reply.status() === 404);
  await page.reload();
  await failed;
  await expect.poll(async () => (await renderedFurniture(page, item.id))?.materials.length).toBeGreaterThan(0);
  expect((await renderedFurniture(page, item.id)).modelUrl).toBeNull();
  await page.locator(`[data-item="${item.id}"]`).click();
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  expect((await project(page)).items.find((i) => i.id === item.id).rotation).toBe((item.rotation + 90) % 360);
  expect(errors).toEqual([]);
});

test("a previously saved catalog layout offers Shopify checkout separately from product details", async ({ page }) => {
  const sellerDomain = "sundays-company-production.myshopify.com";
  const variantId = "gid://shopify/ProductVariant/41588406419527";
  const shopify = { sellerDomain, variantId };
  const product = { ...shopify, title: "Form Coffee Table", merchant: "Sundays", variantTitle: "American Walnut",
    storefrontUrl: "https://www.sundays-company.com",
    productUrl: "https://www.sundays-company.com/products/form-coffee-table-walnut?variant=41588406419527",
    available: true, currency: "USD", priceMinor: 67500 };
  const continueUrl = "https://shop.app/checkouts/review-fixture";
  const calls = await mockShopify(page, {
    lookup: () => ({ json: { products: [product] } }),
    checkout: () => ({ json: { continueUrl } }),
  });
  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await page.locator("#shop").click();
  await page.evaluate(() => {
    const key = "living-blueprint.project.v1";
    const state = JSON.parse(localStorage.getItem(key));
    state.savedProducts = [{ id: "saved-table", productId: "walnut-table", quantity: 2 }];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  const group = page.getByRole("region", { name: sellerDomain, exact: true });
  await expect(group.getByRole("link", { name: "View product at Sundays" })).toHaveAttribute("href", product.productUrl);
  await group.getByRole("button", { name: "Start checkout" }).click();
  await expect(group.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", continueUrl);
  expect(calls.filter(call => call.endpoint === "checkout").map(call => call.body)).toEqual([
    { lines: [{ ref: shopify, quantity: 2, priceMinor: 67500, currency: "USD" }] },
  ]);
});
