import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const cards = Array.from({ length: 12 }, (_, index) =>
  path.join(root, "demo", "synthetic-cards", `synthetic-card-${String(index + 1).padStart(2, "0")}.webp`),
);
const screenshots = ["app-login.webp", "app-home.webp"].map((file) => path.join(root, "docs", "assets", file));
const demos = [
  { file: "contact-scan-demo.gif", width: 430, height: 900 },
  { file: "contact-scan-desktop-demo.gif", width: 960, height: 600 },
];

for (const file of [...cards, ...screenshots]) {
  const details = await stat(file);
  if (details.size > 500_000) throw new Error(`${path.relative(root, file)} exceeds 500 KB`);
  const metadata = await sharp(file).metadata();
  if (metadata.format !== "webp") throw new Error(`${path.relative(root, file)} is not WebP`);
  if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 1_400) {
    throw new Error(`${path.relative(root, file)} has invalid dimensions`);
  }
  if (metadata.exif || metadata.icc || metadata.xmp || metadata.iptc) {
    throw new Error(`${path.relative(root, file)} still contains metadata`);
  }
}

for (const demo of demos) {
  const file = path.join(root, "docs", "assets", demo.file);
  const details = await stat(file);
  if (details.size > 2_000_000) throw new Error(`${path.relative(root, file)} exceeds 2 MB`);
  const metadata = await sharp(file, { animated: true }).metadata();
  if (metadata.format !== "gif") throw new Error(`${path.relative(root, file)} is not GIF`);
  if (metadata.width !== demo.width || metadata.pageHeight !== demo.height || (metadata.pages ?? 0) < 2) {
    throw new Error(`${path.relative(root, file)} has invalid animated dimensions`);
  }
}

console.log(
  `Verified ${cards.length} synthetic cards, ${screenshots.length} app screenshots and ${demos.length} annotated GIFs.`,
);
