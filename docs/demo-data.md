# Demo Data & Determinism Manifest

This reference clarifies which datasets in **Your Room** are **live AI-extracted**, **deterministically computed at runtime**, **bundled verified presets**, or **isolated UI mock fallbacks**, so presenters keep every live demo claim 100% accurate.

---

## 1. Whole-Home Floorplans & Spatial Geometry

| Dataset / Entry Point | Source Type | Details |
| :--- | :--- | :--- |
| **Live Floorplan Upload** (`#floorplan-upload`) | **Live Gemini 4 + Deterministic Validator** | Calls `/api/floorplan/analyze` (`gemini-4-carbon`), scales via printed dimensions or 2-point user calibration, and validates via `validateHouseGeometry`. |
| **Mercer Street Apartment** (`#try-sample-floorplan`, `src/spatial/sample-floorplan.js`) | **Deterministic Bundled Floorplan Preset** | Matches `public/assets/sample-floorplan.svg` (`100 px = 1.00 m`, `9.6 × 8.6 m` bounds): 5 rooms (`Living Room`, `Kitchen`, `Hallway`, `Bedroom`, `Bathroom`), 6 doors, 4 windows, and 7 `locked: true` fixtures (`kitchen_counter`, `sink`, `stove`, `closet`, `toilet`, `sink`, `bathtub`). Normalized & validated at runtime. |
| **Connected Family Home** (`#whole-home-demo`, `house-demo.js`) | **Deterministic Pre-Furnished 3D Demo Preset** | `9.4 × 8.0 m` 4-room connected home (`Living Room`, `Kitchen`, `Bedroom`, `Bathroom`) with 7 locked fixtures + 10 movable furniture pieces (2 owned + 8 Shopify-referenced catalog pieces). |

---

## 2. Household Personas & Schedules

| Dataset / Entry Point | Source Type | Details |
| :--- | :--- | :--- |
| **Generate Household** (`#generate-household`) | **Live Gemini 4 + Deterministic Schedule Resolver** | Calls server-side persona generator (`src/agents/persona-api.js`) and validates non-overlapping fixed & flexible windows via `src/contracts/persona.js`. |
| **Sample Household (`Alex` & `Sam`)** (`#sample-household`, `src/persona/sample-household.js`) | **Bundled Offline Persona Preset** | `Alex` (WFH `09:00–17:00`, high quiet need `0.9`) and `Sam` (studies `15:00–16:00`, watches TV `16:00–17:00` overlapping Alex's work). |
| **Morning Routine Demo Household (`Kevin` & `Alice`)** (`src/simulation/demo-household.js`, `house-demo.js`) | **Deterministic Simulation Preset** | `Kevin` (`1.30 m/s`, WFH/quiet `0.9`) and `Alice` (`1.25 m/s`, daylight `0.8`) scheduled from `07:00–09:00` across bedroom, bathroom, hallway, kitchen, and living/exit. |

---

## 3. Simulation Scenarios & Outputs

| Scenario / Metric | Source Type | Verified Behavior |
| :--- | :--- | :--- |
| **`Morning Routine` (`07:00–09:00` on Mercer Street Apartment)** (`runMorningRoutineDemo` in `src/simulation/demo-household.js`) | **Deterministic Runtime Simulation Output** | Computed at 1-second resolution over the navigation grid & A* router: **Kevin** `~30.0 m` traveled, **Alice** `~22.5 m` traveled, `0` path failures, `2` hallway personal-space collisions, and `1` kitchen `CONGESTION` finding (`2` agents, `~1498 s` overlap, `~0.11 m` minimum clearance). |
| **`Morning Routine` / `Normal Day` / `Dinner Party — 8 Guests` / `Fire Emergency` in `demo-simulation-mock.js`** | **Isolated UI Shell Fallback (`isMockData: true`)** | Used **only** when the external simulation engine is not yet connected via `connectSimulationEngine`. Displays an explicit `Demo mock` / `Mock preview` badge in the UI so mock numbers (`64 → 91`, etc.) are never mistaken for live validator measurements. |

---

## 4. Furniture & Commerce Metadata

| Dataset | Source Type | Details |
| :--- | :--- | :--- |
| **`offers.json` + `catalog` (`model.js`)** | **Captured Real Shopify Variant Metadata** | Real Shopify merchant product URLs, variant IDs, product photos, store names, and USD prices captured on **November 21, 2026**. Placed 3D procedural/GLB meshes and bounding dimensions are **approximations**; merchants confirm current stock and pricing on their storefront. |
