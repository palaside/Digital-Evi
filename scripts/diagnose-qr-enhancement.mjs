import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import jsQR from "jsqr";
import sharp from "sharp";
import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { enhanceOcrPixels } from "../src/utils/enhance-for-ocr.mjs";
import { cropQrPixelRegion, decodeQrWithEnhancedPixels, decodeQrWithUpscaleFallback, scaleQrPixelsNearest } from "../src/utils/qr-decoder-fallback.mjs";
import { traceQrDecodeAttempt } from "../src/utils/qr-extractor-failure.mjs";

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: node scripts/diagnose-qr-enhancement.mjs <image-path> [--roi x,y,width,height] [--output trace.json]\n");
  process.exit(2);
}

const sourceBytes = await readFile(inputPath);
const decodedImage = await sharp(sourceBytes).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sourceDimensions = { width: decodedImage.info.width, height: decodedImage.info.height };
const sourcePixels = new Uint8ClampedArray(decodedImage.data.buffer, decodedImage.data.byteOffset, decodedImage.data.byteLength);
const roiIndex = process.argv.indexOf("--roi");
const outputIndex = process.argv.indexOf("--output");
const regionValues = roiIndex < 0 ? null : process.argv[roiIndex + 1]?.split(",").map(Number);
if (roiIndex >= 0 && (!regionValues || regionValues.length !== 4 || regionValues.some((value) => !Number.isInteger(value)))) {
  throw new Error("--roi requires four integer pixel coordinates: x,y,width,height");
}
const region = regionValues ? { x: regionValues[0], y: regionValues[1], width: regionValues[2], height: regionValues[3] } : null;
const input = region ? cropQrPixelRegion(sourcePixels, sourceDimensions.width, sourceDimensions.height, region)
  : { data: sourcePixels, ...sourceDimensions };
const { width, height } = input;
const pixels = input.data;
const scale = width <= 900 ? Math.min(1.5, 1800 / width, 1800 / height) : 1;
const productionScans = [];

async function decodeZxing(rgba, imageWidth, imageHeight) {
  const luminance = new Uint8ClampedArray(imageWidth * imageHeight);
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    luminance[index] = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114);
  }
  const source = new RGBLuminanceSource(luminance, imageWidth, imageHeight, imageWidth, imageHeight, 0, 0);
    const result = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
    const points = result.getResultPoints();
    if (points.length < 3) return null;
    const xs = points.map((point) => point.getX());
    const ys = points.map((point) => point.getY());
    return {
      data: result.getText(),
      location: {
        topLeftCorner: { x: Math.min(...xs), y: Math.min(...ys) },
        topRightCorner: { x: Math.max(...xs), y: Math.min(...ys) },
        bottomLeftCorner: { x: Math.min(...xs), y: Math.max(...ys) },
        bottomRightCorner: { x: Math.max(...xs), y: Math.max(...ys) },
      },
    };
}

async function decodePixels(data, imageWidth, imageHeight, enhanced = false) {
  const scaled = scale > 1 ? scaleQrPixelsNearest(data, imageWidth, imageHeight, scale) : null;
  const run = (decoder, rgba, w, h, appliedScale, stage) => traceQrDecodeAttempt(
    () => decoder === "jsQR" ? jsQR(rgba, w, h, { inversionAttempts: "attemptBoth" }) : decodeZxing(rgba, w, h),
    { decoder, width: w, height: h, scale: appliedScale, stage, candidateIndex: 0 },
    (attempt) => productionScans.push(attempt),
  );
  return decodeQrWithUpscaleFallback(
    () => run("jsQR", data, imageWidth, imageHeight, 1, enhanced ? "enhanced" : "original"),
    () => run("ZXing", data, imageWidth, imageHeight, 1, enhanced ? "enhanced" : "original"),
    () => scaled ? run("jsQR", scaled.data, scaled.width, scaled.height, scale, enhanced ? "enhanced-upscaled" : "upscaled") : null,
    () => scaled ? run("ZXing", scaled.data, scaled.width, scaled.height, scale, enhanced ? "enhanced-upscaled" : "upscaled") : null,
    scale,
  );
}

const original = await decodePixels(pixels, width, height);
const enhanced = original ? null : await decodeQrWithEnhancedPixels(
  pixels,
  width,
  height,
  enhanceOcrPixels,
  (data, w, h) => decodePixels(data, w, h, true),
);
const result = original ?? enhanced?.result ?? null;
const payloadDigest = result?.data
  ? createHash("sha256").update(result.data, "utf8").digest("hex")
  : null;

const report = {
  schema: "digital-evidence.qr-pixel-diagnostic.v1",
  runtime: "Node + sharp pixels; app decoder helpers; not a browser canvas capture",
  input: path.resolve(inputPath),
  sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  sourceDimensions,
  cropBounds: region ?? { x: 0, y: 0, ...sourceDimensions },
  inputPixelSha256: createHash("sha256").update(pixels).digest("hex"),
  width,
  height,
  originalDecoded: Boolean(original),
  enhancementAttempted: !original,
  enhancementStages: enhanced?.stages ?? [],
  enhancedDecoded: Boolean(enhanced?.result),
  route: result ? `${result.decoder === "primary" ? "jsQR" : "ZXing"}/${result.enhanced ? "enhanced" : result.resolution}` : null,
  payloadSha256: payloadDigest,
  candidateCount: result ? 1 : 0,
  productionScans,
  decoderErrors: productionScans.filter((attempt) => attempt.outcome === "error").length,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) throw new Error("--output requires a JSON file path");
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
