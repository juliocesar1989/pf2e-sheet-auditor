/**
 * Runs the audit: every feat on the sheet is checked against its prerequisites
 * plus a few structural rules (feat level, level-1-only, max takable, archetype
 * dedication rule, legacy content).
 *
 * `auditFeats` is pure (plain data in, plain data out); `featRecordFromItem`
 * adapts a PF2e FeatPF2e item.
 */

import { parsePrerequisites, slugify } from "./parser.js";
import { evaluate, leaves } from "./evaluator.js";

export const AUDITED_CATEGORIES = Object.freeze(["ancestry", "class", "skill", "general", "bonus"]);

/** Converts a PF2e feat item into the plain record used by auditFeats. */
export function featRecordFromItem(item, actor) {
    const sys = item.system ?? {};
    const location = typeof sys.location === "string" ? sys.location : sys.location?.value;
    const fromLocation = Number(String(location ?? "").match(/-(\d+)$/)?.[1]);
    const takenAt = sys.level?.taken ?? (Number.isFinite(fromLocation) ? fromLocation : null);
    const grantedById = item.flags?.pf2e?.grantedBy?.id ?? null;
    const grantedBy = grantedById ? actor?.items?.get?.(grantedById)?.name ?? "another item" : null;
    return {
        id: item.id,
        name: item.name,
        slug: item.slug ?? sys.slug ?? slugify(item.name),
        category: item.category ?? sys.category,
        level: sys.level?.value ?? 0,
        takenAt,
        onlyLevel1: !!sys.onlyLevel1,
        maxTakable: sys.maxTakable === null ? Infinity : sys.maxTakable ?? 1,
        remaster: sys.publication?.remaster ?? null,
        source: sys.publication?.title ?? "",
        rarity: sys.traits?.rarity ?? "common",
        traits: [...(sys.traits?.value ?? [])],
        prerequisites: (sys.prerequisites?.value ?? []).map((p) => (typeof p === "string" ? p : p?.value)).filter(Boolean),
        grantedBy,
        sourceId: item._stats?.compendiumSource ?? item.sourceId ?? null,
    };
}

function issue(severity, message) {
    return { severity, message };
}

function dedicationRule(records, parsedById) {
    const issues = new Map();
    const dedications = records
        .filter((r) => r.traits.includes("dedication") && !r.grantedBy)
        .sort((a, b) => (a.takenAt ?? a.level) - (b.takenAt ?? b.level));
    if (dedications.length < 2) return issues;

    const unknownOrder = dedications.some((d) => d.takenAt == null);
    for (const dedication of dedications.slice(0, -1)) {
        const followers = records.filter((r) => {
            if (r.id === dedication.id || !r.traits.includes("archetype") || r.traits.includes("dedication")) return false;
            const tree = parsedById.get(r.id);
            const stack = tree ? [tree] : [];
            while (stack.length) {
                const n = stack.pop();
                if (n.kind === "leaf" && (n.slug === dedication.slug || slugify(n.text) === dedication.slug)) return true;
                stack.push(...(n.children ?? []), ...(n.child ? [n.child] : []));
            }
            return false;
        });
        if (followers.length < 2) {
            const msg = `Archetype rule: you must take two other feats from the ${dedication.name.replace(/ Dedication$/, "")} archetype `
                + `before taking another dedication feat (found ${followers.length}${followers.length ? `: ${followers.map((f) => f.name).join(", ")}` : ""}).`
                + (unknownOrder ? " The order in which dedications were taken could not be determined; verify manually." : "");
            issues.set(dedication.id, issue(unknownOrder ? "warning" : "error", msg));
        }
    }
    return issues;
}

/**
 * @param {ReturnType<typeof featRecordFromItem>[]} records
 * @param {object} state actor state from buildActorState()
 * @param {{ knownNames?: Set<string> }} [ctx]
 */
export function auditFeats(records, state, ctx = {}) {
    const audited = records.filter((r) => AUDITED_CATEGORIES.includes(r.category));
    const skipped = records.filter((r) => !AUDITED_CATEGORIES.includes(r.category));

    const parsedById = new Map(audited.map((r) => [r.id, parsePrerequisites(r.prerequisites, ctx)]));
    const dedicationIssues = dedicationRule(audited, parsedById);

    const counts = new Map();
    for (const r of audited) {
        if (r.grantedBy) continue;
        const key = r.sourceId ?? r.slug;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const feats = audited.map((r) => {
        const tree = parsedById.get(r.id);
        const evaluation = tree ? evaluate(tree, state, ctx) : null;
        const met = evaluation ? evaluation.met : true;
        const issues = [];

        if (r.level > state.level) {
            issues.push(issue("error", `Feat level ${r.level} is higher than the character level ${state.level}.`));
        }
        if (r.takenAt != null && r.level > r.takenAt && !r.grantedBy) {
            issues.push(issue("error", `Feat level ${r.level} is higher than the level it was taken at (${r.takenAt}).`));
        }
        if (r.onlyLevel1 && r.takenAt != null && r.takenAt > 1 && !r.grantedBy) {
            issues.push(issue("error", `This feat can only be taken at 1st level (taken at level ${r.takenAt}).`));
        }
        const maxTakable = r.maxTakable ?? 1;
        const count = counts.get(r.sourceId ?? r.slug) ?? 0;
        if (!r.grantedBy && Number.isFinite(maxTakable) && count > maxTakable) {
            issues.push(issue("error", `Taken ${count} times; this feat can be taken at most ${maxTakable} time(s).`));
        }
        if (dedicationIssues.has(r.id)) issues.push(dedicationIssues.get(r.id));
        if (r.remaster === false) {
            issues.push(issue("warning", "Legacy (pre-Remaster) content. This module only audits Remaster rules; check whether a Remaster version exists."));
        }
        if (r.rarity && r.rarity !== "common") {
            issues.push(issue("info", `${r.rarity[0].toUpperCase()}${r.rarity.slice(1)} feat: requires GM permission or another access condition.`));
        }
        if (r.grantedBy) {
            issues.push(issue("info", `Granted by ${r.grantedBy}; granted feats usually ignore prerequisites.`));
        }
        if (evaluation && r.takenAt != null && met === true && r.takenAt < state.level) {
            const rankLeaves = leaves(evaluation).filter((l) => ["skill", "lore", "anySkill", "proficiency", "attribute"].includes(l.type));
            if (rankLeaves.length) {
                issues.push(issue("info", `Prerequisites were checked against the current sheet; confirm they were already met at level ${r.takenAt}.`));
            }
        }

        const hasError = issues.some((i) => i.severity === "error");
        let status;
        if (r.grantedBy && met !== true) status = hasError ? "fail" : "waived";
        else if (met === false || hasError) status = "fail";
        else if (met === null) status = "review";
        else status = "ok";

        return { ...r, status, met, evaluation, issues };
    });

    const order = { fail: 0, review: 1, waived: 2, ok: 3 };
    feats.sort((a, b) => order[a.status] - order[b.status] || (a.takenAt ?? a.level) - (b.takenAt ?? b.level) || a.name.localeCompare(b.name));

    const summary = { total: feats.length, ok: 0, fail: 0, review: 0, waived: 0, warnings: 0 };
    for (const f of feats) {
        summary[f.status] += 1;
        summary.warnings += f.issues.filter((i) => i.severity === "warning").length;
    }

    return {
        character: {
            name: state.name,
            level: state.level,
            ancestry: state.ancestry?.name ?? null,
            heritage: state.heritage?.name ?? null,
            background: state.background?.name ?? null,
            class: state.class?.name ?? null,
            deity: state.deity?.name ?? null,
        },
        summary,
        feats,
        skipped: skipped.map((r) => ({ name: r.name, category: r.category })),
    };
}
