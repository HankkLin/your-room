# Hackathon Submission Copy

Ready-to-paste submission text for the **Gemini 4 NYC Hackathon** portal. Keep claims aligned with the final merged demo branch at submission time.

---

## Project Name

**Your Room**

---

## Tagline

**Test your life before you live it.**  
*(Alternate short tagline: **Will your life fit?**)*

---

## Short Description (1–2 Sentences)

**Your Room** is a household digital twin that turns a floorplan and a family's daily routines into a walkable multi-room 3D home, then simulates how people actually move and live inside it to catch collisions, congestion, and layout conflicts before they move in or buy furniture.

---

## Longer Description (~165 Words)

Most home-design apps answer a shallow question: *Does this sofa look good in this room?* They ignore the harder question every household discovers too late: *Will our daily lives actually fit inside this home?*

**Your Room** builds a **Household Digital Twin** of an entire multi-room home. Starting from an uploaded floorplan (or custom room setup), **Gemini 4** extracts rooms, doors, windows, printed dimensions, and immovable fixtures—toilets, sinks, counters, and ranges—into a meter-scale spatial contract. When a drawing lacks scale, our validator blocks guesswork and guides a quick two-point physical calibration before generating a connected 3D home with 360° Orbit and first-person `W/A/S/D` navigation.

Next, Gemini 4 translates natural-language household routines into structured personas with fixed commitments and flexible time windows. A deterministic spatial engine (grid navigation, A* pathfinding, and clearance/congestion validators) simulates daily life and stress scenarios, surfacing measurable bottlenecks so layout changes and source-backed Shopify furniture choices can be re-tested with clear **Before → After** proof.

---

## Gemini 4 Use

We apply **Gemini 4** strictly where multimodal perception and semantic reasoning shine—and pair it with deterministic verification everywhere physical truth matters. First, Gemini 4 (`gemini-4-carbon`, server-side schema-constrained extraction) interprets floorplan images into structured room polygons, door topology, windows, fixed plumbing/kitchen fixtures, and printed dimension callouts—refusing to invent scale when uncalibrated. Second, Gemini 4 converts plain-English household descriptions into validated `Persona[]` schedules (fixed times, flexible windows, and environmental needs like quiet and privacy). Finally, Gemini reasons over deterministic `SimulationFinding[]` evidence to propose targeted layout changes that never violate `locked: true` walls or fixtures.

---

## Technical Highlights

- **Multimodal Floorplan → Meter-Space `House` Contract**: Server-side Gemini 4 extraction + printed-scale parser + interactive 2-point calibration (`m`, `cm`, `ft/in`) + deterministic polygon/reference validator.
- **Connected Whole-Home 3D Renderer**: Single Three.js world with per-room floor finishes, deduplicated T-junction interior walls, winding-independent 360° Orbit cutaway, first-person `W/A/S/D` room-to-room walking, and a non-WebGL 2D canvas fallback.
- **Locked Reality vs. Editable Furniture**: Immovable architectural fixtures (`locked: true`) are deterministically protected from manual or AI mutation, while movable pieces link to source-backed Shopify merchant variants.
- **Deterministic Life Simulation & Replay**: Meter-grid walkability, doorway-carved A* routing, schedule resolution (fixed + flexible windows), collision/congestion measurement, and `Before → After` layout comparison.

---

## Demo Instructions (Judge Quick Start)

1. Run `npm ci && npm run dev` (Node.js 22.12+; add `GEMINI_API_KEY` in `.env.local` for live Gemini extraction/persona generation, or use the built-in samples offline).
2. Click **Try sample whole-home floorplan** (or upload a floorplan) → **Confirm & Continue** to open the multi-room 3D twin.
3. Orbit 360° or switch to **Interior** (`W/A/S/D`) to walk between rooms, inspect **Household** personas, run **Morning Routine** or stress scenarios, and review **Findings**, **Before / After** scores, and the **Shopping list**.
