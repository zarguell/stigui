#!/usr/bin/env node
/**
 * Daily CIS catalog watcher: detect new/updated benchmarks on CIS's
 * download portal and fetch their PDFs for conversion.
 *
 * Modes:
 *   detect    open the portal session, read CIS's catalog API, diff it
 *             against the committed state file, and write the changed
 *             documents to --docs-out plus the advanced state file
 *   download  download the documents listed in --docs-file
 *
 * State: scripts/cis/catalog-state.json (committed). Keyed by document
 * filename; records version/updatedAt so CIS re-releases re-trigger
 * detection. Never commit the portal link — it arrives via
 * CIS_PORTAL_URL or data/cis/.portal-url (gitignored).
 *
 * Usage:
 *   node catalog-update.mjs detect --state <file> --docs-out <file> \
 *        [--portal <url>] [--skip <substring>]...
 *   node catalog-update.mjs download --docs <file> --out <dir> [--portal <url>]
 */

import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const LEARN_BASE = "https://learn.cisecurity.org";
const PORTAL_BASE = "https://downloads.cisecurity.org";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state") args.state = argv[++i];
    else if (a === "--docs-out") args.docsOut = argv[++i];
    else if (a === "--docs") args.docs = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--portal") args.portal = argv[++i];
    else if (a === "--skip") (args.skip ??= []).push(argv[++i]);
    else if (a === "--seed") args.seed = true;
    else args._.push(a);
  }
  return args;
}

function portalUrl(args) {
  const url =
    args.portal ||
    process.env.CIS_PORTAL_URL ||
    (() => {
      const local = path.resolve("data/cis/.portal-url");
      return fs.existsSync(local)
        ? fs.readFileSync(local, "utf8").trim()
        : null;
    })();
  if (!url) {
    throw new Error(
      "No portal URL: set CIS_PORTAL_URL or data/cis/.portal-url " +
        "(intentionally not committed)."
    );
  }
  return url;
}

async function withPortalSession(portalUrl, fn) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  // the portal SPA loads the catalog after the session landing
  await page.waitForTimeout(5000);
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function fetchCatalog(page) {
  return await page.evaluate(async (base) => {
    const categories = await (await fetch(`${base}/technology`)).json();
    const out = [];
    for (const list of Object.values(categories)) {
      for (const tech of list) {
        const benchmarks = await (
          await fetch(`${base}/technology/${tech.id}/benchmarks/latest`)
        ).json();
        for (const bench of benchmarks) {
          for (const doc of bench.documents || []) {
            out.push({
              docId: doc.id,
              filename: doc.filename,
              location: doc.location,
              pardotId: doc["pardot-id"] || "",
              title: doc.title || doc.filename,
              technology: tech.title,
              technologyVersion: bench.technology_version,
              benchmarkId: bench.id,
              version: bench.version,
              published: bench.published,
              updatedAt: doc.updated_at || bench.updated_at || "",
            });
          }
        }
      }
    }
    return out;
  }, PORTAL_BASE);
}

function parseDocsFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (mode === "detect") {
    const statePath = path.resolve(args.state);
    const fresh = !fs.existsSync(statePath);
    const state = fresh
      ? { version: 1, documents: {} }
      : JSON.parse(fs.readFileSync(statePath, "utf8"));
    const documents = state.documents ?? {};

    const docs = await withPortalSession(portalUrl(args), async (page) =>
      fetchCatalog(page)
    );

    const changed = [];
    const skipped = [];
    for (const doc of docs) {
      const name = doc.filename;
      if (
        (args.skip ?? []).some((s) => name.includes(s)) ||
        /archive/i.test(name)
      ) {
        skipped.push(name);
        continue;
      }
      const seen = documents[name];
      if (!args.seed) {
        if (
          !seen ||
          seen.updatedAt !== doc.updatedAt ||
          seen.version !== doc.version
        ) {
          changed.push(doc);
        }
      }
    }

    // Advance state to what the portal shows now: changed docs get
    // status "review" (the workflow moves them to shipped when the
    // clean commit lands); skipped archives are recorded so they never
    // re-fire.
    for (const doc of docs) {
      documents[doc.filename] = {
        docId: doc.docId,
        technology: doc.technology,
        technologyVersion: doc.technologyVersion,
        benchmark: doc.benchmarkId,
        version: doc.version,
        updatedAt: doc.updatedAt,
        status: args.seed
          ? "shipped"
          : documents[doc.filename]?.status === "shipped" &&
              documents[doc.filename]?.updatedAt === doc.updatedAt
            ? "shipped"
            : "review",
      };
    }
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({ version: 1, documents }, null, 2) + "\n"
    );
    fs.writeFileSync(
      path.resolve(args.docsOut),
      JSON.stringify(changed, null, 2)
    );

    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `updated=${changed.length > 0 ? "true" : "false"}\ncount=${changed.length}\n`
      );
    }
    console.log(`updated=${changed.length > 0 ? "true" : "false"} count=${changed.length} skipped=${skipped.length}`);
    if (changed.length) {
      console.log(
        "docs:\n" +
          changed
            .map((d) => `  - ${d.filename} (v${d.version}, ${d.technology})`)
            .join("\n")
      );
    }
    return;
  }

  if (mode === "download") {
    const docs = parseDocsFile(args.docs);
    const outDir = path.resolve(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    const portal = portalUrl(args);

    await withPortalSession(portal, async (page) => {
      // session landing: establishes cookies used by the download route
      await page.goto(portal, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);

      for (const doc of docs) {
        const file = path.join(outDir, doc.filename);
        if (fs.existsSync(file)) {
          console.log(`already have ${doc.filename}`);
          continue;
        }
        try {
          await page.evaluate((id) => {
            document.cookie = `documentId=${id}; max-age=25; path=/`;
          }, doc.docId);
          const downloadPromise = page.waitForEvent("download", {
            timeoutMs: 60000,
          });
          let response = null;
          try {
            response = await page.goto(LEARN_BASE + doc.pardotId, {
              waitUntil: "commit",
            });
          } catch (_) {
            /* "Download is starting" is the success path */
          }
          let download = null;
          try {
            download = await downloadPromise;
          } catch (_) {}
          if (download) {
            await download.saveAs(file);
            console.log(`saved ${doc.filename}`);
          } else if (
            response &&
            (response.headers()["content-type"] || "").includes("pdf")
          ) {
            fs.writeFileSync(file, await response.body());
            console.log(`saved ${doc.filename} (inline)`);
          } else {
            console.log(`FAILED: ${doc.filename}`);
          }
          // back to the portal so the next download keeps its session
          await page.goto(portal, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1500);
        } catch (e) {
          console.log(`FAILED: ${doc.filename}: ${String(e).slice(0, 90)}`);
          try {
            await page.goto(portal, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(1500);
          } catch (_) {}
        }
      }
    });
    return;
  }

  throw new Error(`unknown mode: ${mode}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
