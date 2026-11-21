# Stillroom

Stillroom turns a room photo or a custom floor plan into an editable, shoppable 3D layout. It runs locally in the browser with Three.js and a local COCO-SSD furniture detector.

## Run

Use Node.js 22.12 or newer. Run `npm ci` and `npm run dev`, then open the local address printed by Vite.

For live household generation, copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. Restart Vite after editing the file. The server checks the models available to the key and selects one suited to structured household generation, preferring Gemini 4 Hydrogen. The sample household works without a key. To test the built app with the local API, run `npm run build` and `npm exec -- vite preview --host 127.0.0.1`.

## The five steps

1. **Room setup** — Upload a photo, try the sample photo, or build a floor plan. Accept the starting footprint or drag its wall handles, enter dimensions, choose a rectangle or L-shape, place doors and windows, and pick finishes. Confirm, correct, or remove detected furniture before continuing.
2. **Household** — Describe who lives there and when they use the space. Generate a draft or load the sample household, review and edit the schedule, then save or skip to Design.
3. **Design brief** — Add a style reference, choose a palette, set a budget, and describe your requirements. Auto-style places catalog pieces around the furniture you kept. Try “A reading corner with a lamp and no rug under $550.”
4. **Explore room** — The room opens at eye level. Drag the background to look around, use the minimap viewpoints, or walk using the arrow buttons or W/A/S/D. Drag a piece to reposition it, or select it to rotate, replace, remove, or save it. Expand the room to fill the window. Orbit and overhead views are available for precise editing. The room command field accepts requests such as “remove the rug” and “add a lamp.”
5. **Shopping list** — Save individual suggestions or save all suggested pieces from the room. The list includes product photos, a subtotal, and links to the selected variants on Shopify merchant stores. Saved projects resume in the same browser.

## Implementation

- `setup.js` manages room capture, architecture, and confirmed inventory. `detection.js` loads bundled COCO-SSD weights on demand and recognizes sofas, chairs, tables, beds and potted plants. The detector works locally. A room photo seeds representative models, approximate positions and colors. The initial footprint is adjustable. A single photo does not supply measured depth or exact object meshes.
- `model.js` generates layouts from style choices, a supported vocabulary, budget, and available floor space. `room-layout.js` supplies the architectural geometry. Gemini can later propose pieces and edits through the same state model.
- `scene.js` renders the same room in interior, orbit, and floor-plan views. The canvas fallback supports floor-plan editing on devices without WebGL.
- `offers.json` holds Shopify variant URLs and USD prices captured on November 21, 2026. Meshes and dimensions are approximations. Each merchant confirms current pricing, dimensions and availability. Product images load from merchant CDNs when viewing the shopping list.
- `src/contracts/persona.js` validates household schedules at generation and save. The Gemini adapter runs on the local server, and approved households are saved in the browser with the project.

### Whole-home integration incomplete

Revisit once Kevin publishes canonical room IDs and a simulator input for household schedules. Update `src/persona/rooms.js` to expose those destinations and ask users to reassign any saved destinations that no longer exist. Use the Alex and Sam fixture to run the same saved schedules before and after clearing a blocked path. Close the milestone when the demo shows the measured change in path availability, as described in the hackathon brief.

## Verification

Run `npm test` for model, contract, and API tests, `npm run test:e2e` for browser flows, and `npm run build` for the production bundle. The automated tests run without Gemini credentials. For a live smoke test, enter “Alex works from home from 09:00 to 17:00. Sam watches TV from 16:00 to 17:00.” Generate, save, and reload the project to check that the approved schedules persist. The browser tests use Chrome or the installed Chromium channel selected by `PLAYWRIGHT_CHANNEL`.

[Asset credits](public/assets/CREDITS.md)

