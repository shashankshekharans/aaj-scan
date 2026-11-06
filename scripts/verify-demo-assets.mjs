import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const cards = Array.from({ length: 12 }, (_, index) =>
  path.join(root, "demo", "synthetic-cards", `synthetic-card-${String(index + 1).padStart(2, "0")}.webp`),
);
const readmeImages = ["readme-hero.webp", "aaj-scan-logo-dark.webp"].map((file) => path.join(root, "docs", "assets", file));
const demos = [
  { file: "contact-scan-demo.webp", width: 430, height: 764 },
  { file: "contact-scan-desktop-demo.webp", width: 960, height: 540 },
];

for (const file of [...cards, ...readmeImages]) {
  const details = await stat(file);
  if (details.size > 500_000) throw new Error(`${path.relative(root, file)} exceeds 500 KB`);
  const metadata = await sharp(file).metadata();
  if (metadata.format !== "webp") throw new Error(`${path.relative(root, file)} is not WebP`);
  if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 1_600) {
    throw new Error(`${path.relative(root, file)} has invalid dimensions`);
  }
  if (metadata.exif || metadata.icc || metadata.xmp || metadata.iptc) {
    throw new Error(`${path.relative(root, file)} still contains metadata`);
  }
}

for (const demo of demos) {
  const file = path.join(root, "docs", "assets", demo.file);
  const details = await stat(file);
  if (details.size > 1_500_000) throw new Error(`${path.relative(root, file)} exceeds 1.5 MB`);
  const metadata = await sharp(file, { animated: true }).metadata();
  if (metadata.format !== "webp") throw new Error(`${path.relative(root, file)} is not animated WebP`);
  if (metadata.width !== demo.width || metadata.pageHeight !== demo.height || (metadata.pages ?? 0) < 2) {
    throw new Error(`${path.relative(root, file)} has invalid animated dimensions`);
  }
}

console.log(
  `Verified ${cards.length} synthetic cards, ${readmeImages.length} README images and ${demos.length} animated demos.`,
);
