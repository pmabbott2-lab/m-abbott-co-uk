import fs from "node:fs";
import path from "node:path";
import RunwayML from "@runwayml/sdk";

const imagePath = process.argv[2];
const outputPath = process.argv[3];
const promptText =
  process.argv[4] ||
  "A gentle cinematic push-in. The first-time buyer smiles with quiet relief and looks from the borrowing illustration to her mortgage advisor. The advisor listens, nods and points softly at the screen. Natural human gestures, warm daylight, calm reassuring pace, preserve the people and composition, no new text or logos.";
const duration = Number(process.argv[5] || 5);

if (!imagePath || !outputPath) {
  throw new Error("Usage: node scripts/generate-runway-proof.mjs <image> <output> <prompt>");
}

if (!process.env.RUNWAYML_API_SECRET) {
  throw new Error("RUNWAYML_API_SECRET is not available to this process.");
}

const client = new RunwayML();
const uploaded = await client.uploads.createEphemeral({
  file: fs.createReadStream(imagePath),
});

const task = await client.imageToVideo
  .create({
    model: "gen4_turbo",
    promptImage: uploaded.uri,
    promptText,
    ratio: "1280:720",
    duration,
  })
  .waitForTaskOutput();

const videoUrl = task.output?.[0];
if (!videoUrl) throw new Error("Runway completed without a video output.");

const response = await fetch(videoUrl);
if (!response.ok) throw new Error(`Video download failed: ${response.status}`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
console.log(`Saved ${outputPath}`);
