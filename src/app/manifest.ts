import type { MetadataRoute } from "next";

/** Lets Outside be added to a Home Screen — which is also what iOS requires before a web app may notify. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Outside",
    short_name: "Outside",
    description: "Live severe-weather warnings, storm reports, SPC outlooks and radar.",
    start_url: "/",
    display: "standalone",
    background_color: "#08080b",
    theme_color: "#08080b",
    icons: [
      { src: "/icon/small", sizes: "192x192", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
