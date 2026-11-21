# Live Demo Script (2:45 Target Runtime)

> **Presenter Goal:** Show a live, working progression from **2D floorplan → validated 3D home → household schedules → measurable living friction → verified before/after improvement → real shoppable products**.
>
> **Honesty Rule:** Only demonstrate capabilities merged on the demo branch. If using a bundled preset or mock preview layer during a transition, name it transparently.

---

## 0:00–0:15 — The Problem (15s)

**On Screen:** Setup landing screen of **Your Room**.

**Say:**
> "Every interior design app shows whether a sofa physically fits in a room. None of them show whether your *family's life* fits in the home—what happens at 7:45 AM when two people collide in a narrow kitchen, or when living-room TV noise ruins a work-from-home call. **Your Room** is a household digital twin that simulates life inside a home before you move in or buy the furniture."

---

## 0:15–0:35 — Build the Whole-Home Twin (20s)

**Action:**
1. Upload an unseen floorplan image (or click **Try sample whole-home floorplan** for instant zero-latency reliability).
2. Briefly flash **View Parsed Geometry** / calibration badge (`printed_dimension` or 2-point manual calibration), then click **Confirm & Continue**.
3. Orbit 360° around the multi-room 3D apartment, then switch briefly to **Interior** (`W/A/S/D`) to walk through a doorway.

**Say:**
> "We start from a floorplan. Gemini 4 extracts structured rooms, doors, windows, and immovable fixtures—toilets, sinks, kitchen counters, and ranges—all locked so AI can never cheat by moving plumbing. If a drawing has no printed scale, Gemini doesn't hallucinate dimensions; our validator requires two-point calibration first, then generates one connected meter-scale 3D home."

---

## 0:35–0:55 — Create the Household (20s)

**Action:**
1. Open **Household** (or highlight the **Household** persona summary in the studio).
2. Show two contrasting routines (e.g., **Kevin** working from home needing quiet; **Alice** on an early morning kitchen + evening living-room routine, or generate live from a two-sentence prompt).

**Say:**
> "Next, Gemini 4 turns a plain-English description of who lives here into validated household personas—capturing quiet and privacy needs, fixed work hours, flexible activity windows, and even occasional guests."

---

## 0:55–1:20 — Live Here: Run Morning Routine (25s)

**Action:**
1. In the **Household Digital Twin** control panel, select **Morning Routine** (`1×` or `5×` speed) and click **Run Simulation**.
2. Point to the movement/status readout and the **Findings** panel.

**Say:**
> "Now we run the **Morning Routine**. Instead of asking an LLM whether this layout 'feels ergonomic,' our deterministic spatial engine routes household members through real doorways on a meter grid. Here it catches measurable friction—hallway path crossings and a kitchen congestion bottleneck near the refrigerator and counter."

---

## 1:20–1:45 — Stress Test the Home (25s)

**Action:**
1. Switch the scenario selector to **Dinner Party — 8 Guests** or **Fire Emergency** at `20×` speed and run.
2. Highlight the critical bottleneck finding in the **Findings** panel.

**Say:**
> "Because this is a digital twin, we can stress-test edge cases you don't think about on a Sunday apartment tour—like hosting eight dinner guests or checking whether an accent chair pinches the front-entry egress corridor."

---

## 1:45–2:10 — Gemini Redesign via `ScenePatch` (25s)

**Action:**
1. Show the redesign step / room edit action (moving or swapping movable furniture while clicking a locked fixture like the toilet or kitchen counter to show its `Fixed fixture · Locked` protection).

**Say:**
> "Gemini 4 reads those deterministic findings and proposes layout changes—moving the workspace away from noise, swapping an oversized chair, and widening the kitchen threshold—while deterministic guards block any edit to locked walls or plumbing."

---

## 2:10–2:30 — Replay & Before / After Proof (20s)

**Action:**
1. Re-run the same scenario and direct attention to the **Before / After** scorecard (`Movement`, `Privacy`, `Noise`, `Visibility`, `Safety` deltas).

**Say:**
> "We don't take Gemini's word that the redesign worked. We replay the exact same household schedule on the updated layout and verify measurable Before-and-After improvements across movement, noise, privacy, and clearance."

---

## 2:30–2:45 — Real Commerce & Close (15s)

**Action:**
1. Click **Save room & review products** (`Shopping list`) to show real Shopify merchant cards, variant prices, subtotal, and direct store links.

**Say:**
> "Every recommended furniture piece maps to source-backed Shopify merchant variants—excluding furniture you already own and locked fixtures—so you can go straight from a verified home layout to checkout.
>
> **Don't just visualize the home. Test your life inside it.**"
