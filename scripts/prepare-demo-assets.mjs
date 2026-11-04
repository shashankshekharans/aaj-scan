import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDirectory = process.env.SYNTHETIC_CARDS_DIR ?? path.join(root, "Synthetic Cards");
const loginScreenshot = process.env.APP_SCREENSHOT_LOGIN;
const homeScreenshot = process.env.APP_SCREENSHOT_HOME;

if (!loginScreenshot || !homeScreenshot) {
  throw new Error("Set APP_SCREENSHOT_LOGIN and APP_SCREENSHOT_HOME to privacy-safe PNG or JPEG screenshots.");
}

const sourceCards = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
  .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

if (sourceCards.length !== 12) throw new Error(`Expected 12 synthetic cards, found ${sourceCards.length}.`);

const cardsDirectory = path.join(root, "demo", "synthetic-cards");
const documentationAssetsDirectory = path.join(root, "docs", "assets");
await Promise.all([cardsDirectory, documentationAssetsDirectory].map((directory) => mkdir(directory, { recursive: true })));

for (const [index, entry] of sourceCards.entries()) {
  const filename = `synthetic-card-${String(index + 1).padStart(2, "0")}.webp`;
  const output = path.join(cardsDirectory, filename);
  await sharp(path.join(sourceDirectory, entry.name))
    .rotate()
    .resize({ width: 1_400, height: 1_400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, smartSubsample: true, effort: 6 })
    .toFile(output);
}

for (const [source, filename] of [[loginScreenshot, "app-login.webp"], [homeScreenshot, "app-home.webp"]]) {
  await sharp(source)
    .rotate()
    .resize({ width: 1_400, height: 1_400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, smartSubsample: true, effort: 6 })
    .toFile(path.join(documentationAssetsDirectory, filename));
}

console.log("Prepared 12 synthetic cards and 2 application screenshots.");
