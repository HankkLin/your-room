# Stillroom

Stillroom turns a room photo or a custom floor plan into an editable, shoppable 3D layout. It runs locally in the browser with Three.js and a local COCO-SSD furniture detector.

## Run

Use Node.js 22.12 or newer. Run `npm ci` and `npm run dev`, then open the local address printed by Vite.

For live household generation, copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Restart Vite after editing the file. The server checks the models available to the key and selects one suited to structured household generation, preferring Gemini 4 Hydrogen. The sample household works without a key. To test the built app with the local API, run `npm run build` and `npm exec -- vite preview --host 127.0.0.1`.

## The five steps

1. **Room setup** — Upload a room photo, build a custom room, or import a whole-home floor plan. Try the sample floor plan for a repeatable import with no API key. Review and confirm the imported geometry before continuing to Household.
2. **Household** — Describe who lives there and when they use the space. Generate a draft or load the sample household. Give each activity fixed times or a flexible window and duration. You can add an occasional guest with no routine. Review the household, then save or skip to Design.
3. **Design brief** — Add a style reference, choose a palette, set a budget, and describe your requirements. Auto-style places catalog pieces around the furniture you kept. Try “A reading corner with a lamp and no rug under $550.”
4. **Explore room** — The room opens at eye level. Drag the background to look around, use the minimap viewpoints, or walk using the arrow buttons or W/A/S/D. Drag a piece to reposition it, or select it to rotate, replace, remove, or save it. Expand the room to fill the window. Orbit and overhead views are available for precise editing. The room command field accepts requests such as “remove the rug” and “add a lamp.”
5. **Shopping list** — Save individual suggestions or save all suggested pieces from the room. The list includes product photos, a subtotal, and links to the selected variants on Shopify merchant stores. Saved projects resume in the same browser.

## Implementation

- `setup.js` manages room capture, architecture, and confirmed inventory. `detection.js` loads bundled COCO-SSD weights on demand and recognizes sofas, chairs, tables, beds and potted plants. The detector works locally. A room photo seeds representative models, approximate positions and colors. The initial footprint is adjustable. A single photo does not supply measured depth or exact object meshes.
- `model.js` generates layouts from style choices, a supported vocabulary, budget, and available floor space. `room-layout.js` supplies the architectural geometry. Gemini can later propose pieces and edits through the same state model.
- `scene.js` renders the same room in interior, orbit, and floor-plan views. The canvas fallback supports floor-plan editing on devices without WebGL.
- `offers.json` holds Shopify variant URLs and USD prices captured on November 21, 2026. Meshes and dimensions are approximations. Each merchant confirms current pricing, dimensions and availability. Product images load from merchant CDNs when viewing the shopping list.
- `src/contracts/persona.js` validates household schedules at generation and save. The Gemini adapter runs on the local server, and approved households are saved in the browser with the project.
- Flexible activities fit into the earliest free slot inside their window. The resolver reserves fixed activities first and places flexible activities by earliest window opening, breaking ties in entry order. An activity must fit for its full duration. Profiles with no routine stay saved and have no activity in the daily replay.

### Whole-home integration incomplete

Confirmed floor plans supply the canonical room IDs used in Household. Room settings edit the studio preview and preserve the imported geometry and IDs. The studio still renders one primary room. A confirmed replacement floor plan starts a new household.

`compareHouseholdLayouts` in `src/persona/compare-household-layouts.js` resolves the approved activities once and passes the same times and destination IDs to both runs. The tests use imported rooms with a simulator stub. Whole-home rendering, pathfinding, and the measured before/after replay remain open.

## Verification

Run `npm test` for model, floor-plan, contract, and API tests, `npm run test:e2e` for browser flows, and `npm run build` for the production bundle. The automated tests run without Gemini credentials. To try the integrated flow, confirm the sample floor plan, load the sample household, choose a room such as Kitchen for an activity, and save. Edit the project name in Room settings, reload, then open Household to confirm the destination persists. The browser tests use Chrome or the installed Chromium channel selected by `PLAYWRIGHT_CHANNEL`.

[Asset credits](public/assets/CREDITS.md)

