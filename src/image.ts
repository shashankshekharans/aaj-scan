import { createWorker, type Worker } from "tesseract.js";

let ocrWorker: Promise<Worker> | null = null;

const canvasBlob = (canvas: HTMLCanvasElement, quality = 0.85) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode image")), "image/jpeg", quality));

export async function prepareImage(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const originalLongEdge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const sampleWidth = Math.min(width, 320);
  const sampleHeight = Math.max(1, Math.round(height * sampleWidth / width));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true })!;
  sampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = new Float32Array(sampleWidth * sampleHeight);
  let brightness = 0;
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = 0.299 * pixels[p]! + 0.587 * pixels[p + 1]! + 0.114 * pixels[p + 2]!;
    brightness += gray[i]!;
  }
  brightness /= gray.length;
  let laplaceTotal = 0;
  let laplaceSquared = 0;
  let count = 0;
  for (let y = 1; y < sampleHeight - 1; y++) {
    for (let x = 1; x < sampleWidth - 1; x++) {
      const i = y * sampleWidth + x;
      const value = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - sampleWidth]! - gray[i + sampleWidth]!;
      laplaceTotal += value;
      laplaceSquared += value * value;
      count++;
    }
  }
  const variance = count ? laplaceSquared / count - (laplaceTotal / count) ** 2 : 0;
  let warning: string | undefined;
  if (originalLongEdge < 800) warning = "This photo is quite small. Retaking it closer may improve accuracy.";
  else if (brightness < 45) warning = "This photo looks dark. Retaking it in brighter light may improve accuracy.";
  else if (variance < 45) warning = "This photo may be blurry. Hold the phone steady and retake if possible.";
  return { blob: await canvasBlob(canvas), warning };
}

async function cropForOcr(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const sx = Math.floor(bitmap.width * 0.08);
  const sy = Math.floor(bitmap.height * 0.15);
  const sw = Math.floor(bitmap.width * 0.84);
  const sh = Math.floor(bitmap.height * 0.70);
  const scale = Math.min(2000 / sw, 2000 / sh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasBlob(canvas, 0.9);
}

export async function runCombinedOcr(blob: Blob, onProgress?: (progress: number) => void) {
  ocrWorker ??= createWorker("eng", undefined, { logger: (event) => {
    if (event.status === "recognizing text") onProgress?.(event.progress);
  }});
  const worker = await ocrWorker;
  const full = await worker.recognize(blob);
  const cropped = await worker.recognize(await cropForOcr(blob));
  return `${full.data.text}\n${cropped.data.text}`;
}

export async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
