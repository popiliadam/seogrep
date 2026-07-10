import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

const ROUTES = ["", "/pricing", "/how-it-works", "/docs", "/terms", "/privacy"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({ url: `${SITE_URL}${route}` }));
}
