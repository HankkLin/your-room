const furnitureClasses = {
  couch: { kind: "sofa", name: "Sofa" },
  chair: { kind: "chair", name: "Chair" },
  "dining table": { kind: "table", name: "Table" },
  bed: { kind: "bed", name: "Bed" },
  "potted plant": { kind: "plant", name: "Plant" },
};

let detectorPromise;

async function loadDetector() {
  const [tf, cocoSsd] = await Promise.all([
    import("@tensorflow/tfjs-core"),
    import("@tensorflow-models/coco-ssd"),
    import("@tensorflow/tfjs-backend-cpu"),
  ]);
  await tf.setBackend("cpu");
  const modelUrl = `${import.meta.env.BASE_URL}assets/detector/model.json`;
  return cocoSsd.load({ modelUrl });
}

async function decodePhoto(file) {
  const photoUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = photoUrl;
    await image.decode();

    const scale = Math.min(
      1,
      720 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(photoUrl);
  }
}

export async function detectFurnishings(file, onStatus = () => {}) {
  if (!detectorPromise) {
    onStatus("Loading local photo model…");
    detectorPromise = loadDetector().catch((error) => {
      detectorPromise = undefined;
      throw error;
    });
  }

  const [detector, photo] = await Promise.all([
    detectorPromise,
    decodePhoto(file),
  ]);
  onStatus("Looking for furniture…");
  const predictions = await detector.detect(photo, 30, 0.45);
  const grouped = new Map();

  for (const prediction of predictions) {
    const furnishing = furnitureClasses[prediction.class];
    if (!furnishing) continue;

    const [left, top, width, height] = prediction.bbox;
    // Estimate upholstery or finish from the central patch of the detected object.
    const x = Math.max(
      0,
      Math.min(photo.width - 1, Math.round(left + width * 0.35)),
    );
    const y = Math.max(
      0,
      Math.min(photo.height - 1, Math.round(top + height * 0.43)),
    );
    const pixels = photo
      .getContext("2d")
      .getImageData(
        x,
        y,
        Math.max(1, Math.min(photo.width - x, Math.round(width * 0.3))),
        Math.max(1, Math.min(photo.height - y, Math.round(height * 0.23))),
      ).data;
    const channels = [[], [], []];
    for (let i = 0; i < pixels.length; i += 16)
      for (let j = 0; j < 3; j++) channels[j].push(pixels[i + j]);
    const color =
      "#" +
      channels
        .map((values) =>
          values
            .sort((a, b) => a - b)
            [Math.floor(values.length / 2)].toString(16)
            .padStart(2, "0"),
        )
        .join("");
    // Bottom center approximates floor contact in normalized photo coordinates.
    const position = {
      x: Math.max(0, Math.min(1, (left + width / 2) / photo.width)),
      y: Math.max(0, Math.min(1, (top + height) / photo.height)),
      color,
      aspectRatio: width / height,
    };
    const group = grouped.get(furnishing.kind) ?? {
      ...furnishing,
      count: 0,
      positions: [],
    };
    group.positions.push(position);
    group.count = group.positions.length;
    grouped.set(furnishing.kind, group);
  }

  return [...grouped.values()];
}
