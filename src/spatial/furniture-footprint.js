import { isFinitePoint2D } from "./floorplan-geometry.js";

function validPolygon(points) {
  return Array.isArray(points) && points.length >= 3 && points.every(isFinitePoint2D);
}

// Normalized local coordinates keep measured, irregular outlines through edits and reloads.
function localOutline(object) {
  if (validPolygon(object.localFootprint)) return object.localFootprint;
  if (!validPolygon(object.footprint)) {
    return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  }
  const yaw = object.rotationRadians[1];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return object.footprint.map(([worldX, worldZ]) => {
    const x = worldX - object.x;
    const z = worldZ - object.z;
    return [(x * cos - z * sin) / object.width, (x * sin + z * cos) / object.depth];
  });
}

// Both arguments are normalized SceneObjects. Three.js rotates around +Y in the X/Z floor plane.
export function withFurnitureFootprint(object, shapeSource = object) {
  const localFootprint = localOutline(shapeSource);
  const yaw = object.rotationRadians[1];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const footprint = localFootprint.map(([localX, localZ]) => {
    const x = localX * object.width;
    const z = localZ * object.depth;
    return [object.x + x * cos + z * sin, object.z - x * sin + z * cos];
  });
  return { ...object, localFootprint, footprint };
}
