#!/usr/bin/env node
/**
 * Bulk-download CIS Benchmark PDFs from CIS's official downloads portal.
 *
 * The portal URL (a learn.cisecurity.org link that opens the download
 * catalog) is NOT committed — pass it via CIS_PORTAL_URL or a local
 * gitignored file data/cis/.portal-url. The portal exposes its catalog
 * at /technology and /technology/<id>/benchmarks/latest; each document
 * carries a pardot link that redirects through the portal's download
 * route to the PDF, which this script captures as a browser download.
 *
 * Usage:
 *   CIS_PORTAL_URL=... node fetch-cis.js [--out ../../data/cis] [--families "Ubuntu Linux,Red Hat Enterprise Linux"]
 *
 * With no --families, every technology family in the catalog is fetched.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const LEARN_BASE = "https://learn.cisecurity.org";
const PORTAL_BASE = "https://downloads.cisecurity.org";

function parseArgs(argv) {
  const args = { out: "../../data/cis", families: null, portal: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--families") args.families = argv[++i];
    else if (argv[i] === "--portal") args.portal = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "../..");
  const portalUrl =
    args.portal ||
    process.env.CIS_PORTAL_URL ||
    (() => {
      const file = path.join(repoRoot, "data/cis/.portal-url");
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
    })();

  if (!portalUrl) {
    console.error(
      "No portal URL. Provide CIS_PORTAL_URL, --portal, or data/cis/.portal-url\n" +
        "(the link is intentionally not committed)."
    );
    process.exit(1);
  }

  const families = args.families
    ? args.families.split(",").map((s) => s.trim())
    : null;
  const outDir = path.resolve(__dirname, args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });

  // Establish the portal session and collect downloads context-wide.
  const page = await context.newPage();
  const downloads = [];
  page.on("download", (download) => downloads.push(download));

  console.log(`Opening portal session: ${portalUrl.slice(0, 60)}...`);
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // The catalog API, read from inside the session.
  const catalog = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/technology`);
    return await r.json();
  }, PORTAL_BASE);

  const targets = [];
  for (const [category, list] of Object.entries(catalog)) {
    for (const tech of list) {
      if (families && !families.some((f) => tech.title.includes(f))) continue;
      targets.push({ id: tech.id, title: tech.title, category });
    }
  }
  console.log(`Families to fetch: ${targets.length}`);

  let saved = 0;
  for (const target of targets) {
    process.stdout.write(`- ${target.title} (${target.id}): `);
    let benchmarks;
    try {
      benchmarks = await page.evaluate(
        async ({ id, base }) => {
          const r = await fetch(`${base}/technology/${id}/benchmarks/latest`);
          return await r.json();
        },
        { id: target.id, base: PORTAL_BASE }
      );
    } catch (e) {
      console.log(`catalog fetch failed: ${String(e).slice(0, 80)}`);
      continue;
    }

    for (const bench of benchmarks) {
      for (const doc of bench.documents || []) {
        if (!doc["pardot-id"]) continue;
        if (/archive/i.test(doc.filename || doc.title || "")) continue;
        const url = LEARN_BASE + doc["pardot-id"];
        const title = (doc.title || doc.filename || "download").replace(
          /\.pdf$/i,
          ""
        );
        const file = path.join(outDir, `${title}.pdf`);
        if (fs.existsSync(file)) {
          console.log(`already have ${path.basename(file)}`);
          continue;
        }
        try {
          // The portal's Download button sets a documentId cookie with a
          // 30-second expiry, then opens the pardot link; the download
          // route serves whichever document that cookie names.
          await page.evaluate((id) => {
            document.cookie = `documentId=${id}; max-age=25; path=/`;
          }, doc.id);
          const downloadPromise = page.waitForEvent("download", {
            timeoutMs: 45000,
          });
          // An attachment response makes goto throw "Download is
          // starting" — that is the success path, not an error.
          let response = null;
          try {
            response = await page.goto(url, { waitUntil: "commit" });
          } catch (_) {}
          let download = null;
          try {
            download = await downloadPromise;
          } catch (_) {}
          if (download) {
            await download.saveAs(file);
            saved++;
            console.log(`saved ${path.basename(file)}`);
          } else if (
            response &&
            (response.headers()["content-type"] || "").includes("pdf")
          ) {
            fs.writeFileSync(file, await response.body());
            saved++;
            console.log(`saved ${path.basename(file)} (inline)`);
          } else {
            console.log(
              `no download for "${title}": status=${
                response ? response.status() : "?"
              }`
            );
          }
          // Return to the portal so the session keeps working.
          await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1500);
        } catch (e) {
          console.log(`failed "${title}": ${String(e).slice(0, 70)}`);
          try {
            await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(1500);
          } catch (_) {}
        }
      }
    }
  }

  console.log(`\nSaved ${saved} PDFs to ${outDir}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
