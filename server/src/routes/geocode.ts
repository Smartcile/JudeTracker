import { Router } from "express";
import { httpAssert } from "../lib/http.ts";
import { geocodeNZ } from "../services/geocode.ts";

export const geocodeRouter = Router();

geocodeRouter.get("/", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  httpAssert(query.length >= 3, 400, "Type at least 3 characters to search");
  res.json({ results: await geocodeNZ(query) });
});
