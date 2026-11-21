# Demo Backup & Failure Recovery Plan

Use this quick playbook during live judging if an external API, upload, network connection, or display adapter misbehaves. **Never fabricate live results—switch cleanly to the deterministic local path.**

---

## 1. Gemini API Timeout, Quota, or Missing Key (`503` / Network Error)

- **Floorplan Importer**:
  - The importer UI automatically surfaces `#fp-analysis-failed` with recovery buttons.
  - Click **Load sample floorplan** (`#fp-fallback-sample`) to load the deterministic 5-room **Mercer Street Apartment** (`9.6 × 8.6 m`, 6 doors, 4 windows, 7 locked fixtures), or click **Calibrate manually** (`#fp-fallback-manual`).
- **Household Personas**:
  - On step **2 · Household**, click **Load sample household** (`#sample-household`)—works 100% offline with zero Gemini calls and passes full schedule validation.

---

## 2. Live Floorplan Image Upload Fails or Lacks Printed Dimensions

- **If image lacks printed dimensions**:
  - Show this as a **feature, not a bug**: explain that the validator intentionally blocks uncalibrated scale (`Calibration required`), click two wall endpoints on the SVG overlay, enter a known room width (meters or feet/inches), and click **Apply calibration**.
- **If file upload itself fails**:
  - Click **Back** → **Try sample whole-home floorplan →** (or **Try whole-home demo →** on Setup) to jump immediately into a pre-validated multi-room 3D house.

---

## 3. Shopify / External Merchant CDN Issue

- `offers.json` already stores captured Shopify product titles, variant URLs, store names, and USD prices locally, so subtotal calculation and shopping-list cards work even if external merchant CDNs are slow.
- If live network access is down during the pitch, show the **Shopping list** subtotal and variant URLs without clicking external merchant tabs, and state clearly that live merchant stock/checkout requires internet connectivity.

---

## 4. Complete Wi-Fi / Network Outage at Venue

Run the 100% local deterministic loop (`npm run dev` on `127.0.0.1`):

```text
Try sample whole-home floorplan (or Try whole-home demo)
    ↓
Validated House JSON (local validator)
    ↓
Whole-Home 3D Twin (Orbit + W/A/S/D)
    ↓
Sample Household Personas (local resolver)
    ↓
Deterministic Simulation & Findings
```

Everything in the geometry validator, Three.js renderer, schedule resolver, navigation grid, and A* simulation runs locally with zero internet dependency.

---

## 5. Projector / Laptop GPU WebGL Context Failure

- Stillroom automatically catches WebGL initialization failures in `app.js` and falls back to `scene-fallback.js`—an interactive **2D Canvas Top-Down Floor Plan** that renders multi-room polygons, walls, doors, windows, locked fixtures, and draggable movable furniture.
- You can also click **Floor plan** (`#view-plan`) at any time for crisp overhead architectural clarity on low-contrast venue projectors.
