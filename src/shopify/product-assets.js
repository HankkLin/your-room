// Product-level media is usable when exactly one model belongs to the returned variant.
export function glbUrl(value) {
  if (typeof value !== "string" || /[\\\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && /\.glb$/i.test(url.pathname) ? value : null;
  } catch {
    return null;
  }
}

function models(media) {
  if (!Array.isArray(media)) return [];
  return media.filter((entry) => entry?.type === "model_3d").map((entry) => {
    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    return sources.map((source) => glbUrl(source?.url)).find(Boolean) ?? glbUrl(entry.url);
  }).filter(Boolean);
}

export function productAssetFields(product, variant) {
  const variantModel = models(variant.media)[0];
  const fields = {};
  if (variantModel) {
    fields.modelUrl = variantModel;
    fields.modelScope = "variant";
  } else if (product.variants?.length === 1 && product.variants[0] === variant) {
    const productModels = [...new Set(models(product.media))];
    if (productModels.length === 1) {
      fields.modelUrl = productModels[0];
      fields.modelScope = "product";
    }
  }
  const dimensions = variant.dimensions;
  const factor = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 }[dimensions?.unit];
  const axes = ["width", "depth", "height"];
  if (Number.isFinite(factor) && axes.every((axis) => Number.isFinite(dimensions[axis]) && dimensions[axis] > 0)) {
    fields.dimensions = Object.fromEntries(axes.map((axis) => [axis, dimensions[axis] * factor]));
    fields.dimensionsSource = "merchant";
  }
  return fields;
}

export function dimensionLabel(item) {
  const size = [item.width, item.depth, item.height].map((length) => Number(length).toFixed(2)).join(" × ");
  return (item.dimensionsSource === "merchant" ? "Merchant dimensions" : "Estimated dimensions") + " · " + size + " m (W × D × H)";
}
