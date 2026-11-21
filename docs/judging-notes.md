# Judge-Facing Talking Points & Q&A

Organized around hackathon judging criteria so either teammate can answer technical questions crisply and consistently.

---

## 1. Live Demo Impact (What Visually Changes on Screen)

1. **2D Floorplan → Interactive Overlay**: Uploaded or sample floorplan renders with color-coded room polygons, door swing/opening markers, window spans, locked fixture footprints, and live two-point scale calibration.
2. **Validated House JSON → Connected Multi-Room 3D Home**: A single unified Three.js scene renders distinct room floor finishes (oak, walnut, stone), shared interior partitions without Z-fighting/duplication, open walkable doorways, exterior windows, and procedural 3D bathroom/kitchen fixtures.
3. **360° Orbit + Eye-Level `W/A/S/D` Exploration**: Exterior walls facing the camera automatically cut away during 360° Orbit so judges can see inside every room, then restore to full height with ceilings when walking room-to-room in first-person mode.
4. **Measurable Friction → Before / After Scorecard**: Running household scenarios surfaces concrete spatial bottlenecks (`CONGESTION`, collisions, sightline/noise conflicts) and compares baseline vs. post-edit scores side by side.

---

## 2. Proof It Works (Why Success Is Not Judged by Another LLM)

We enforce a strict architectural split (**AGENTS.md §5 — "Gemini Reasons, Validators Decide"**):

- **Geometry & Scale Validator (`src/lib/validators/house-validator.js`)**: Deterministically checks polygon area, self-intersections, vertex finiteness, room-to-door reference integrity, window-to-wall proximity, scale sanity, and `locked: true` fixture enforcement.
- **Schedule Resolver (`src/persona/resolve-schedule.js`)**: Deterministically schedules fixed commitments first and packs flexible time windows without overlap; `compareHouseholdLayouts` freezes the resolved household so Before and After layouts face the exact same human demand.
- **Grid Navigation & A* Simulation (`src/simulation/`)**: Builds a meter-resolution walkability grid carving interior doorways out of wall segments, routes agents via A*, and measures path length, personal-space collisions, and multi-agent congestion duration/clearance in seconds and meters.
- **Lock Immutability (`src/contracts/scene.js`, `house-model.js`)**: Any attempt to move, rotate, replace, or delete a `locked: true` fixture (`toilet`, `sink`, `kitchen_counter`, `stove`, `bathtub`, `walls`) is deterministically rejected.

---

## 3. Technical Difficulty

- **Ambiguous Image → Meter-Accurate Topology**: Converting 2D pixel extractions into deduplicated shared interior walls (splitting T-junctions across adjacent rooms) and winding-independent exterior/interior wall normals.
- **Honest Scale Calibration**: Combining printed-dimension regex/segment matching with an interactive two-point physical calibration fallback (`meters`, `cm`, `feet`, `feet & inches`) instead of letting an LLM guess room sizes.
- **Continuous Multi-Room Spatial Model**: Maintaining one authoritative `House` state shared across 3D WebGL rendering, 2D canvas fallback, doorway collision math, furniture placement constraints, and A* pathfinding.
- **Deterministic Multi-Agent Spatiotemporal Replay**: Stepping multiple scheduled agents at 1-second resolution through narrow doorways and shared work zones to quantify clearance (`~0.11 m`) and overlap duration (`~1498 s`).

---

## 4. Why Gemini 4 Is Essential (Not a Chatbot Wrapper)

Gemini 4 is NOT used as a decorative chat sidebar. It solves the **unstructured-to-structured world-modeling bottlenecks** that traditional rule-based CAD software cannot handle without tedious manual drafting:

1. **Multimodal Spatial Semantics**: Reading diverse floorplan drawings, recognizing room functions, doors, windows, plumbing fixtures, and printed dimension callouts into a strict schema (`gemini-4-carbon`).
2. **Human Routine Synthesis**: Translating messy natural-language household lifestyles into structured, multi-person daily schedules and weighted environmental needs (`quiet`, `privacy`, `daylight`, `accessibility`, `social`).
3. **Constrained Spatial Reasoning**: Explaining measured simulation failures in human terms and proposing targeted `ScenePatch` edits that deterministic validators can immediately test.

---

## 5. Crisp One-Sentence Answers to Common Judge Questions

### "What makes this different from IKEA Kreativ or RoomGPT?"
> IKEA and RoomGPT help you visualize how furniture *looks* in a single room; **Your Room** simulates how an entire household *lives* across the whole home and measures where the layout fails.

### "Why use Gemini 4 here?"
> Gemini 4 converts messy visual floorplans and natural-language family routines into structured spatial and behavioral models, while deterministic engines verify whether those models physically work.

### "Why call it a Household Digital Twin?"
> Because the exact same household members, schedules, and stress scenarios can be replayed deterministically before and after layout changes—before spending thousands on furniture or signing a lease.

### "Why not just ask the VLM whether the room layout is good?"
> Because an LLM cannot reliably measure a 0.42-meter doorway pinch point or a 25-minute kitchen collision window—deterministic geometry, A* pathfinding, and validators decide pass or fail.

### "What happens if Gemini hallucinates a measurement on an unscaled floorplan?"
> Our schema and validator explicitly separate pixel geometry from physical scale: if no printed dimension is verified, confirmation is blocked until the user completes a two-point calibration.
