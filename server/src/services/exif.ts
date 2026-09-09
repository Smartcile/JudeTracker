import exifr from "exifr";

export interface PhotoMeta {
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
}

/** Reads GPS + capture time from a photo buffer (JPEG/HEIC/PNG/TIFF/WebP). */
export async function readPhotoMeta(buffer: Buffer): Promise<PhotoMeta> {
  const gps = await exifr.gps(buffer).catch(() => null);
  const date = await exifr.parse(buffer, ["DateTimeOriginal", "CreateDate"]).catch(() => null);
  const raw = (date as Record<string, unknown> | null)?.DateTimeOriginal ?? (date as Record<string, unknown> | null)?.CreateDate;
  let takenAt: Date | null = null;
  if (raw instanceof Date) takenAt = raw;
  else if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) takenAt = parsed;
  }
  return {
    lat: gps?.latitude ?? null,
    lng: gps?.longitude ?? null,
    takenAt,
  };
}
