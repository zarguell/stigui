import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";

/**
 * The Pages deploy serves the site from a subpath; the smoke server
 * stages the build the same way. Playwright's baseURL only supplies
 * the origin, so gotos take the base path explicitly.
 */
const BASE = process.env.SMOKE_BASE_PATH ?? "/stigui";

/**
 * End-to-end smoke test of the core assessor loop against the built
 * static site: import a CKL checklist, open it, verify statistics and
 * rule search, export CKL, and open the findings report.
 */

const fixtureCkl = path.join(
    __dirname,
    "../src/api/entities/__tests__/fixtures/U_Microsoft_Skype_for_Business_2016_V1R1_STIG.ckl"
);

const waitFor = async (
    page: import("@playwright/test").Page,
    fn: string,
    timeoutMs = 15000
) => {
    await page.waitForFunction(fn, undefined, { timeout: timeoutMs });
};

test("core assessor loop: import, edit, export, report", async ({ page }) => {
    // 1. Import a real CKL through the editor's file input
    await page.goto(`${BASE}/editor.html`);
    await waitFor(
        page,
        "() => !!document.querySelector('input[type=\"file\"]')"
    );
    await page.evaluate((xml) => {
        const input = document.querySelector(
            'input[type="file"]'
        ) as HTMLInputElement;
        const dt = new DataTransfer();
        dt.items.add(
            new File([xml], "U_Microsoft_Skype_for_Business_2016_V1R1_STIG.ckl", {
                type: "text/xml",
            })
        );
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, fs.readFileSync(fixtureCkl, "utf8"));

    // 2. The imported checklist appears in the list
    await waitFor(page, "() => document.body.innerText.includes('Test_Host')");
    const editorLink = page.locator('a[href*="editor?id="]').first();
    await expect(editorLink).toBeVisible();

    // 3. Open it: 3 rules, statistics panel, search box
    await editorLink.click();
    await page.waitForURL(/editor\.html\?id=|editor\?id=/);
    await waitFor(page, "() => document.body.innerText.includes('3 rules')");
    await expect(
        page.getByRole("button", { name: "Statistics" })
    ).toBeVisible();
    await expect(
        page.locator('input[aria-label="Search rules"]')
    ).toBeVisible();

    // 4. Search narrows the rule table
    await page.fill('input[aria-label="Search rules"]', "password");
    await page.waitForTimeout(800);
    const searchBoxes = page.locator('input[type="search"]');
    expect(await searchBoxes.count()).toBe(1);

    // 5. Export CKL fires a download
    const downloadPromise = page.waitForEvent("download", {
        timeout: 10_000,
    });
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
            (b.textContent || "").includes("CKL ⬇️")
        ) as HTMLButtonElement;
        btn.click();
    });
    await downloadPromise;

    // 6. The findings report renders with stats and buttons.
    // Navigate via the app's own button: clean-URL redirects on static
    // hosts can strip the query string, losing the checklist id.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
            (b.textContent || "").includes("Report")
        ) as HTMLButtonElement;
        btn.click();
    });
    await page.waitForURL(/report\?id=/);
    await waitFor(
        page,
        "() => document.body.innerText.includes('Open findings')"
    );
    await expect(page.locator("text=Checklist statistics")).toBeVisible();
    await expect(
        page.locator("text=Print / Save as PDF")
    ).toBeVisible();
    await expect(page.locator("text=Findings CSV")).toBeVisible();
});

test("library and rule browsing render", async ({ page }) => {
    await page.goto(`${BASE}/stigs.html`);
    await waitFor(
        page,
        "() => document.body.innerText.includes('Google Chrome Current Windows')"
    );
    await expect(
        page.locator('a[href*="Google_Chrome_Current_Windows"]').first()
    ).toBeVisible();

    await page.locator('a[href*="Google_Chrome_Current_Windows"]').first().click();
    await waitFor(
        page,
        "() => document.body.innerText.includes('Group ID')"
    );
});

test("llms.txt and markdown versions are agent-discoverable", async ({ page }) => {
    // The index links every benchmark as markdown.
    const llms = await page.request.get(`${BASE}/llms.txt`);
    expect(llms.status()).toBe(200);
    const body = await llms.text();
    expect(body).toContain("# STIG UI");
    expect(body).toContain("/markdown/stigs/CIS_Docker_Benchmark.md");

    // A benchmark markdown page links its recommendations...
    const benchmark = await page.request.get(
        `${BASE}/markdown/stigs/CIS_Docker_Benchmark.md`
    );
    expect(benchmark.status()).toBe(200);
    const benchmarkBody = await benchmark.text();
    expect(benchmarkBody).toContain("## Recommendations");
    expect(benchmarkBody).toContain("V-A374C415.md");

    // ...and a recommendation markdown page carries check and fix text.
    const rule = await page.request.get(
        `${BASE}/markdown/stigs/CIS_Docker_Benchmark/V-A374C415.md`
    );
    expect(rule.status()).toBe(200);
    const ruleBody = await rule.text();
    expect(ruleBody).toContain("## Check");
    expect(ruleBody).toContain("## Fix");
});

test("converted CIS benchmarks render like library STIGs", async ({ page }) => {
    // The library lists the shipped CIS conversions...
    await page.goto(`${BASE}/stigs.html`);
    await waitFor(
        page,
        "() => document.body.innerText.includes('CIS Docker Benchmark')"
    );
    await page.locator('a[href*="CIS_Docker_Benchmark"]').first().click();

    // ...and a CIS benchmark page renders its recommendations with the
    // profile filter and rule detail fields intact.
    await waitFor(
        page,
        "() => document.body.innerText.includes('Group ID')"
    );
    await waitFor(
        page,
        "() => document.body.innerText.includes('Level 1 - Docker - Linux')"
    );
    await waitFor(
        page,
        "() => document.body.innerText.includes('Ensure a separate partition for containers')"
    );

    // The recommendation view renders client-side from its own URL;
    // a crash there surfaces as Next's "Application error" page.
    const ruleHref = await page
        .locator('a[href*="stig=CIS_Docker_Benchmark"][href*="/stigs/rules"]')
        .first()
        .getAttribute("href");
    expect(ruleHref).toBeTruthy();
    // .html path: works on any static server; the query still drives
    // the client view via window.location.search.
    await page.goto(`${BASE}/stigs/rules.html?stig=CIS_Docker_Benchmark&group=V-A374C415`);
    await waitFor(
        page,
        "() => document.body.innerText.includes('Severity')"
    );
    await waitFor(
        page,
        "() => document.body.innerText.includes('Check')"
    );
    await expect(
        page.getByRole("heading", {
            name: "Ensure a separate partition for containers",
        })
    ).toBeVisible();
});

test("library URL filters, dashboard, what's new, and diff views render", async ({
    page,
}) => {
    // The library reads its filter state from the URL (shareable views);
    // toHaveValue retries until the client view has settled on the param.
    await page.goto(`${BASE}/stigs.html?category=Operating%20Systems&sort=-date`);
    await expect(
        page.locator('select[aria-label="Filter category"]')
    ).toHaveValue("Operating Systems", { timeout: 15000 });
    await expect(
        page.locator('select[aria-label="Filter source"]')
    ).toHaveValue("");
    // A filtered view shows fewer rows than the catalog.
    const countText = await page
        .locator("text=Showing ")
        .first()
        .innerText();
    const [, shown, total] = countText.match(/Showing (\d+) of (\d+)/) ?? [];
    expect(Number(shown)).toBeLessThan(Number(total));

    await page.goto(`${BASE}/dashboard.html`);
    await waitFor(
        page,
        "() => document.body.innerText.includes('Library dashboard')"
    );
    await waitFor(
        page,
        "() => document.body.innerText.includes('Security requirements')"
    );

    await page.goto(`${BASE}/whats-new.html`);
    await waitFor(
        page,
        "() => document.body.innerText.includes(\"What's new\")"
    );
    // The default window empties once the baseline ages out; all-time
    // always shows the library's initial import.
    await page.locator('button:has-text("All time")').click();
    await waitFor(
        page,
        "() => document.body.innerText.includes('New benchmarks')"
    );

    // The diff route handles unknown comparisons with a friendly state.
    await page.goto(`${BASE}/stigs/diff.html?id=Does_Not_Exist&from=1`);
    await waitFor(
        page,
        "() => document.body.innerText.includes('No recorded changes')"
    );
});
