# Stillroom

Stillroom turns a room photo or a custom floor plan into an editable, shoppable 3D layout. It runs locally in the browser with Three.js and a local COCO-SSD furniture detector.

## Run

Use Node.js 22.12 or newer. Run `npm ci` and `npm run dev`, then open the local address printed by Vite.

For live household generation, copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Restart Vite after editing the file. The server checks the models available to the key and selects one suited to structured household generation, preferring Gemini 4 Hydrogen. The sample household works without a key. To test the built app with the local API, run `npm run build` and `npm exec -- vite preview --host 127.0.0.1`.

Live Shopify search and checkout use the Vite server in dev and preview. They need internet access to Shop MCP and work without a Shopify API key or buyer sign-in.

## The five steps

1. **Room setup** — Upload a room photo, build a custom room, or import a whole-home floor plan. Try the sample floor plan for a repeatable import with no API key. Review and confirm the imported geometry before continuing to Household.
2. **Household** — Describe who lives there and when they use the space. Generate a draft or load the sample household. Give each activity fixed times or a flexible window and duration. You can add an occasional guest with no routine. Review the household, then save or skip to Design.
3. **Design brief** — Add a style reference, choose a palette, set a budget, and describe your requirements. Auto-style places catalog pieces around the furniture you kept. Try “A reading corner with a lamp and no rug under $550.”
4. **Explore room** — The room opens at eye level. Drag the background to look around, use the minimap viewpoints, or walk using the arrow buttons or W/A/S/D. Drag a piece to reposition it, or select it to rotate, replace, remove, or save it. Expand the room to fill the window. Orbit and overhead views are available for precise editing. The room command field accepts requests such as “remove the rug” and “add a lamp.”
5. **Shopping list** — Save individual suggestions or save all suggested pieces from the room. The list refreshes saved Shopify variants and lets you start a checkout for one live item at a time. Continue on the merchant’s page to review and pay. Saved projects resume in the same browser.

To try a live lookup in Studio, open **Add furniture** or **Swap**, choose **Shopify**, and search for “compact walnut side table.” Choose **Table** as the preview type. The 3D preview uses estimated dimensions. Auto-style uses the bundled catalog.

## Implementation

- `setup.js` manages room capture, architecture, and confirmed inventory. `detection.js` loads bundled COCO-SSD weights on demand and recognizes sofas, chairs, tables, beds and potted plants. The detector works locally. A room photo seeds representative models, approximate positions and colors. The initial footprint is adjustable. A single photo does not supply measured depth or exact object meshes.
- `model.js` generates layouts from style choices, a supported vocabulary, budget, and available floor space. `room-layout.js` supplies the architectural geometry. Gemini can later propose pieces and edits through the same state model.
- `scene.js` renders the same room in interior, orbit, and floor-plan views. The canvas fallback supports floor-plan editing on devices without WebGL.
- `offers.json` holds Shopify variant URLs and USD prices captured on November 21, 2026. Meshes and dimensions are approximations. Each merchant confirms current pricing, dimensions and availability. Product images load from merchant CDNs when viewing the shopping list.
- `src/shopify/shopify-api.js` adapts [Shop MCP](https://shop.dev/docs) to same-origin search, variant refresh, and checkout. The project stores live variant references and approximate geometry. Live prices and stock expire from memory within 10 minutes.
- `src/contracts/persona.js` validates household schedules at generation and save. The Gemini adapter runs on the local server, and approved households are saved in the browser with the project.
- Flexible activities fit into the earliest free slot inside their window. The resolver reserves fixed activities first and places flexible activities by earliest window opening, breaking ties in entry order. An activity must fit for its full duration. Profiles with no routine stay saved and have no activity in the daily replay.

### Studio replay

Confirm an imported floor plan and save a Household with scheduled activities. In Design or Explore room, choose **Capture baseline**. Move, rotate, or remove furniture in the studio, then choose **Compare current layout**. The panel reports measured path failures, collisions, and congestion for both layouts. A baseline lasts for the current tab session. Saving a different routine or replacing the floor plan requires a new baseline.

Both runs use the same approved activities, resolved times, and canonical room IDs. Each layout captures the actual world-space furniture currently in the studio, with the imported walls, doors, and locked fixtures. Room settings preserve the confirmed whole-home geometry. A confirmed replacement floor plan starts a new household.

## Verification

Run `npm test` for model, floor-plan, simulation, contract, and API tests, `npm run test:e2e` for browser flows, and `npm run build` for the production bundle. Run `node --test life-simulation.test.js` to verify the simulator and replay in isolation. The browser replay test uses the imported sample home and the real simulator. It removes a movable sofa and verifies that the saved Bedroom-to-Kitchen trip changes from blocked to passable. The automated tests run without Gemini credentials. Browser tests use Chrome or the installed Chromium channel selected by `PLAYWRIGHT_CHANNEL`.

[Asset credits](public/assets/CREDITS.md)

