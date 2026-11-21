// Let the browser paint the stage before starting or applying a layout.
const afterPaint = () => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)),
);

export async function runRestyle(dialog, input, apply) {
  const status = dialog.querySelector("[role=status]");
  const cancel = dialog.querySelector("button");
  status.textContent = "Step 1 of 3 · Reading your layout and budget…";
  cancel.disabled = false;
  dialog.showModal();
  let worker;
  try {
    worker = new Worker(new URL("./restyle-worker.js", import.meta.url), { type: "module" });
    const next = await new Promise((resolve, reject) => {
      cancel.onclick = () => reject(new DOMException("Canceled", "AbortError"));
      dialog.oncancel = event => {
        event.preventDefault();
        cancel.click();
      };
      worker.onerror = worker.onmessageerror = () => reject(new Error("Layout planner failed"));
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error("Layout planning failed"));
        else if (data.progress) status.textContent = "Step 2 of 3 · " + data.progress;
        else resolve(data.next);
      };
      afterPaint().then(() => worker?.postMessage(input)).catch(reject);
    });
    cancel.disabled = true;
    status.textContent = "Step 3 of 3 · Applying the layout to your scene…";
    await afterPaint();
    apply(next);
  } finally {
    worker?.terminate();
    worker = null;
    cancel.onclick = null;
    dialog.oncancel = null;
    dialog.close();
  }
}

function pieceKey(item) {
  return JSON.stringify([item.roomId, item.kind, item.productId, item.shopify?.variantId, item.name]);
}

function placement(item) {
  return JSON.stringify([item.x, item.z, item.rotation, item.color, item.width, item.depth, item.height]);
}

export function describeRestyle(previous, next) {
  const groups = new Map();
  for (const [side, items] of [["before", previous.items], ["after", next.items]]) {
    for (const item of items) {
      const key = pieceKey(item);
      if (!groups.has(key)) groups.set(key, { before: [], after: [] });
      groups.get(key)[side].push(placement(item));
    }
  }
  let added = 0, removed = 0, updated = 0;
  for (const { before, after } of groups.values()) {
    let unmatched = 0;
    for (const position of after) {
      const index = before.indexOf(position);
      if (index < 0) unmatched++;
      else before.splice(index, 1);
    }
    const changed = Math.min(before.length, unmatched);
    updated += changed;
    added += unmatched - changed;
    removed += before.length - changed;
  }
  const changes = [];
  if (added) changes.push(`${added} added`);
  if (removed) changes.push(`${removed} removed`);
  if (updated) changes.push(`${updated} updated`);
  if (previous.style !== next.style) changes.push(`style set to ${next.style}`);
  return changes.length ? "Layout updated · " + changes.join(", ") + "." :
    "No layout changes. Try a different style or adjust the furniture budget.";
}
