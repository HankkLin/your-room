import { expect, test } from "@playwright/test";
import { createSampleFloorplanCandidate } from "../src/spatial/sample-floorplan.js";

test("an empty whole home browses room-specific variants and recovers from an invalid style response", async ({ page }, testInfo) => {
  const plan = { ...createSampleFloorplanCandidate(), id: "empty-design-house" };
  const rooms = plan.rooms;
  await page.route("**/api/floorplan/analyze", route => route.fulfill({ json: plan }));
  const room = rooms[0].id;
  let malformed = false;
  const inputs = [];
  await page.route("**/api/furnishing/style-brief", route => {
    const input = route.request().postDataJSON();
    inputs.push(input);
    return route.fulfill({ json: { styleBrief: malformed ? {} : { styles: ["Japandi", "Scandinavian"],
      colors: ["warm white"], materials: ["oak"], priorities: ["family-friendly"],
      budget: { amount: input.budgetOverride ?? 12000, currency: "USD" },
      roomIntents: { [room]: [{ kind: "table", query: "warm oak coffee table" }] } } } });
  });
  const searches = [];
  await page.route("**/api/shopify/search", route => {
    searches.push(route.request().postDataJSON());
    return route.fulfill({ json: { products: [1, 2, 3].map(n => ({
      sellerDomain: "oak.myshopify.com", merchant: "Oak Studio", variantId: "gid://shopify/ProductVariant/" + n,
      productId: "oak-" + n, title: ["Round oak coffee table", "Oak nesting tables", "Premium table"][n - 1],
      variantTitle: "Warm oak", available: true, priceMinor: [24000, 34500, 69900][n - 1], currency: "USD",
      productUrl: "https://oak.myshopify.com/products/table-" + n + "?variant=" + n,
    })), warnings: [] } });
  });
  await page.goto("/");
  await page.locator("#floorplan-upload").setInputFiles("public/assets/sample-capture.jpg");
  await page.locator("#fp-confirm-import").click();
  await page.locator("#skip-household").click();
  const project = () => page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));
  const before = await project();
  expect(before.personas).toEqual([]);
  expect(before.items.filter(piece => piece.type !== "fixed" && !piece.locked)).toHaveLength(0);
  await page.getByLabel("Your vision").fill("Warm Japanese Scandinavian home for a family of four, oak furniture under $12,000.");
  await page.locator("#budget").fill("400");
  const panel = page.locator("#design-discovery");
  await panel.getByRole("combobox", { name: "Room", exact: true }).selectOption(room);
  await panel.getByRole("button", { name: "Find furniture for this brief" }).click();
  await expect(panel.locator("li.shopify-picker-card")).toHaveCount(2);
  await expect(panel).toContainText("Japandi");
  await expect(panel).toContainText("Delivery unknown");
  expect(inputs[0].rooms.map(item => item.id)).toContain(room);
  expect(searches[0]).toMatchObject({ maxPriceMinor: 40000 });
  expect(await project()).toEqual(before);
  await panel.screenshot({ path: testInfo.outputPath("style-shortlist.png") });
  malformed = true;
  await panel.getByRole("button", { name: "Find furniture for this brief" }).click();
  await expect(panel.getByRole("status")).toContainText("invalid");
  await panel.getByLabel("Search by item").fill("warm oak coffee table under $400");
  await panel.getByRole("button", { name: "Search products" }).click();
  await expect(panel.locator("li.shopify-picker-card")).toHaveCount(2);
  expect(searches.at(-1).maxPriceMinor).toBe(39999);
  expect(await project()).toEqual(before);
});
