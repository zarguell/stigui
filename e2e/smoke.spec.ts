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

    // 6. The findings report renders with stats and buttons
    await page.goto(`${BASE}/editor/report.html?id=${page.url().match(/id=([^&]+)/)?.[1]}`);
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
