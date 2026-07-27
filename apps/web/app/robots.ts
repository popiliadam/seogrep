import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // /app is the signed-in dashboard: nothing under it is meant for search results.
    rules: { userAgent: "*", allow: "/", disallow: "/app" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
