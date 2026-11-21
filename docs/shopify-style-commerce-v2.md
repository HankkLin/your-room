# Shopify and style discovery V2

From **Design brief**, enter a whole-home brief, choose a room and select **Find furniture for this brief**. A household and placed furniture are optional. Each result shows the exact variant, merchant quote and available product media. Search by item also works when Gemini is unavailable. Browsing leaves the scene and saved shopping list intact.

## Team sync and base

The feature branch starts at `origin/main` commit `08f3c65`. This base includes the integrated demo in [PR #6](https://github.com/HankkLin/your-room/pull/6) and the catalog-to-checkout fix in [PR #7](https://github.com/HankkLin/your-room/pull/7). It preserves both the single-item and grouped checkout callers.

| Remote workstream inspected | Tip | Integration effect |
|---|---|---|
| Kevin’s end-to-end twin | `feat/end-to-end-twin-integration` · `8a7fa56` | Reuse proposal, approval, replay and saved products. |
| Kevin’s desktop | `feat/household-believability-upgrade` · `764339c` | Family of Four, continuous walking, wheelchair accessibility, visitor scenarios, playback and checkpoints stay with simulation. |
| Kevin’s laptop | `feat/ikea-like-ux-redesign` · `fd5e614` | Keep its seven-step navigation, review tray, and Step 7 shopping cards. The laptop tip contains final-demo QA commit `20d3047`. |
| Other final-demo work | `feat/final-integration-prep` · `55caec6`, `docs/demo-submission` · `0097baf` | Demo controls and submission instructions have separate owners. No standalone `origin/qa/final-demo` was advertised in the fetch. |

All 14 Hank-authored remote feature tips inspected were already ancestors of the chosen base.

| Area | Feature branch suffix and commit |
|---|---|
| Shopify | `shopify-commerce 71f6df1`, `shopify-grouped-checkout 094da39`, `shopify-checkout-destinations 0fdf6c0`, `shopify-live-redesign-candidates 74973a8`, `product-specific-furniture-assets bc9c773` |
| Household | `persona-agent a553730`, `flexible-household-schedules 3feef8b`, `persona-driven-furnishing 91b9d98`, `personal-agent-persona-import a2af384` |
| Reasoning, environment and integration | `gemini-region-redesign 0d0e847`, `gemini-replay-redesign 5cdfe27`, `studio-replay 236ab0b`, `address-environment-context 5508a76`, `stillroom-integrated-demo 6d89680` |

## Shared contracts

| Contract | Owner | Current definition | What commerce consumes or supplies | Integration conflict |
|---|---|---|---|---|
| House | Shared spatial | `src/contracts/scene.js`, `house-model.js` | Reads IDs and names through `listPersonaRooms(project)`. | None. |
| SceneObject | Shared spatial | `src/contracts/scene.js`, `model.js` | Reads room, owned status and exact Shopify reference. Approved placements reuse the existing scene adapter and meter units. | None in the schema. |
| Persona | Shared persona | `src/contracts/persona.js` | Optional for discovery. The approved household still supplies persona-driven furnishing. | None. |
| ScenePatch | Kevin, redesign | `src/contracts/scene-patch.js`, `src/redesign/validate-scene-patch.js` | Live variant identity becomes the candidate ID for existing add/replace operations. Approval refreshes the offer and uses the spatial validators. | Keep the desktop patch validator and approval path. |
| SimulationFinding | Kevin, validators | `src/contracts/simulation.js`, `src/simulation/simulation-findings.js` | Redesign consumes measured evidence. Style parsing supplies preferences only. | None. |
| ScenarioDefinition | Kevin, simulation | `DEMO_SCENARIOS` in `src/contracts/simulation.js`, `src/simulation/scenarios/` | Discovery can run before any scenario. | Keep the desktop scenario registry and factories. |
| ProductCandidate | Hank, commerce | `createProductCandidate` in `src/contracts/product.js` | One normalized row per seller and variant, with source, identifiers, prices, availability, media, dimensions and destination provenance. | Additive fields preserve the legacy names. Snapshot-based spatial candidates use the existing adapter. |
| StyleBrief | Hank, design | `resolveBrief` in `model.js`, `src/agents/furnishing-contract.js`, structured extension in `src/agents/style-brief.js` | Room-keyed design intent and optional budget coexist with the saved style and free-text brief. | Laptop maps its Design step to the new API. Existing saved projects need no migration. |

## Desktop and laptop integration

```js
import { parseStyleBrief } from "./src/agents/style-brief.js";
import { listPersonaRooms } from "./src/persona/rooms.js";
import { searchProductsForDesign } from "./src/shopify/design-search.js";
import { toRedesignCandidate } from "./src/shopify/scene-candidate.js";

const rooms = listPersonaRooms(project);
const styleBrief = await parseStyleBrief({ prompt, rooms }, { signal });
const room = rooms.find(entry => entry.id === selectedRoomId);
const { products, warnings } = await searchProductsForDesign({
  styleBrief, room, constraints: { existingPieces: project.items }
}, { signal });
const spatialOptions = products.map(row => toRedesignCandidate(row, row.kind)).filter(Boolean);
```

**Desktop.** Pass the eligible options to the existing redesign preview. On approval, retain the existing `refreshPatchCandidates`, ScenePatch validator and replay. A shortlist may contain multiple furniture types. Use each row’s `kind`. `modelUrl: null` calls for the existing type preview. Merchant dimensions are in meters, and preview estimates retain their label. To combine candidates with an active checkout quote cache, use `getCandidateProducts({ candidateSnapshot, sceneItems, getQuote })` from `src/shopify/candidate-products.js`.

**Laptop.** The Design step can call the two functions above or mount `mountDesignSearch` from `src/components/catalog/design-search.js` using the markup in `index.html`. Keep the laptop’s `saveRoomAndGoToShop()` as the Step 7 entry point. Supply its selected saved rows to `buildCheckoutPlan({ selectedRows, quotes })` in `src/shopify/checkout-plan.js`, where `quotes.get(ref)` returns a fresh exact match. `groups[]` exposes `sellerDomain`, `lines`, `ready` and `reason`. Submit each ready group via `shopifyRequest("checkout", { lines: group.lines })`; the response uses `continueUrl`. Totals, warnings and failures remain scoped to that merchant. The shopping component supports the laptop’s saved `roomLabel` and `suggestedReason`. Review the shared `app.js` and `index.html` wiring when bringing the two branches together.

## Style and product examples

In the final live Chrome run, Gemini and Shop MCP returned six coffee-table variants within the requested limit. Five were in stock. All six cards displayed their product image and a verified merchant link. The highest quote was $153.40. The imported house started with zero movable pieces and zero personas. Browsing preserved the project and issued zero checkout requests. [Screenshot of the live Design panel](style-commerce-v2.png)

A brief such as “Warm Japanese Scandinavian home for a family of four, child-friendly wood and indirect lighting, $12,000 for the home, with a warm oak coffee table under $400” produces structured intent. This abbreviated example illustrates the server response shape.

```json
{
  "styles": ["Japandi", "Scandinavian"],
  "colors": ["warm white"],
  "materials": ["oak"],
  "priorities": ["child-friendly", "warm indirect lighting"],
  "budget": { "amount": 12000, "currency": "USD" },
  "roomIntents": { "living": [{ "kind": "table", "query": "warm oak coffee table", "maxPriceMinor": 39999 }] }
}
```

An explicitly edited budget field sets the household ceiling. Each item cap also applies to the original prompt when Gemini paraphrases the query. Reviewed furnishing proposals also enforce the item budget for the selected room and type. Shopify receives price filters in USD cents, and the application checks returned prices, currency and named variant finishes locally. Owned pieces guide category selection. Fresh quotes for retained purchases count toward the whole-home budget.

Observed U.S. catalog quotes on November 21, 2026 include the following. Price and availability can change. Delivery and model fields stay empty when the source supplies neither.

| Merchant and variant | USD | Availability | Product page verification |
|---|---:|---|---|
| daals · Maru Round Oak Pedestal Coffee Table, Oak · `46435092758838` | $99.99 | Available | The final run verified and displayed the [merchant page](https://www.daals.com/products/maru-round-oak-pedestal-coffee-table-oak?variant=46435092758838). An earlier HTTP 429 suppressed the link. |
| Furnirem · Oval Solid Wood Coffee Table, Oak / Small · `45293511376948` | $105.00 | Available | The final run verified and displayed the [merchant page](https://furnirem.com/products/oval-solid-wood-coffee-table?variant=45293511376948). An earlier HTTP 429 suppressed the link. |
| Garvee · 28-inch round coffee table · `53349479383353` | $126.99 | Available | An exact live V2 lookup confirmed the [merchant page](https://www.garvee.com/products/garvee-28-round-coffee-table-with-phk-3633dqq8?variant=53349479383353) with HTTP 200 and no redirects. |

## Redirects and checkout

| Destination | How the app verifies it |
|---|---|
| Product and variant | The permanent shop domain or storefront URL must come from the matched variant’s seller. Product pages must preserve HTTPS, the product handle and the one exact variant parameter throughout the chain. In a live exact lookup of all 22 curated entries, the returned product and variant-buy hosts matched the corresponding seller storefront across four merchants. The picker, Design results, quote refreshes and saved rows share these checks. |
| Merchant policies and notices | Only merchant-owned informational routes are eligible. Unrelated links are removed from both success and error responses. |
| Catalog `checkoutUrl` | An optional Shopify-supplied merchant `/buy/<variant>:1` URL is validated as source metadata. Browsing never visits it. Shopify documents that visiting it can start checkout. [Shopify permalink behavior](https://shopify.dev/changelog/posts/cart-and-checkout-permalinks-now-support-ucp-at-buy) |
| Buyer handoff | On request, the backend refreshes the exact variants, confirms stock and expected price, asks Shopify to create checkout for one seller, then matches the returned lines and quantities. Only a merchant checkout or recognized Shopify-hosted checkout passing the redirect verifier is offered. A failed check after creation reports an uncertain outcome and withholds the link. |
| Legacy saved product URLs | Saving keeps the historical record. A current exact lookup supplies the buyer-facing link. An unrelated or stale saved URL cannot become a fallback CTA. |

A single selected item creates one merchant handoff. Repeated variants are consolidated by quantity. “Prepare all” prepares a separate checkout for each merchant. Repricing or a failed seller leaves other ready groups usable.

The **Add grouped Shopify checkout** chat recorded live buyer-visible order summaries on the merged base, including one Sundays rug at $705.50, its two-line group at $1,326.50 and the separate Brightech lamp at $119.00. A GDF Studio checkout preserved one Single and two Set of 2 variants at $541.97. The earlier buyer sessions moved from `shop.app/checkouts/r/…` to `shop.app/checkouts/uc/…`. The opaque identifier changed in all 13 observed transitions. The V2 verifier rechecked one previously issued hosted summary and followed HTTP 302 to HTTP 200 HTML. Controlled checkout responses covered seller identity, exact lines and quantities, group creation and rejected redirects. The live V2 checks reused the existing summary and stopped before payment.

## Verification and environment

### IKEA Step 7 checkout

PR #8 was exercised together with Kevin’s `feat/ikea-like-ux-redesign` at `fd5e614` in a separate integration checkout. The regression clicked **Review products & checkout** in the planner tray, reloaded, returned to the planner, and clicked its **Step 7** navigation button. Each entry saved the same four eligible placements with their room labels and quantities. The lamp retained its original unit quote and saved suggestion reason.

With controlled Shopify responses, the lighting merchant received three lamps and one shade. The other merchant received one rug in a separate checkout, even though its variant ID matched the lamp’s ID at the first merchant. A lamp price change from $189 to $199 required another click for lighting only. The rug checkout stayed available throughout. A second case covered legacy items with missing prices or incomplete Shopify references. It showed a partial subtotal and allowed checkout for the confirmed merchant. [Step 7 screenshot after the price was accepted](ikea-step-7-checkout.png)

To repeat the Step 7 check in the combined planner, set `PLAYWRIGHT_PLANNER=ikea` and run `npm run test:e2e -- e2e/shopify.spec.js -g "whole-home review"`. The same tests use the standard review button on the commerce branch. When integrating the planner, route both entry points through `saveRoomAndGoToShop()`. Call `savedProductForPlacement(item, { previous, quote, roomLabel, suggestedReason })` from `src/shopify/scene-candidate.js` and render each placement’s room and reason once.

Both source trees were tested on November 21, 2026. The Chrome suite includes the empty-house design flow, whole-home checkout, and a legacy shopping list with missing prices.

| Source tested | Unit and middleware | Chrome | Production build |
|---|---:|---:|---|
| PR #8 code at `ba19958` | 158 passed | 56 passed | Passed |
| PR #8 with Kevin’s IKEA redesign at `fd5e614`, local integration commit `338e674` | 160 passed | 57 passed | Passed |

The branch comparison found overlapping edits on desktop in `app.js`, `package.json` and `e2e/twin-golden-path.spec.js`. On laptop the overlaps are `app.js`, `index.html`, `src/components/catalog/shopping-list.js` and the same golden-path test. Each teammate branch remains separate for review.

Use `npm run dev` with the existing server-side `GEMINI_API_KEY` for style parsing. The existing public Shop MCP adapter supplies U.S./USD quotes. No new environment variable is required. A failed Gemini call leaves manual item search available. HTTP 403, HTTP 429, an unconfirmed redirect or unavailable merchant page leaves the individual link hidden.

| Acceptance | Coverage |
|---|---|
| S1–S4 · destination, variant, merchant and rejected redirects | Shopify middleware tests inject each redirect hop, including changed handle, variant, merchant, malformed URLs, a loop and HTTP 429. Browser tests exercise picker, saved rows and grouped checkout. |
| S5–S8 · canonical candidate, style, multiple products and unknown data | Design-search and live-candidate unit tests plus the empty-home Chrome flow cover parsing, budget limits, owned furniture, placed and unplaced variants, dimensions, model fallback and unknown delivery and stock. |
| S9–S10 · grouped checkout and compatibility | Single-ref and grouped-line requests, repeated quantities, old saves, merchant failure isolation, furnished house, approval and replay are covered by middleware and browser tests. |
