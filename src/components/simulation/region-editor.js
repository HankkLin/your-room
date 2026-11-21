import { normalizeHouse, mergeHouseFixturesIntoItems } from "../../../house-model.js";
import { toSceneObject } from "../../contracts/scene.js";
import { regionContainsItem } from "../../agents/region-redesign.js";

const svgNS = "http://www.w3.org/2000/svg";

function shape(name, attributes) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export function createRegionEditor(host, { onChange, onRequest }) {
  host.innerHTML = `<details class="region-editor"><summary>Edit a selected area</summary>
    <p>Drag a box around the furniture and its intended destination, or choose a room.</p>
    <div class="region-controls">
      <svg class="region-map" aria-label="Select a redesign area on the floor plan" role="img">
        <g class="region-geometry"></g><rect class="region-selection" visibility="hidden"></rect>
      </svg>
      <div class="region-fields"><label>Room selection<select><option value="">Custom area</option></select></label>
        <output aria-live="polite"></output>
        <label>Redesign instruction<textarea maxlength="800" rows="3" placeholder="Move the sofa away from the doorway"></textarea></label>
        <button type="button" class="secondary">Preview regional redesign</button>
      </div>
    </div></details>`;
  const details = host.querySelector("details");
  const map = host.querySelector("svg");
  const geometry = host.querySelector(".region-geometry");
  const highlight = host.querySelector(".region-selection");
  const rooms = host.querySelector("select");
  const instruction = host.querySelector("textarea");
  const output = host.querySelector("output");
  const send = host.querySelector("button");
  let itemRef, house, pieces = [], region = null, drag = null, busy = false;

  function showSelection(bounds) {
    highlight.setAttribute("visibility", bounds ? "visible" : "hidden");
    if (bounds) {
      const [x, z, maxX, maxZ] = bounds;
      for (const [key, value] of Object.entries({ x, y: z, width: maxX - x, height: maxZ - z })) {
        highlight.setAttribute(key, value);
      }
    }
  }

  function refresh() {
    const count = region ? pieces.filter(item => !item.locked && regionContainsItem(region, item)).length : 0;
    output.textContent = region ? count + (count === 1 ? " movable piece selected" : " movable pieces selected") : "Select an area.";
    send.disabled = busy || !count || !instruction.value.trim();
  }

  function select(bounds) {
    region = bounds;
    showSelection(bounds);
    onChange();
    refresh();
  }

  function worldPoint(event) {
    const transform = map.getScreenCTM();
    if (!transform || !house) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    const { minX, minZ, maxX, maxZ } = house.bounds;
    return [Math.max(minX, Math.min(maxX, point.x)), Math.max(minZ, Math.min(maxZ, point.y))];
  }

  function rectangle(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  map.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const start = worldPoint(event);
    if (!start) return;
    drag = { id: event.pointerId, start };
    map.setPointerCapture(event.pointerId);
    rooms.value = "";
    select(null);
  });
  map.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) showSelection(rectangle(drag.start, worldPoint(event)));
  });
  map.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const bounds = rectangle(drag.start, worldPoint(event));
    drag = null;
    select(bounds[2] - bounds[0] > 0.01 && bounds[3] - bounds[1] > 0.01 ? bounds : null);
  });
  map.addEventListener("pointercancel", () => { drag = null; select(null); });
  rooms.addEventListener("change", () => {
    const box = house.rooms.find(room => room.id === rooms.value)?.bounds;
    select(box ? [box.minX, box.minZ, box.maxX, box.maxZ] : null);
  });
  instruction.addEventListener("input", () => { onChange(); refresh(); });
  send.addEventListener("click", () => {
    if (!send.disabled) onRequest({ region: [...region], instruction: instruction.value.trim() });
  });

  function update(context, available, disabled) {
    host.hidden = !available;
    busy = disabled;
    if (available && (!house || context.items !== itemRef)) {
      itemRef = context.items;
      house = normalizeHouse(context.house);
      pieces = mergeHouseFixturesIntoItems(house, itemRef).map(toSceneObject);
      const { minX, minZ, maxX, maxZ } = house.bounds;
      map.setAttribute("viewBox", [minX - .15, minZ - .15, maxX - minX + .3, maxZ - minZ + .3].join(" "));
      geometry.replaceChildren();
      rooms.replaceChildren(new Option("Custom area", ""));
      for (const room of house.rooms) {
        geometry.append(shape("polygon", { points: room.polygon.map(p => p.join(",")).join(" ") }));
        const name = shape("text", { x: room.bounds.centerX, y: room.bounds.centerZ, "text-anchor": "middle" });
        name.textContent = room.name;
        geometry.append(name);
        rooms.add(new Option(room.name, room.id));
      }
      for (const item of pieces) {
        const rect = shape("rect", {
          x: item.x - item.width / 2, y: item.z - item.depth / 2,
          width: item.width, height: item.depth, transform: "rotate(" + (-item.rotation) + " " + item.x + " " + item.z + ")",
          class: item.locked ? "region-fixed" : "region-movable",
        });
        const title = shape("title", {});
        title.textContent = item.name || item.kind;
        rect.append(title);
        geometry.append(rect);
      }
      region = null;
      showSelection(null);
    }
    refresh();
  }

  function reset() {
    drag = null;
    region = null;
    house = null;
    itemRef = null;
    details.open = false;
    instruction.value = "";
    showSelection(null);
  }

  return { update, reset };
}
