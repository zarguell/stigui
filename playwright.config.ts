import { defineConfig } from "@playwright/test";

/**
 * Smoke test against a served static export. The workflow builds the
 * site (with NEXT_PUBLIC_BASE_PATH=/stigui, matching the Pages deploy),
 * stages it under a /stigui subpath, serves it, and points this suite
 * at it via SMOKE_BASE_URL.
 */
export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    retries: 1,
    workers: 1,
    use: {
        baseURL: process.env.SMOKE_BASE_URL ?? "http://localhost:3179",
        headless: true,
    },
});
