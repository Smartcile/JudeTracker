import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { HttpError } from "../lib/http.ts";

const FULL_WIDTH = 1920;
const THUMB_WIDTH = 480;

/** HEVC-coded HEIF brands; sharp's prebuilt libvips cannot decode these. */
const HEIC_BRANDS = new Set(["mif1", "msf1", "heic", "heix", "hevc", "hevx"]);

/** Major brand of an ISO-BMFF (HEIF/AVIF) file, lowercased, or null for other containers. */
export function ftypBrand(buffer: Buffer): string | null {
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") return null;
  return buffer.toString("ascii", 8, 12).replace(/\0/g, " ").trim().toLowerCase();
}

export function isHeic(buffer: Buffer): boolean {
  const brand = ftypBrand(buffer);
  return brand != null && HEIC_BRANDS.has(brand);
}

export function logDir(logId: number): string {
  return path.join(config.dataDir, "photos", `log-${logId}`);
}

async function openImage(buffer: Buffer): Promise<sharp.Sharp> {
  if (isHeic(buffer)) {
    const { default: decode } = await import("heic-decode");
    const image = await decode({ buffer });
    const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    return sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } });
  }
  const image = sharp(buffer, { failOn: "none" });
  await image.metadata();
  return image;
}

/**
 * Normalizes any accepted photo to a 1920px JPEG (EXIF kept) plus a 480px
 * thumbnail. Originals are not stored: HEIC is decoded in-process, everything
 * else through sharp.
 */
export async function storePhoto(logId: number, original: Buffer): Promise<void> {
  const dir = logDir(logId);
  await fs.mkdir(dir, { recursive: true });
  let image: sharp.Sharp;
  try {
    image = await openImage(original);
  } catch {
    throw new HttpError(415, "Unsupported photo format - use JPEG, PNG, HEIC, WebP, TIFF or AVIF");
  }
  await Promise.all([
    image
      .clone()
      .rotate()
      .resize({ width: FULL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .withMetadata()
      .toFile(path.join(dir, "full.jpg")),
    image.clone().rotate().resize({ width: THUMB_WIDTH }).jpeg({ quality: 78 }).toFile(path.join(dir, "thumb.jpg")),
  ]);
}

export async function removePhoto(logId: number): Promise<void> {
  await fs.rm(logDir(logId), { recursive: true, force: true });
}

/** File to serve for a request; new logs store full.jpg + thumb.jpg, legacy logs keep orig.<ext>. */
export function pickPhotoFile(entries: string[], size: "thumb" | "full" | "orig"): string | null {
  const has = (name: string) => entries.includes(name);
  const legacyOrig = entries.find((entry) => entry.startsWith("orig.")) ?? null;
  if (size === "thumb") return has("thumb.jpg") ? "thumb.jpg" : null;
  if (size === "orig") return legacyOrig ?? (has("full.jpg") ? "full.jpg" : null);
  return has("full.jpg") ? "full.jpg" : legacyOrig;
}
