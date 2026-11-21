# Stillroom

Stillroom turns a room photo or a custom floor plan into an editable, shoppable 3D layout. It runs locally in the browser with Three.js and a local COCO-SSD furniture detector.

## Run

Use Node.js 22.12 or newer. Run `npm ci` and `npm run dev`, then open the local address printed by Vite.

## The four steps

1. **Room setup** — Upload a photo, try the sample photo, or build a floor plan. Accept the starting footprint or drag its wall handles, enter dimensions, choose a rectangle or L-shape, place doors and windows, and pick finishes. Confirm, correct, or remove detected furniture before continuing.
2. **Design brief** — Add a style reference, choose a palette, set a budget, and describe your requirements. Auto-style places catalog pieces around the furniture you kept. Try “A reading corner with a lamp and no rug under $550.”
3. **Explore room** — The room opens at eye level. Drag the background to look around, use the minimap viewpoints, or walk using the arrow buttons or W/A/S/D. Drag a piece to reposition it, or select it to rotate, replace, remove, or save it. Expand the room to fill the window. Orbit and overhead views are available for precise editing. The room command field accepts requests such as “remove the rug” and “add a lamp.”
4. **Shopping list** — Save individual suggestions or save all suggested pieces from the room. The list includes product photos, a subtotal, and links to the selected variants on Shopify merchant stores. Saved projects resume in the same browser.

## Implementation

- `setup.js` manages room capture, architecture, and confirmed inventory. `detection.js` loads bundled COCO-SSD weights on demand and recognizes sofas, chairs, tables, beds and potted plants. The detector works locally. A room photo seeds representative models, approximate positions and colors. The initial footprint is adjustable. A single photo does not supply measured depth or exact object meshes.
- `model.js` generates layouts from style choices, a supported vocabulary, budget, and available floor space. `room-layout.js` supplies the architectural geometry. Gemini can later propose pieces and edits through the same state model.
- `scene.js` renders the same room in interior, orbit, and floor-plan views. The canvas fallback supports floor-plan editing on devices without WebGL.
- `offers.json` holds Shopify variant URLs and USD prices captured on November 21, 2026. Meshes and dimensions are approximations. Each merchant confirms current pricing, dimensions and availability. Product images load from merchant CDNs when viewing the shopping list.

## Verification

Run `npm test` for model tests, `npm run test:e2e` for browser flows, and `npm run build` for the production bundle. The browser tests use Chrome or the installed Chromium channel selected by `PLAYWRIGHT_CHANNEL`.

[Asset credits](public/assets/CREDITS.md)

