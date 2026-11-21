import { expect, test } from "@playwright/test";
import { productCandidateId } from "../src/contracts/product.js";

const lamp = {
  variantId: "gid://shopify/ProductVariant/131", sellerDomain: "shore.myshopify.com",
  title: "Reading Lamp", variantTitle: "Brass", priceMinor: 12000, currency: "USD", available: true,
  merchant: "Shore", dimensions: null, dimensionsSource: null, deliveryEstimate: null,
};
const other = { ...lamp, variantId: "gid://shopify/ProductVariant/132", variantTitle: "Walnut",
  dimensions: { width: 0.25, height: 1, depth: 0.25 }, dimensionsSource: "merchant", deliveryEstimate: "3 days" };
const ref = { variantId: other.variantId, sellerDomain: other.sellerDomain };
const readProject = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));

async function setup(page, options = {}) {
  const seen = [];
  await page.route("**/api/shopify/*", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1);
    const input = route.request().postDataJSON();
    seen.push([endpoint, input]);
    let body;
    if (endpoint === "search" || endpoint === "lookup") body = { products: [lamp, other], warnings: [] };
    if (endpoint === "variant") body = { product: { ...other, ...(options.refresh || {}) }, warnings: [] };
    if (endpoint === "recommend") {
      if (options.fail) return route.fulfill({ status: 502, json: { error: "Gemini is unavailable." } });
      body = { products: [lamp, other], warnings: [], scenePatch: { operations: [{
        type: input.mode, ...(input.objectId ? { objectId: input.objectId } : {}), productId: productCandidateId(other),
      }] } };
    }
    expect(body).toBeDefined();
    return route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await page.locator("#tour-step").click();
  return seen;
}
async function search(page, mode) {
  if (mode === "replace") {
    await page.locator('[data-item="home-lamp"]').click();
    await page.getByRole("button", { name: "Swap", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Add furniture" }).click();
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Shopify", exact: true }).click();
  await dialog.getByLabel("Search Shopify").fill("walnut lamp");
  await dialog.getByLabel("Preview type").selectOption("lamp");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".shopify-picker-card")).toHaveCount(2);
  await expect(dialog.getByText(/Delivery unknown/)).toBeVisible();
  await expect(dialog.getByText(/Delivery 3 days/)).toBeVisible();
  return dialog;
}

for (const mode of ["replace", "add"]) {
  test("Gemini previews a live " + mode + " and approval saves only the chosen variant", async ({ page }) => {
    const seen = await setup(page);
    const before = await readProject(page);
    const dialog = await search(page, mode);
    await dialog.getByRole("button", { name: "Ask Gemini to choose" }).click();
    const approve = dialog.getByRole("button", { name: mode === "replace" ? "Approve replacement" : "Approve addition" });
    await expect(approve).toBeVisible();
    expect(seen.find(([op]) => op === "recommend")[1]).toMatchObject({ mode, kind: "lamp", instruction: "walnut lamp",
      ...(mode === "replace" ? { objectId: "home-lamp" } : {}), refs: [{ variantId: lamp.variantId, sellerDomain: lamp.sellerDomain }, ref] });
    expect((await readProject(page)).items).toEqual(before.items);
    expect((await readProject(page)).savedProducts).toEqual(before.savedProducts);
    await approve.click();
    await expect(dialog).toBeHidden();
    const after = await readProject(page);
    expect(after.savedProducts.filter((row) => row.shopify)).toHaveLength(1);
    expect(after.savedProducts).toContainEqual(expect.objectContaining({ shopify: ref }));
    expect(after.house.objects).toContainEqual(expect.objectContaining({ shopify: ref, dimensions: other.dimensions, dimensionsSource: "merchant" }));
    expect(after.items.some((item) => item.shopify?.variantId === lamp.variantId)).toBe(false);
    if (mode === "replace") expect(after.items.some((item) => item.id === "home-lamp")).toBe(false);
    await page.getByRole("button", { name: "Add furniture" }).click();
    await dialog.getByRole("button", { name: "Shopify", exact: true }).click();
    await expect(dialog.locator(".shopify-picker-card")).toHaveCount(2);
    expect(seen.filter(([op]) => op === "search")).toHaveLength(1);
    await page.reload();
    expect((await readProject(page)).savedProducts).toEqual(after.savedProducts);
  });
}
test("changed merchant dimensions remain a preview until the updated size is approved", async ({ page }) => {
  const dimensions = { width: 0.42, height: 1.1, depth: 0.38 };
  await setup(page, { refresh: { dimensions } });
  const before = await readProject(page);
  const dialog = await search(page, "replace");
  await expect(dialog.getByText("Estimated preview size")).toBeVisible();
  const candidate = dialog.locator(".shopify-picker-card").filter({ hasText: "Walnut" });
  await expect(candidate).toContainText("Merchant dimensions (W × D × H) · 0.25 × 0.25 × 1 m");
  await dialog.getByRole("button", { name: "Ask Gemini to choose" }).click();
  const approve = candidate.getByRole("button", { name: "Approve replacement" });
  await approve.click();
  await expect(dialog.getByRole("status")).toContainText("This offer changed");
  await expect(candidate).toContainText("Merchant dimensions (W × D × H) · 0.42 × 0.38 × 1.1 m");
  const awaitingApproval = await readProject(page);
  expect(awaitingApproval.items).toEqual(before.items);
  expect(awaitingApproval.savedProducts).toEqual(before.savedProducts);
  await approve.click();
  await expect(dialog).toBeHidden();
  expect((await readProject(page)).house.objects).toContainEqual(expect.objectContaining({ shopify: ref, dimensions }));
});

test("unavailable recommendation cannot commit, and upstream failure leaves alternatives accessible", async ({ page }) => {
  await setup(page, { refresh: { available: false } });
  const before = await readProject(page);
  const dialog = await search(page, "replace");
  await dialog.getByRole("button", { name: "Ask Gemini to choose" }).click();
  await dialog.getByRole("button", { name: "Approve replacement" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/no longer available/);
  await expect(dialog.getByRole("button", { name: "Approve replacement" })).toBeDisabled();
  expect((await readProject(page)).items).toEqual(before.items);
  await page.route("**/api/shopify/recommend", (route) => route.fulfill({ status: 502, json: { error: "Gemini is unavailable." } }));
  await dialog.getByRole("button", { name: "Ask Gemini to choose" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Gemini is unavailable.");
  await expect(dialog.getByRole("button", { name: "Swap piece" }).first()).toBeEnabled();
});
