// Generates the optimised logos and app icons in public/ from the source
// artwork in brand/. Run with `npm run brand:assets` after changing a logo.

import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const RED = "#c22028";
const SOURCE = { mark: "brand/aaj-logo.png", wordmark: "brand/aaj-scan-logo.png" };

await mkdir("public", { recursive: true });

// Header wordmark: rendered 30px tall, so ship 2x and 3x widths.
const wordmark = await sharp(SOURCE.wordmark).trim().toBuffer();
for (const height of [60, 90]) {
  await sharp(wordmark).resize({ height }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(`public/aaj-scan-logo-${height}.webp`);
}

// Login logo: rendered 132px wide, so ship 2x and 3x widths.
const mark = await sharp(SOURCE.mark).trim().toBuffer();
for (const width of [264, 396]) {
  await sharp(mark).resize({ width }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(`public/aaj-logo-${width}.webp`);
}

// White AAJ mark used inside the icons.
const markMask = await sharp(SOURCE.mark).trim().ensureAlpha().extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
const whiteMark = (width) =>
  sharp({ create: { width: markMask.info.width, height: markMask.info.height, channels: 3, background: "#fff" } })
    .joinChannel(markMask.data, { raw: { width: markMask.info.width, height: markMask.info.height, channels: 1 } })
    .png()
    .toBuffer()
    .then((b) => sharp(b).resize({ width }).toBuffer());

/** Red tile with the white mark centred; `radius` 0 gives a full-bleed maskable icon. */
async function icon(size, { radius, markRatio }) {
  const mark = await whiteMark(Math.round(size * markRatio));
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${RED}"/></svg>`,
  );
  return sharp(tile).composite([{ input: mark, gravity: "center" }]).png({ compressionLevel: 9, palette: true });
}

// "any" icons keep rounded corners; the maskable icon fills the square and keeps
// the mark inside Android's 80% safe zone, which also styles the launch screen.
await (await icon(512, { radius: 64, markRatio: 0.74 })).toFile("public/favicon-512.png");
await (await icon(192, { radius: 24, markRatio: 0.74 })).toFile("public/favicon-192.png");
await (await icon(32, { radius: 6, markRatio: 0.8 })).toFile("public/favicon-32.png");
await (await icon(180, { radius: 0, markRatio: 0.66 })).toFile("public/apple-touch-icon.png");
await (await icon(512, { radius: 0, markRatio: 0.56 })).toFile("public/icon-maskable-512.png");

console.log("Brand assets written to public/.");
