import { v4 as uuidv4 } from "uuid";
import Checklist, { Stig as ChecklistStig } from "@/api/entities/Checklist";
import { Stig as IStig, Convert } from "@/api/generated/Stig";
import { Rule, Status } from "@/api/generated/Checklist";
import type { LibraryStig } from "@/api/entities/upload";

/**
 * STIG version migration: carries an existing checklist's review data
 * forward onto a newer (or older) release of the same STIG.
 *
 * Matching is by vulnerability id (V-xxxxx) first — DISA's stable key —
 * then by base rule id (SV-xxxxx, ignoring the revision suffix) to catch
 * renumbering. Matched rules whose full rule id changed are flagged as
 * "updated" (content changed; re-review recommended) with the changed
 * fields listed. Rules only in the target are "added"; rules only in the
 * checklist are "removed".
 */

export type MigrationOutcome = "unchanged" | "updated" | "added" | "removed";

export interface MigrationEntry {
    outcome: MigrationOutcome;
    groupId: string;
    ruleId: string;
    ruleTitle: string;
    /** Review data carried over from the checklist (unchanged + updated) */
    status: Status;
    changedFields: string[];
}

export interface MigrationPlan {
    stigUuid: string;
    target: LibraryStig;
    fromVersion: string;
    toVersion: string;
    entries: MigrationEntry[];
    counts: Record<MigrationOutcome, number>;
}

const normalize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");

const svBase = (ruleId: string): string =>
    ruleId.match(/^(SV-\d+)/i)?.[1] ?? ruleId;

const vulnDiscussionRe = /<VulnDiscussion>(.*)<\/VulnDiscussion>/s;

/**
 * Convert a library entry (raw yq-shaped Benchmark JSON) into the
 * checklist Stig shape with every group included and empty review
 * data. Mirrors the mapping in `Checklist.fromStig` but is not
 * profile-filtered: after a migration the assessor should see all
 * rules the new release carries.
 */
export const benchmarkToStig = (target: LibraryStig): ChecklistStig => {
    const benchmark: IStig = Convert.toStig(target.benchmark);
    const b = benchmark.Benchmark;
    const groups = Array.isArray(b.Group) ? b.Group : [b.Group];

    const rules: Rule[] = groups.map((group) => {
        const rule = group.Rule;
        const idents = Array.isArray(rule.ident)
            ? rule.ident
            : rule.ident
            ? [rule.ident]
            : [];
        return {
            group_id_src: group["+@id"],
            group_tree: [
                {
                    id: group["+@id"],
                    title: group.title,
                    description: "<GroupDescription></GroupDescription>",
                },
            ],
            group_id: group["+@id"],
            severity: rule["+@severity"] ?? "info",
            group_title: rule.title,
            rule_id_src: rule["+@id"],
            rule_id: rule["+@id"].replace("_rule", ""),
            rule_version: rule.version,
            rule_title: rule.title,
            fix_text: rule.fixtext["+content"],
            weight: rule["+@weight"],
            check_content: rule.check["check-content"],
            check_content_ref: {
                href: rule.check["check-content-ref"]["+@href"] || "",
                name: "M" as const,
            },
            classification: "Unclassified" as const,
            discussion: rule.description.match(vulnDiscussionRe)?.[1] || "",
            false_positives: "",
            false_negatives: "",
            documentable: "false",
            security_override_guidance: "",
            potential_impacts: "",
            third_party_tools: "",
            ia_controls: "",
            responsibility: "",
            mitigations: "",
            mitigation_control: "",
            legacy_ids: idents
                .filter((ident) => ident["+@system"] === "http://cyber.mil/legacy")
                .map((ident) => ident["+content"]),
            ccis: idents
                .filter((ident) => ident["+@system"] === "http://cyber.mil/cci")
                .map((ident) => ident["+content"]),
            reference_identifier:
                rule.reference?.["dc:identifier"] ||
                rule.reference?.["identifier"] ||
                "",
            uuid: uuidv4(),
            stig_uuid: "",
            status: Status.NotReviewed,
            overrides: {},
            comments: "",
            finding_details: "",
        };
    });

    const plainText = Array.isArray(b["plain-text"])
        ? b["plain-text"]
        : [b["plain-text"]];

    return {
        stig_name: b.title,
        display_name: b["+@id"],
        stig_id: target.stig_id,
        release_info:
            plainText.find((item) => item["+@id"] === "release-info")?.[
                "+content"
            ] ?? "",
        version: String(b.version ?? ""),
        uuid: "",
        reference_identifier: "",
        size: rules.length,
        rules,
    };
};

const CONTENT_FIELDS: Array<[string, (rule: Rule) => string]> = [
    ["severity", (rule) => rule.severity],
    ["rule_title", (rule) => rule.rule_title],
    ["discussion", (rule) => rule.discussion],
    ["check_content", (rule) => rule.check_content],
    ["fix_text", (rule) => rule.fix_text],
];

const changedFields = (oldRule: Rule, newRule: Rule): string[] => {
    const changes: string[] = [];
    for (const [label, get] of CONTENT_FIELDS) {
        if (get(oldRule) !== get(newRule)) {
            changes.push(label);
        }
    }
    const oldCcis = [...oldRule.ccis].sort().join(",");
    const newCcis = [...newRule.ccis].sort().join(",");
    if (oldCcis !== newCcis) {
        changes.push("ccis");
    }
    return changes;
};

/** Finds the library entry that is a different release of this STIG */
export const findMigrationTarget = (
    checklistStig: ChecklistStig,
    library: LibraryStig[]
): LibraryStig | null => {
    const selfId = normalize(checklistStig.stig_id);
    const selfTitle = normalize(checklistStig.stig_name);
    const selfVersion = normalize(checklistStig.version);
    return (
        library.find((entry) => {
            // A different release of the same STIG shares its id/title
            // but carries a different version
            const sameStig =
                (selfId.length > 0 && normalize(entry.stig_id) === selfId) ||
                (selfTitle.length > 0 && normalize(entry.title) === selfTitle);
            return sameStig && normalize(entry.version) !== selfVersion;
        }) ?? null
    );
};

export const planMigration = (
    checklistStig: ChecklistStig,
    target: LibraryStig
): MigrationPlan => {
    const newStig = benchmarkToStig(target);

    const oldByGroup = new Map(
        checklistStig.rules.map((rule) => [rule.group_id, rule])
    );
    const newByGroup = new Map(newStig.rules.map((rule) => [rule.group_id, rule]));

    const oldBySv = new Map(
        checklistStig.rules
            .filter((rule) => !newByGroup.has(rule.group_id))
            .map((rule) => [svBase(rule.rule_id), rule])
    );
    const newBySv = new Map(
        newStig.rules
            .filter((rule) => !oldByGroup.has(rule.group_id))
            .map((rule) => [svBase(rule.rule_id), rule])
    );

    const entries: MigrationEntry[] = [];
    const counts: Record<MigrationOutcome, number> = {
        unchanged: 0,
        updated: 0,
        added: 0,
        removed: 0,
    };

    for (const [groupId, oldRule] of oldByGroup) {
        const newRule = newByGroup.get(groupId);
        if (!newRule) {
            const svMatch = oldBySv.get(svBase(oldRule.rule_id));
            const renumbered = svMatch
                ? newBySv.get(svBase(svMatch.rule_id))
                : undefined;
            if (renumbered) {
                entries.push({
                    outcome: "updated",
                    groupId: renumbered.group_id,
                    ruleId: renumbered.rule_id,
                    ruleTitle: renumbered.rule_title,
                    status: oldRule.status,
                    changedFields: changedFields(oldRule, renumbered),
                });
                counts.updated++;
                continue;
            }
            entries.push({
                outcome: "removed",
                groupId,
                ruleId: oldRule.rule_id,
                ruleTitle: oldRule.rule_title,
                status: oldRule.status,
                changedFields: [],
            });
            counts.removed++;
            continue;
        }

        if (newRule.rule_id_src === oldRule.rule_id_src) {
            entries.push({
                outcome: "unchanged",
                groupId,
                ruleId: newRule.rule_id,
                ruleTitle: newRule.rule_title,
                status: oldRule.status,
                changedFields: [],
            });
            counts.unchanged++;
        } else {
            entries.push({
                outcome: "updated",
                groupId,
                ruleId: newRule.rule_id,
                ruleTitle: newRule.rule_title,
                status: oldRule.status,
                changedFields: changedFields(oldRule, newRule),
            });
            counts.updated++;
        }
    }

    for (const [groupId, newRule] of newByGroup) {
        if (oldByGroup.has(groupId)) {
            continue;
        }
        if ([...oldBySv.values()].some((rule) => svBase(rule.rule_id) === svBase(newRule.rule_id))) {
            continue;
        }
        entries.push({
            outcome: "added",
            groupId,
            ruleId: newRule.rule_id,
            ruleTitle: newRule.rule_title,
            status: Status.NotReviewed,
            changedFields: [],
        });
        counts.added++;
    }

    const order: Record<MigrationOutcome, number> = {
        updated: 0,
        added: 1,
        removed: 2,
        unchanged: 3,
    };
    entries.sort(
        (a, b) =>
            order[a.outcome] - order[b.outcome] ||
            a.groupId.localeCompare(b.groupId)
    );

    return {
        stigUuid: checklistStig.uuid,
        target,
        fromVersion: checklistStig.version,
        toVersion: target.version,
        entries,
        counts,
    };
};

/**
 * Builds the migrated Stig: the target release's rules with review data
 * carried over from matched rules. The checklist stig keeps its uuid so
 * the IndexedDB records and checklist links stay valid.
 */
export const applyMigration = (
    checklistStig: ChecklistStig,
    plan: MigrationPlan
): ChecklistStig => {
    const newStig = benchmarkToStig(plan.target);
    const reviewByGroup = new Map(
        checklistStig.rules.map((rule) => [rule.group_id, rule])
    );
    const newGroupIds = new Set(newStig.rules.map((rule) => rule.group_id));
    const reviewBySv = new Map(
        checklistStig.rules
            .filter((rule) => !newGroupIds.has(rule.group_id))
            .map((rule) => [svBase(rule.rule_id), rule])
    );

    const carried = new Set<string>();
    const rules = newStig.rules.map((rule) => {
        const old =
            reviewByGroup.get(rule.group_id) ??
            reviewBySv.get(svBase(rule.rule_id));
        if (!old) {
            return { ...rule, stig_uuid: checklistStig.uuid };
        }
        carried.add(rule.group_id);
        return {
            ...rule,
            uuid: uuidv4(),
            stig_uuid: checklistStig.uuid,
            status: old.status,
            overrides: old.overrides,
            comments: old.comments,
            finding_details: old.finding_details,
        };
    });

    return {
        ...newStig,
        uuid: checklistStig.uuid,
        stig_id: checklistStig.stig_id,
        rules,
    };
};

/** Convenience for building a migration plan straight from a checklist */
export const planChecklistMigrations = (
    checklist: Checklist,
    library: LibraryStig[]
): Array<{ stig: ChecklistStig; plan: MigrationPlan }> =>
    checklist.stigs.flatMap((stig) => {
        const target = findMigrationTarget(stig, library);
        return target ? [{ stig, plan: planMigration(stig, target) }] : [];
    });
