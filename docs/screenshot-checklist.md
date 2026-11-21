# Screenshot & Demo Video Capture Checklist

Capture real screenshots and short screen-recording clips from the running app (`1440×900` or `1920×1080`, light theme, clean browser chrome) once final branch merges are complete. **Do not generate synthetic/mocked renders.**

---

## Required Visual Captures

- [ ] **1. Floorplan Input & Scale Calibration**
  - Show the floorplan importer overlay with detected room polygons, doors, windows, locked fixtures, and either the `printed_dimension` scale badge or the interactive two-point calibration line.
- [ ] **2. Parsed Geometry Review (`View Parsed Geometry`)**
  - Open the structured `House` JSON modal showing `"units": "meters"`, room polygons, door connectivity, and `"locked": true` fixtures.
- [ ] **3. Whole-Home 3D Overview (Orbit / Dollhouse View)**
  - Oblique 360° perspective showing all connected rooms (`Living Room`, `Kitchen`, `Bedroom`, `Bathroom` / `Hallway`), per-room floor finishes, interior doorways, locked bathroom/kitchen fixtures, and furnished rooms.
- [ ] **4. First-Person Interior View (`W/A/S/D` Walkthrough)**
  - Eye-level shot looking from the Living Room through an open interior doorway into the Kitchen or Bedroom, with the multi-room minimap and live room indicator (`#spot-label`) visible in the top-right corner.
- [ ] **5. Household Personas & Daily Schedules**
  - Step **2 · Household** showing generated or sample household members, quantified needs (`quiet`, `privacy`, `daylight`), fixed schedule blocks, and flexible activity windows.
- [ ] **6. Simulation Running (`Household Digital Twin` Control Panel)**
  - Sidebar control panel showing active scenario (`Morning Routine`), speed selector (`1×` / `5×` / `20×`), running status indicator, and live simulation clock.
- [ ] **7. Measured Spatial Finding (`CONGESTION` / Collision)**
  - Findings card highlighting kitchen congestion or hallway collision with room tag and measured clearance/duration summary.
- [ ] **8. Stress-Test Scenario (`Dinner Party — 8 Guests` or `Fire Emergency`)**
  - Critical (`⛔`) bottleneck finding under high-occupancy or emergency egress stress testing.
- [ ] **9. Before / After Scorecard Comparison**
  - Side-by-side `BEFORE → AFTER` table displaying numeric category improvements and positive delta badges (`+27`, `+29`, etc.).
- [ ] **10. Gemini Redesign (`ScenePatch` Summary & Locked Fixture Guard)**
  - Redesign action checklist alongside a selected fixture showing `Fixed fixture · Locked` in the object bar (proving plumbing/walls were preserved).
- [ ] **11. Real Shopify Product Shopping List**
  - Step **5 · Shopping list** displaying saved furniture cards, merchant names, variant prices, estimated subtotal, and direct `Shop at … ↗` links.
