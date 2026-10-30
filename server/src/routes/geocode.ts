import { Router } from "express";
import { httpAssert } from "../lib/http.ts";
import { geocodeNZ, reverseGeocodeNZ } from "../services/geocode.ts";

export const geocodeRouter = Router();

geocodeRouter.get("/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  httpAssert(Number.isFinite(lat) && lat >= -90 && lat <= 90, 400, "Valid lat is required");
  httpAssert(Number.isFinite(lng) && lng >= -180 && lng <= 180, 400, "Valid lng is required");
  res.json(await reverseGeocodeNZ(lat, lng));
});

geocodeRouter.get("/", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  httpAssert(query.length >= 3, 400, "Type at least 3 characters to search");
  res.json({ results: await geocodeNZ(query) });
});
