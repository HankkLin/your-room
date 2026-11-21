import { polygonBounds } from "../spatial/floorplan-geometry.js";

const AGENT_COLORS = ["#b84a2e", "#2e668c", "#4d7c46", "#824c8a", "#9c6d27"];

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );

function formatClock(minute) {
  const total = Math.max(0, Math.round(Number(minute) || 0));
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Render a lightweight standalone 2D top-down SVG debug visualization of:
 * - rooms & walls
 * - locked fixtures & placed objects
 * - doors
 * - A* movement routes per household member
 * - collision points & congestion zones
 *
 * Operates purely on plain data (works in Node.js and browser without Three.js).
 */
export function renderSimulationDebugSvg(house, simulation, options = {}) {
  const scale = Number(options.pixelsPerMeter ?? 64);
  const margin = 36;
  const allPts = (house?.rooms ?? []).flatMap((r) => r.polygon || []);
  const bounds = house?.bounds?.width ? house.bounds : polygonBounds(allPts);

  const svgWidth = Math.ceil(bounds.width * scale + margin * 2);
  const svgHeight = Math.ceil(bounds.depth * scale + margin * 2);

  const tx = (x) => ((x - bounds.minX) * scale + margin).toFixed(1);
  const tz = (z) => ((z - bounds.minZ) * scale + margin).toFixed(1);

  const agentColorMap = new Map();
  (simulation?.agents ?? []).forEach((agent, idx) => {
    agentColorMap.set(agent.id, AGENT_COLORS[idx % AGENT_COLORS.length]);
  });

  const roomMarkup = (house?.rooms ?? [])
    .map((room) => {
      const pts = room.polygon.map(([x, z]) => `${tx(x)},${tz(z)}`).join(" ");
      const rb = polygonBounds(room.polygon);
      const cx = tx((rb.minX + rb.maxX) / 2);
      const cz = tz((rb.minZ + rb.maxZ) / 2);
      return (
        `<polygon points="${pts}" fill="#f5f2e9" stroke="#363931" stroke-width="3"/>` +
        `<text x="${cx}" y="${cz}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" fill="#464940">${esc(room.name)}</text>`
      );
    })
    .join("");

  const fixtureMarkup = (house?.fixtures ?? [])
    .map((fix) => {
      if (!Array.isArray(fix.footprint) || fix.footprint.length < 3) return "";
      const pts = fix.footprint.map(([x, z]) => `${tx(x)},${tz(z)}`).join(" ");
      return `<polygon points="${pts}" fill="#d6cfc2" stroke="#645f55" stroke-width="1.4"/>`;
    })
    .join("");

  const doorMarkup = (house?.doors ?? [])
    .map((door) => {
      const color = door.kind === "exterior" ? "#994731" : "#c78b3b";
      return `<circle cx="${tx(door.position[0])}" cy="${tz(door.position[1])}" r="5.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    })
    .join("");

  const routeMarkup = (simulation?.routes ?? [])
    .map((route) => {
      const color = agentColorMap.get(route.agentId) || AGENT_COLORS[0];
      const d = route.path
        .map(([x, z], idx) => `${idx === 0 ? "M" : "L"}${tx(x)} ${tz(z)}`)
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.82"/>`;
    })
    .join("");

  const congestionMarkup = (simulation?.findings ?? [])
    .filter((f) => f.type === "CONGESTION" && f.location?.position)
    .map((finding) => {
      const [x, z] = finding.location.position;
      const rPx = (1.1 * scale).toFixed(1);
      return (
        `<circle cx="${tx(x)}" cy="${tz(z)}" r="${rPx}" fill="rgba(214, 114, 41, 0.18)" stroke="#c75c1e" stroke-width="2" stroke-dasharray="5 4"/>` +
        `<text x="${tx(x)}" y="${(Number(tz(z)) - 8).toFixed(1)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="10" font-weight="700" fill="#8f3809">CONGESTION (${finding.evidence.durationSeconds}s)</text>`
      );
    })
    .join("");

  const collisionMarkup = (simulation?.events ?? [])
    .filter((e) => e.type === "AGENT_COLLISION" && e.position)
    .map(
      (ev) =>
        `<circle cx="${tx(ev.position[0])}" cy="${tz(ev.position[1])}" r="7" fill="#b82525" stroke="#fff" stroke-width="1.8"/>`,
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">` +
    `<rect width="${svgWidth}" height="${svgHeight}" fill="#fbfaf6"/>` +
    roomMarkup +
    fixtureMarkup +
    congestionMarkup +
    routeMarkup +
    doorMarkup +
    collisionMarkup +
    `</svg>`
  );
}

/**
 * Format a deterministic plain-text diagnostic report of a simulation run.
 */
export function formatSimulationDebugReport(simulation) {
  const lines = [
    `Simulation Window: ${formatClock(simulation.startMinute)} -> ${formatClock(simulation.endMinute)} (step=${simulation.stepSeconds}s)`,
    `Agents (${simulation.agents.length}):`,
  ];

  for (const agent of simulation.agents) {
    const dist = simulation.summary.totalDistanceMeters[agent.id] ?? 0;
    lines.push(
      `  - ${agent.name} (${agent.id}): ${dist.toFixed(2)} m walked | final room=${agent.finalRoomId} (${agent.finalActivity})`,
    );
  }

  lines.push(
    `Routes Planned: ${simulation.routes.length} | Path Failures: ${simulation.summary.pathFailures} | Collisions: ${simulation.summary.collisions} | Congestion Events: ${simulation.summary.congestionEvents}`,
  );

  if (simulation.findings.length > 0) {
    lines.push("Findings:");
    for (const f of simulation.findings) {
      if (f.type === "CONGESTION") {
        lines.push(
          `  * [CONGESTION] room=${f.roomId} severity=${f.severity} agents=${f.evidence.agentCount} duration=${f.evidence.durationSeconds}s minClearance=${f.evidence.minimumClearanceMeters}m`,
        );
      } else if (f.type === "NO_PATH") {
        lines.push(
          `  * [NO_PATH] agent=${f.agentId} ${f.fromRoomId} -> ${f.toRoomId} (${f.activity})`,
        );
      } else if (f.type === "LONG_PATH") {
        lines.push(
          `  * [LONG_PATH] agent=${f.agentId} ${f.fromRoomId} -> ${f.toRoomId} dist=${f.distanceMeters}m severity=${f.severity}`,
        );
      }
    }
  } else {
    lines.push("Findings: none");
  }

  return lines.join("\n");
}
