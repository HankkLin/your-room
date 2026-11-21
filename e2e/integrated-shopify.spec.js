import { expect, test } from "@playwright/test";
import { productCandidateId } from "../src/contracts/product.js";

const chosen = { variantId: "gid://shopify/ProductVariant/80401", sellerDomain: "fixture-lamps.myshopify.com",
  productId: "gid://shopify/Product/904", title: "Oak reading lamp", variantTitle: "Natural",
  merchant: "Fixture Lamps", priceMinor: 12000, currency: "USD", available: true, deliveryEstimate: "3 days",
  dimensions: { width: 0.25, height: 0.8, depth: 0.25 }, dimensionsSource: "merchant" };
const alternative = { ...chosen, variantId: "gid://shopify/ProductVariant/80402", variantTitle: "Walnut", deliveryEstimate: null };
const ref = { variantId: chosen.variantId, sellerDomain: chosen.sellerDomain };
const handoff = "https://fixture-lamps.myshopify.com/checkouts/demo";
const project = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));

test("a household reviews two live alternatives, reapproves a changed offer, fixes its route and checks out the approved SKU", async ({ page }) => {
  let current = chosen;
  const checkouts = [];
  const proposals = [];
  await page.route("**/api/shopify/*", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1);
    const input = route.request().postDataJSON();
    if (endpoint === "search") return route.fulfill({ json: { products: [chosen, alternative], warnings: [] } });
    if (endpoint === "variant") {
      expect(input.ref).toMatchObject(ref);
      return route.fulfill({ json: { product: current, warnings: [] } });
    }
    if (endpoint === "lookup") return route.fulfill({ json: { products: [current], warnings: [] } });
    expect(endpoint).toBe("checkout");
    checkouts.push(input);
    return route.fulfill({ json: { continueUrl: handoff } });
  });
  await page.route("**/api/furnishing/propose", (route) => {
    proposals.push(route.request().postDataJSON());
    return route.fulfill({ json: { operations: [{ type: "add", candidateId: productCandidateId(chosen),
      roomId: "living-room", personaId: "replay-demo-alex", need: "quiet", reason: "A quiet reading corner for Alex." }] } });
  });
  await page.route("**/api/replay/suggest-fix", (route) => route.fulfill({ json: {
    explanation: "Move the doorway sofa into the bedroom.", scenePatch: { operations: [
      { type: "move", objectId: "replay-demo-sofa", position: [3.4, 0, 7] },
    ] },
  } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Try blocked-route replay demo", exact: true }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  const before = await project(page);
  await page.locator("#furnishing-shopify").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search Shopify").fill("reading lamp");
  await dialog.getByLabel("Preview type").selectOption("lamp");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".shopify-picker-card")).toHaveCount(2);
  await expect(dialog.getByText(/Delivery unknown/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect((await project(page)).items).toEqual(before.items);

  const propose = page.locator("[data-propose]");
  const approve = page.locator("[data-approve]");
  await propose.click();
  await expect(page.locator("[data-preview]")).toContainText("Alex · quiet");
  expect(proposals[0].candidates.filter((c) => c.source === "Shopify").map((c) => c.id)).toEqual([chosen, alternative].map(productCandidateId));
  expect((await project(page)).savedProducts).toEqual(before.savedProducts);
  current = { ...chosen, priceMinor: 14200 };
  await approve.click();
  await expect(page.locator("#household-furnishing [role=status]")).toContainText("merchant changed");
  expect((await project(page)).items).toEqual(before.items);
  await propose.click();
  await expect(page.locator("[data-preview]")).toContainText("$142.00");
  await approve.click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  const applied = await project(page);
  expect(applied.items.filter((item) => item.shopify)).toMatchObject([{ shopify: ref, productId: chosen.productId,
    width: chosen.dimensions.width, height: chosen.dimensions.height, depth: chosen.dimensions.depth }]);
  expect(applied.savedProducts.filter((row) => row.shopify)).toMatchObject([{ shopify: ref, savedPrice: { priceMinor: 14200, currency: "USD" } }]);

  const replay = page.locator("#studio-replay-panel");
  const failures = replay.getByRole("rowheader", { name: "Path failures", exact: true }).locator("..").locator("td");
  await replay.getByRole("button", { name: "Capture baseline", exact: true }).click();
  await expect(failures).toHaveText(["1"]);
  await replay.getByRole("button", { name: "Suggest a fix", exact: true }).click();
  const move = replay.getByRole("button", { name: "Approve move", exact: true });
  await expect(move).toBeVisible();
  expect((await project(page)).items).toEqual(applied.items);
  await move.click();
  await expect(failures).toHaveText(["1", "0"]);
  await page.locator("#continue-stress").click();
  await page.locator("#tray-review-products").click();
  await page.getByRole("button", { name: "Start checkout", exact: true }).click();
  await expect(page.getByRole("link", { name: "Continue to Shopify checkout" })).toHaveAttribute("href", handoff);
  expect(checkouts).toEqual([{ lines: [{ ref, quantity: 1, priceMinor: 14200, currency: "USD" }] }]);
});
