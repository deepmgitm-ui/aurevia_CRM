import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api", "/signup"],
    },
    sitemap: "https://aureviacrm.vercel.app/sitemap.xml",
    host: "https://aureviacrm.vercel.app",
  };
}
