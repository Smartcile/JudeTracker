import { Router } from "express";
import { httpAssert } from "../lib/http.ts";
import { roadDistanceKm } from "../services/routing.ts";

export const distanceRouter = Router();

distanceRouter.get("/", async (req, res) => {
  const num = (v: unknown): number => Number(v);
  const fromLat = num(req.query.fromLat);
  const fromLng = num(req.query.fromLng);
  const toLat = num(req.query.toLat);
  const toLng = num(req.query.toLng);
  httpAssert(
    [fromLat, fromLng, toLat, toLng].every(Number.isFinite),
    400,
    "Provide from/to latitude and longitude",
  );
  httpAssert(
    Math.abs(fromLat) <= 90 && Math.abs(toLat) <= 90 && Math.abs(fromLng) <= 180 && Math.abs(toLng) <= 180,
    400,
    "Coordinates out of range",
  );
  const km = await roadDistanceKm({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  res.json({ km });
});
