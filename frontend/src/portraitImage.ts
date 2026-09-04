const BACKGROUND_TOLERANCE = 52;

export async function prepareGeneratedPortrait(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const changed = removeConnectedLightBackground(image.data, bitmap.width, bitmap.height);
    if (!changed) return blob;
    context.putImageData(image, 0, 0);
    return await canvasBlob(canvas, "image/png");
  } finally {
    bitmap.close();
  }
}

export function removeConnectedLightBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return false;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let changed = false;

  const enqueue = (index: number) => {
    if (visited[index] || !isBackgroundPixel(pixels, index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const offset = index * 4;
    if (pixels[offset + 3] !== 0) {
      pixels[offset + 3] = 0;
      changed = true;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  return changed;
}

function isBackgroundPixel(pixels: Uint8ClampedArray, index: number): boolean {
  const offset = index * 4;
  const alpha = pixels[offset + 3];
  if (alpha < 16) return true;
  const redDistance = 255 - pixels[offset];
  const greenDistance = 255 - pixels[offset + 1];
  const blueDistance = 255 - pixels[offset + 2];
  return Math.max(redDistance, greenDistance, blueDistance) <= BACKGROUND_TOLERANCE;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法处理角色立绘背景。"));
    }, type);
  });
}
