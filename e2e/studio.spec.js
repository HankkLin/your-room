import { test, expect } from "@playwright/test";
const project = (p) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));
const owned = (s) => s.items.filter((i) => i.owned);
const photo = "public/assets/sample-capture.jpg";
async function startDemo(page) {
  await page.goto("/");
  await page.locator("#explore-demo").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
}
test("custom room flows through the brief, furnished tour and saved Shopify variants", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Living Blueprint · Room studio");
  await expect(page.getByRole("link", { name: "Living Blueprint", exact: true })).toBeVisible();
  await expect(page.locator("#setup-page")).toBeVisible();
  await expect(page.locator("#studio")).toBeHidden();
  await page.locator("#custom-room").click();
  await page.locator("#setup-name").fill("My reading room");
  await page.locator("#room-shape").selectOption("alcove");
  await page.locator("#room-width").fill("5.8");
  await page.locator("#room-height").fill("2.9");
  await page.getByRole("button", { name: "Sage wall paint" }).click();
  await page.locator("[data-floor=walnut]").click();
  await page.locator("#add-window").click();
  await page.getByLabel("Window wall").last().selectOption("left");
  await page.locator("#setup-next").click();
  await page.locator("#owned-kind").selectOption("sofa");
  await page.locator("#add-owned").click();
  await page.locator("[data-name]").fill("My green sofa");
  await page.locator("#setup-next").click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  const before = await project(page);
  expect(before.room).toMatchObject({
    shape: "alcove",
    width: 5.8,
    height: 2.9,
    floorFinish: "walnut",
    wallColor: "#b7c1aa",
  });
  expect(before.room.openings).toHaveLength(3);
  expect(owned(before).map((i) => i.name)).toEqual(["My green sofa"]);
  expect(before.personas).toEqual([]);
  await page
    .locator("#brief")
    .fill("A reading corner with a lamp and no rug under $550");
  await page.getByRole("button", { name: "Soft modern", exact: true }).click();
  await page.locator("#generate").click();
  await expect(page.locator("#view-label")).toHaveText("Interior view");
  const styled = await project(page);
  expect(styled.spent).toBeGreaterThan(0);
  expect(styled.spent).toBeLessThanOrEqual(550);
  expect(owned(styled)).toEqual(owned(before));
  expect(styled.items.some((i) => i.kind === "rug")).toBe(false);
  await page.locator("#save-room").click();
  await expect(page.locator("#shop-page")).toBeVisible();
  await expect(page.locator(".shop-card a").first()).toHaveAttribute(
    "href",
    /https:.*\/products\/.*\?variant=\d+/,
  );
  await page.reload();
  await expect(page.locator("#shop-page")).toBeVisible();
  expect((await project(page)).items).toEqual(styled.items);
  const count = await page.locator(".shop-card").count();
  await page.locator("[data-unsave]").first().click();
  expect(await page.locator(".shop-card").count()).toBe(count - 1);
  expect(errors).toEqual([]);
});
test("a real room photo produces reviewable owned furniture on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#room-photo-upload").setInputFiles(photo);
  await expect(page.locator("#room-width")).toBeVisible();
  await page.locator("#setup-next").click();
  await expect(page.locator("[data-kind]").first()).toBeVisible({
    timeout: 30000,
  });
  const kinds = await page
    .locator("[data-kind]")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(kinds).toContain("sofa");
  await page.locator("#setup-next").click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  const initial = await project(page);
  expect(initial.roomPhoto).toMatch(/^data:image/);
  expect(owned(initial).some((i) => i.kind === "sofa")).toBe(true);
  await page.locator("#inspiration").setInputFiles(photo);
  await expect(page.locator(".reference-preview")).toBeVisible();
  await page.locator("#budget").fill("0");
  await page.locator("#generate").click();
  expect(owned(await project(page))).toEqual(owned(initial));
  expect((await project(page)).spent).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
test("tour exploration, object edits, room commands and undo", async ({
  page,
}) => {
  await startDemo(page);
  await expect(page.locator("#scene canvas")).toHaveAttribute(
    "data-engine",
    /three/i,
  );
  await page.locator("[data-spot=window]").click();
  await expect(page.locator("#spot-label")).toContainText("Window");
  const pose = await page.locator("#map-eye").getAttribute("transform");
  for (const direction of ["forward", "right", "left", "backward"]) {
    await page.locator("[data-walk=" + direction + "]").click();
    if ((await page.locator("#map-eye").getAttribute("transform")) !== pose)
      break;
  }
  await expect(page.locator("#spot-label")).toHaveText("Walking");
  expect(await page.locator("#map-eye").getAttribute("transform")).not.toBe(
    pose,
  );
  await page.locator("#expand-room").click();
  await expect(page.locator("body")).toHaveClass(/room-expanded/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/room-expanded/);
  await page.locator("#edit-text").fill("remove the rug");
  await page.locator("#edit-request button").click();
  expect((await project(page)).items.some((i) => i.kind === "rug")).toBe(false);
  await page.locator("#undo").click();
  expect((await project(page)).items.some((i) => i.kind === "rug")).toBe(true);
  const inventory = page.locator("#inventory button");
  const before = await project(page);
  const lamp = before.items.find((i) => i.kind === "lamp");
  await page.locator('[data-item="' + lamp.id + '"]').click();
  await page.locator("[data-action=rotate]").click();
  expect(
    (await project(page)).items.find((i) => i.id === lamp.id).rotation,
  ).toBe((lamp.rotation + 90) % 360);
  await page.locator("[data-action=save]").click();
  expect((await project(page)).savedProducts).toHaveLength(1);
  await page.locator("[data-action=swap]").click();
  await page.locator('[data-product="milk-glass-lamp"]').click();
  expect(
    (await project(page)).items.some((i) => i.productId === "milk-glass-lamp"),
  ).toBe(true);
  await page.locator("[data-action=remove]").click();
  expect(
    (await project(page)).items.some((i) => i.productId === "milk-glass-lamp"),
  ).toBe(false);
  await page.locator("#add-piece").click();
  await page.locator('[data-product="brass-lamp"]').click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await inventory.count()).toBe(before.items.length);
});

test("a previously saved room stays available when cancelling new setup", async ({
  page,
}) => {
  await startDemo(page);
  const before = await project(page);
  await page.locator("#new-project").click();
  await page.locator("#custom-room").click();
  await page.locator("#setup-name").fill("Unapplied draft");
  await page.locator("#setup-back").click();
  await page.locator("#resume-room").click();
  expect((await project(page)).roomName).toBe(before.roomName);
  expect((await project(page)).items).toEqual(before.items);
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
});
test("floor plan pointer picking and movement use the shared scene", async ({
  page,
}) => {
  await startDemo(page);
  await page.locator("#view-plan").click();
  const canvas = page.locator("#scene canvas");
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox(),
    before = (await project(page)).items.find((i) => i.kind === "table");
  const unit =
    rect.height / (2 * Math.max(2.48, (3.12 * rect.height) / rect.width));
  const x = rect.x + rect.width / 2 + before.x * unit,
    y = rect.y + rect.height / 2 + before.z * unit;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#objectbar")).toContainText(before.name);
  expect(
    (await project(page)).items.find((i) => i.id === before.id).z,
  ).toBeGreaterThan(before.z + 0.01);
});
test("floor plan remains available without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) {
      return t.startsWith("webgl") ? null : get.call(this, t, ...a);
    };
  });
  await startDemo(page);
  await expect(page.locator("#view-3d")).toBeDisabled();
  await expect(page.locator("#view-label")).toHaveText("Top view");
  await page.locator("#inventory button").first().click();
  await expect(page.locator("[data-action=remove]")).toBeVisible();
});
