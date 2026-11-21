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

  await card.getByRole("button", { name: "Start checkout" }).click();
  await expect(page.getByRole("link", { name: "Continue to checkout" }))
    .toHaveAttribute("href", checkoutUrl);
  expect(calls).toContainEqual({ endpoint: "checkout", body: { ref } });
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
  const merchantLink = card.getByRole("link", { name: `Shop at ${lamp.merchant}` });
  const startCheckout = card.getByRole("button", { name: "Start checkout" });

  await expect(merchantLink).toHaveAttribute("href", lamp.productUrl);
  await startCheckout.click();
  await expect(card.getByText(error)).toBeVisible();
  await expect(merchantLink).toBeVisible();
  await expect(merchantLink).toHaveAttribute("href", lamp.productUrl);
  await expect(startCheckout).toBeDisabled();
  await expect(card.getByRole("link", { name: "Continue to checkout" })).toHaveCount(0);
  expect(calls.filter(({ endpoint }) => endpoint === "checkout")).toEqual([
    { endpoint: "checkout", body: { ref } },
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
  const checkout = card.getByRole("button", { name: "Start checkout" });
  await expect
    .poll(async () => (await checkout.count()) === 0 || !(await checkout.isEnabled()))
    .toBe(true);
  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
});
