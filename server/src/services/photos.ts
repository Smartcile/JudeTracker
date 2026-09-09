import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";

const FORMAT_EXT: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  heif: "heic",
  webp: "webp",
  tiff: "tif",
};

export function logDir(logId: number): string {
  return path.join(config.dataDir, "photos", `log-${logId}`);
}

function extFor(format: string | undefined): string {
  return FORMAT_EXT[format ?? ""] ?? "jpg";
}

/**
 * Stores the original photo untouched (tax evidence keeps its EXIF) and writes
 * thumb.jpg + full.jpg previews derived from it.
 */
export async function storePhoto(logId: number, original: Buffer): Promise<string> {
  const dir = logDir(logId);
  await fs.mkdir(dir, { recursive: true });
  const meta = await sharp(original, { failOn: "none" }).metadata();
  const ext = extFor(meta.format);
  await fs.writeFile(path.join(dir, `orig.${ext}`), original);
  await Promise.all([
    sharp(original, { failOn: "none" }).rotate().resize({ width: 480 }).jpeg({ quality: 78 }).toFile(path.join(dir, "thumb.jpg")),
    sharp(original, { failOn: "none" }).rotate().resize({ width: 1920, withoutEnlargement: true }).jpeg({ quality: 86 }).toFile(path.join(dir, "full.jpg")),
  ]);
  return `${ext}.orig`;
}

export async function removePhoto(logId: number): Promise<void> {
  await fs.rm(logDir(logId), { recursive: true, force: true });
}

export function photoPath(logId: number, variant: "orig" | "thumb" | "full"): string {
  return path.join(logDir(logId), `${variant === "orig" ? "orig" : variant}.jpg`);
}
