/**
 * Compute a version-to-version delta for one benchmark, reusing the
 * checklist migration's matching + word-level diff logic verbatim
 * (src/api/entities/migration.ts) so pipeline-produced changes files can
 * never drift from what the app computes for imported STIGs.
 *
 * The site keeps only the latest release of each benchmark in full;
 * superseded releases live on as these small precomputed delta files
 * (public/data/stigs/changes/<id>/<from_version>.json), which the
 * /stigs/diff view renders directly.
 *
 * Usage:
 *   npx ts-node -O '{"module":"commonjs"}' -r tsconfig-paths/register \
 *       scripts/compute_deltas.ts <old.json> <new.json> <out.json>
 */

import fs from "fs";
import type { LibraryStig } from "@/api/entities/upload";
import { benchmarkToStig, planMigration } from "@/api/entities/migration";

const [, , oldPath, newPath, outPath] = process.argv;
if (!oldPath || !newPath || !outPath) {
    console.error(
        "usage: compute_deltas.ts <old.json> <new.json> <out.json>"
    );
    process.exit(2);
}

/** The yq-shaped document as stored under public/data/stigs/schema. */
type BenchmarkDoc = { Benchmark: Record<string, unknown> };

const doc = (path: string): BenchmarkDoc =>
    JSON.parse(fs.readFileSync(path, "utf8"));

/** Wrap a document in the LibraryStig shape planMigration consumes. */
const asTarget = (doc: BenchmarkDoc): LibraryStig => {
    const b = doc.Benchmark as Record<string, string>;
    return {
        stig_id: b["+@id"],
        title: b.title,
        description: b.description,
        version: String(b.version ?? ""),
        date: (b.status as unknown as Record<string, string>)?.["+@date"] ?? "",
        benchmark: JSON.stringify(doc),
        xml: "",
        imported_at: 0,
    };
};

const oldDoc = doc(oldPath);
const newDoc = doc(newPath);
const plan = planMigration(
    benchmarkToStig(asTarget(oldDoc)),
    asTarget(newDoc)
);

// Unchanged rules are the bulk of most benchmarks and carry no payload —
// counts convey them; entries keep only what the diff view renders, in
// the snake_case shape of src/api/entities/history.ts ChangeEntry.
const entries = plan.entries
    .filter((entry) => entry.outcome !== "unchanged")
    .map((entry) => ({
        outcome: entry.outcome,
        group_id: entry.groupId,
        rule_id: entry.ruleId,
        rule_title: entry.ruleTitle,
        fieldDiffs: entry.fieldDiffs,
    }));

const delta = {
    id: plan.target.stig_id,
    from_version: plan.fromVersion,
    to_version: plan.toVersion,
    date: plan.target.date,
    counts: plan.counts,
    entries,
};

fs.writeFileSync(outPath, JSON.stringify(delta, null, 2) + "\n");
console.error(
    `${delta.id}: ${delta.from_version} -> ${delta.to_version} ` +
        `(+${delta.counts.added}/~${delta.counts.updated}/-${delta.counts.removed}, ` +
        `${delta.counts.unchanged} unchanged)`
);
