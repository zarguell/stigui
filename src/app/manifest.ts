import { BASE_PATH } from "@/app/constants";
import type { MetadataRoute } from "next";
export const dynamic = "force-static";
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "STIGUI",
        short_name: "STIGUI",
        description: "Offline STIGUI application",
        start_url: BASE_PATH + "/",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#000000",
        icons: [
            {
                src: BASE_PATH + "/shield-192x192.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: BASE_PATH + "/shield-512x512.png",
                sizes: "512x512",
                type: "image/png",
            },
        ],
    };
}
