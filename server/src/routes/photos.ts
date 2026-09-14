import { promises as fs } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { logs } from "../db/schema.ts";
import { HttpError } from "../lib/http.ts";
import { logDir, pickPhotoFile } from "../services/photos.ts";

export const photosRouter = Router();

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  tif: "image/tiff",
  jpeg: "image/jpeg",
};

photosRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const size = req.query.size === "full" || req.query.size === "orig" ? req.query.size : "thumb";
  const row = (await db.select().from(logs).where(eq(logs.id, id)))[0];
  if (!row || !row.hasPhoto) throw new HttpError(404, "Log has no photo");

  const dir = logDir(id);
  try {
    const file = pickPhotoFile(await fs.readdir(dir), size);
    if (!file) throw new Error("missing photo file");
    const mime = MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(path.join(dir, file));
  } catch {
    throw new HttpError(404, "Photo file not found");
  }
});
