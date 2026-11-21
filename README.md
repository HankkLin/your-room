# Stillroom

Stillroom turns a room photo or a custom floor plan into an editable, shoppable 3D layout. It runs locally in the browser with Three.js and a local COCO-SSD furniture detector.

## Run

Use Node.js 22.12 or newer. Run `npm ci` and `npm run dev`, then open the local address printed by Vite.

For live household generation and replay suggestions, copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Restart Vite after editing the file. The server checks the models available to the key and selects one for structured output, preferring Gemini 4 Hydrogen. The sample household and manual replays work without a key. To test the built app with the local API, run `npm run build` and `npm exec -- vite preview --host 127.0.0.1`.

Live Shopify search and checkout use the Vite server in dev and preview. They need internet access to Shop MCP and work without a Shopify API key or buyer sign-in.

## The five steps

1. **Room setup** — Upload a room photo, build a custom room, or import a whole-home floor plan. Try the sample floor plan for a repeatable import with no API key. Review and confirm the imported geometry before continuing to Household.
2. **Household** — Describe who lives there and when they use the space. Generate a draft, load the sample household, or paste or upload a JSON export from a personal agent. Reassign unknown rooms before saving. Give each activity fixed times or a flexible window and duration. You can add an occasional guest with no routine. Review the household, then save or skip to Design.
3. **Design brief** — Add a style reference, choose a palette, set a budget, and describe your requirements. Browse live Shopify alternatives and request a reviewable furnishing proposal for the approved household. Approval rechecks the selected offers, budget and placement. Auto-style also places catalog pieces around the furniture you kept. Try “A reading corner with a lamp and no rug under $550.”
4. **Explore room** — The room opens at eye level. Drag the background to look around, use the minimap viewpoints, or walk using the arrow buttons or W/A/S/D. Drag a piece to reposition it, or select it to rotate, replace, remove, or save it. Expand the room to fill the window. Orbit and overhead views are available for precise editing. The room command field accepts requests such as “remove the rug” and “add a lamp.”
5. **Shopping list** — Save individual suggestions or save all suggested pieces from the room. The list refreshes prices and availability, groups selected variants by merchant and creates one checkout per merchant with the saved quantities. Continue on the merchant’s page to review and pay. Saved projects resume in the same browser.

To try a live lookup in Studio, open **Add furniture** or **Swap**, choose **Shopify**, and search for “compact walnut side table.” Choose **Table** as the preview type. When a product has supported 3D media, the preview uses the merchant model. Other products use a furniture-type model. The preview labels merchant dimensions and estimates. Delivery is shown when the merchant supplies an estimate.

## Implementation

- `setup.js` manages room capture, architecture, and confirmed inventory. `detection.js` loads bundled COCO-SSD weights on demand and recognizes sofas, chairs, tables, beds and potted plants. The detector works locally. A room photo seeds representative models, approximate positions and colors. The initial footprint is adjustable. A single photo does not supply measured depth or exact object meshes.
- `model.js` generates layouts from style choices, a supported vocabulary, budget, and available floor space. `room-layout.js` supplies the architectural geometry. Gemini proposes furnishing additions and redesign patches. The app validates the selected products, placement, locks and applicable budget before committing an approved change.
- `scene.js` renders the same room in interior, orbit, and floor-plan views. The canvas fallback supports floor-plan editing on devices without WebGL.
- `offers.json` holds Shopify variant URLs and USD prices captured on November 21, 2026. Meshes and dimensions are approximations. Each merchant confirms current pricing, dimensions and availability. Product images load from merchant CDNs when viewing the shopping list.
- `src/shopify/shopify-api.js` adapts [Shop MCP](https://shop.dev/docs) to same-origin search, variant refresh, and checkout. The project stores exact seller and variant references plus available merchant media and dimensions. Live prices and stock expire from memory within 10 minutes.
- `src/contracts/persona.js` validates household schedules at generation and save. The Gemini adapter runs on the local server, and approved households are saved in the browser with the project.
- Flexible activities fit into the earliest free slot inside their window. The resolver reserves fixed activities first and places flexible activities by earliest window opening, breaking ties in entry order. An activity must fit for its full duration. Profiles with no routine stay saved and have no activity in the daily replay.

### Studio replay

From Room setup, choose **Try blocked-route replay demo** → **Save and continue** → **Explore room** → **Capture baseline**. The five-room Mercer Street Apartment sample starts with a sofa near the Bedroom doorway and an editable morning routine. The baseline records one blocked Bedroom-to-Kitchen trip at 08:05. Choose **Suggest a fix**, review the proposed move, and choose **Approve move**. In the demo, moving the sofa farther into the Bedroom reduces the measured path failures from one to zero. **Undo last change** restores the original furniture position.

For manual comparison, capture a baseline, move, rotate, or remove furniture, then choose **Compare current layout**. Both runs use the same resolved snapshot of the approved activities and canonical room IDs. The panel reports path failures, collisions, and congestion. A baseline lasts for the current tab session. Saving a different routine or replacing the floorplan requires a new baseline.

The Vite development and preview API at `POST /api/replay/suggest-fix` sends a measured finding and nearby geometry to Gemini. The response contains an explanation and a `scenePatch` with one move in `[x, y, z]` meters. The app checks locks and whole-home placement before showing the preview, then checks them again before saving the move. The new replay measures whether the trip improved.

## Shopify verification

From the repository root, install dependencies with `npm ci`. Run these focused tests.

```sh
node --test src/shopify/shopify-api.test.js src/shopify/live-candidates.test.js
npm run test:e2e -- e2e/shopify.spec.js e2e/live-shopify-candidates.spec.js e2e/integrated-shopify.spec.js
```

| Check | What the test observes |
| --- | --- |
| Shop MCP adapter | A mocked provider receives the exact seller and variant IDs for lookup and cart creation. Two variants at quantities 2 and 1 produce one merchant cart. Mixed-merchant requests, changed prices, unavailable stock, incomplete confirmations and upstream errors exercise the rejection paths. |
| Shopping list in Chrome | Two sellers get separate links. A failed seller leaves the other checkout usable. Reloading and re-saving preserve quantities and the original quote. The test compares captured request bodies and merchant URLs. |
| Alternatives and assets | Chrome searches multiple variants, leaves unchosen variants out of the scene, requires approval after changed dimensions, and verifies the Three.js mesh, scale, reload and fallback after a model 404. |
| Household through checkout | The integrated test opens Design, browses two variants, rejects a price change from $120 to $142, approves the refreshed offer, fixes the blocked route from one failure to zero, and checks that the cart contains only the approved SKU at $142 and quantity one. |

The unit suite mocks the external Shop MCP service. The browser suite supplies repeatable Shopify and Gemini responses and exercises the actual UI, saved projects, Three.js rendering and simulation. Automated tests end at the merchant link.

For a live catalog check, run `npm run dev`. In Design, use **Browse Shopify alternatives**, or in Studio choose **Add furniture → Shopify**. Search for `wood stool` with **With 3D models** selected. Look for the merchant, variant, stock, price, delivery and dimensions on the result. Choose a variant in Studio, save the room, then open the shopping list. **Start checkout** refreshes the selected variants and shows a merchant link when the merchant confirms the cart. Stop at that link for a smoke test. Availability, model media and delivery estimates depend on the merchant.

## Verification

Run `npm test` for model, floorplan, simulation, contract, and API tests, `npm run test:e2e` for browser flows, and `npm run build` for the production bundle. The browser replay tests use the normal demo setup, mock the Gemini endpoint, and run the real simulator. They verify the Bedroom-to-Kitchen improvement, approval and undo, locked fixtures, and invalidation when the layout or routine changes. The automated tests run without Gemini credentials. Browser tests use Chrome or the installed Chromium channel selected by `PLAYWRIGHT_CHANNEL`. Playwright starts its own local server. If another worktree uses the default port 4279, set `PLAYWRIGHT_PORT` to an unused port.

[Asset credits](public/assets/CREDITS.md)

