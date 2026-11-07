/**
 * Evaluates a parsed prerequisite tree against a plain "actor state" object
 * (see actor-state.js). Uses three-valued logic:
 *   true  → requirement met
 *   false → requirement definitely not met
 *   null  → could not be verified automatically (manual review)
 *
 * No Foundry dependencies.
 */

import { RANK_LABELS, slugify } from "./parser.js";

const RECALL_KNOWLEDGE_SKILLS = ["arcana", "crafting", "medicine", "nature", "occultism", "religion", "society"];
const DECIPHER_WRITING_SKILLS = ["arcana", "occultism", "religion", "society"];

const STAT_LABELS = {
    perception: "Perception",
    fortitude: "Fortitude",
    reflex: "Reflex",
    will: "Will",
    "class-dc": "class DC",
    spellcasting: "spellcasting",
};

function rankLabel(rank) {
    return RANK_LABELS[rank ?? 0] ?? String(rank);
}

function statLabel(stat) {
    if (STAT_LABELS[stat]) return STAT_LABELS[stat];
    const [group, cat] = stat.split(":");
    if (group === "armor") return cat === "unarmored" ? "unarmored defense" : `${cat} armor`;
    if (group === "attack") return cat === "unarmed" ? "unarmed attacks" : `${cat} weapons`;
    return stat;
}

function titleCase(slug) {
    return String(slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function combineAll(values) {
    if (values.some((v) => v === false)) return false;
    if (values.some((v) => v === null)) return null;
    return true;
}

export function combineAny(values) {
    if (values.some((v) => v === true)) return true;
    if (values.some((v) => v === null)) return null;
    return false;
}

function result(met, detail) {
    return { met, detail };
}

/* -------------------------------------------------------------------------- */
/*  Leaf matchers                                                             */
/* -------------------------------------------------------------------------- */

function hasName(state, slug, types = null) {
    const entries = state.names.get(slug);
    if (!entries) return null;
    const match = types ? entries.find((e) => types.includes(e.type)) : entries[0];
    return match ?? null;
}

function rankCheck(label, have, need) {
    const met = (have ?? 0) >= need;
    return result(met, `${label}: ${rankLabel(have)} (needs ${rankLabel(need)})`);
}

const MATCHERS = {
    skill(node, state) {
        return rankCheck(titleCase(node.skill), state.skills[node.skill], node.rank);
    },

    lore(node, state) {
        if (node.lore) return rankCheck(titleCase(node.lore), state.lores[node.lore], node.rank);
        const best = Object.entries(state.lores).sort((a, b) => b[1] - a[1])[0];
        if (!best) return result(false, `No Lore skills (needs ${rankLabel(node.rank)} in a Lore)`);
        return rankCheck(`Best Lore (${titleCase(best[0])})`, best[1], node.rank);
    },

    anySkill(node, state) {
        let pool = Object.entries(state.skills);
        if (node.filter === "recall-knowledge") {
            pool = pool.filter(([s]) => RECALL_KNOWLEDGE_SKILLS.includes(s)).concat(Object.entries(state.lores));
        } else if (node.filter === "decipher-writing") {
            pool = pool.filter(([s]) => DECIPHER_WRITING_SKILLS.includes(s));
        } else {
            pool = pool.concat(Object.entries(state.lores));
        }
        const best = pool.sort((a, b) => b[1] - a[1])[0];
        if (!best) return result(false, "No qualifying skills");
        return rankCheck(`Best qualifying skill (${titleCase(best[0])})`, best[1], node.rank);
    },

    proficiency(node, state) {
        const stats = Array.isArray(node.stat) ? node.stat : [node.stat];
        const checks = stats.map((s) => {
            const have = state.proficiencies[s];
            if (have === undefined) return result(null, `${statLabel(s)}: not found on the sheet`);
            return rankCheck(statLabel(s), have, node.rank);
        });
        const met = node.mode === "any" ? combineAny(checks.map((c) => c.met)) : combineAll(checks.map((c) => c.met));
        return result(met, checks.map((c) => c.detail).join("; "));
    },

    attribute(node, state) {
        const have = state.attributes[node.attribute];
        if (have === undefined) return result(null, `${node.attribute.toUpperCase()} not found on the sheet`);
        const sign = (n) => (n >= 0 ? `+${n}` : String(n));
        return result(have >= node.value, `${node.attribute.toUpperCase()} ${sign(have)} (needs ${sign(node.value)})`);
    },

    level(node, state) {
        return result(state.level >= node.level, `Character level ${state.level} (needs ${node.level})`);
    },

    sense(node, state) {
        const has = state.senses.has(node.sense)
            || (node.sense === "low-light-vision" && (state.senses.has("darkvision") || state.senses.has("greater-darkvision")))
            || (node.sense === "darkvision" && state.senses.has("greater-darkvision"));
        const list = [...state.senses].join(", ") || "none";
        return result(has, `Senses: ${list}`);
    },

    trait(node, state) {
        return result(state.traits.has(node.trait), `Character traits ${state.traits.has(node.trait) ? "include" : "do not include"} "${node.trait}"`);
    },

    heritage(node, state) {
        const h = state.heritage;
        const met = !!h && (h.slug === node.heritage || slugify(h.name) === node.heritage);
        if (met) return result(true, `Heritage: ${h.name}`);
        return result(false, `Heritage: ${h?.name ?? "none"}`);
    },

    ancestry(node, state) {
        const a = state.ancestry;
        const met = (!!a && (a.slug === node.ancestry || slugify(a.name) === node.ancestry)) || state.traits.has(node.ancestry);
        return result(met, `Ancestry: ${a?.name ?? "none"}${met && a?.slug !== node.ancestry ? " (via trait)" : ""}`);
    },

    deity(node, state) {
        const d = state.deity;
        if (!node.deities) return result(!!d, `Deity: ${d?.name ?? "none"}`);
        if (!d) return result(false, "Deity: none");
        const met = node.deities.includes(d.slug) || node.deities.includes(slugify(d.name));
        return result(met, `Deity: ${d.name}`);
    },

    divineFont(node, state) {
        const d = state.deity;
        if (!d) return result(false, "Deity: none");
        if (!d.fonts?.length) return result(null, `Deity ${d.name}: divine font not recorded`);
        return result(d.fonts.includes(node.font), `Deity ${d.name} grants: ${d.fonts.join(", ")}`);
    },

    spellcasting(node, state) {
        const sc = state.spellcasting;
        const trads = node.traditions;
        switch (node.mode) {
            case "focus":
                return result(sc.focus, sc.focus ? "Has a focus pool" : "No focus pool");
            case "slots":
                return result(sc.slots, sc.slots ? "Casts spells from spell slots" : "No slot-based spellcasting");
            case "class": {
                if (!trads) return result(sc.classFeature, sc.classFeature ? "Has a spellcasting class feature" : "No spellcasting class feature");
                const met = trads.some((t) => sc.classTraditions.has(t));
                return result(met, `Class spellcasting traditions: ${[...sc.classTraditions].join(", ") || "none"}`);
            }
            case "rank":
                return result(sc.maxRank >= node.rank, `Highest spell rank: ${sc.maxRank || "none"} (needs ${node.rank})`);
            default: {
                if (!trads) return result(sc.any, sc.any ? "Can cast spells" : "Cannot cast spells");
                const met = trads.some((t) => sc.traditions.has(t));
                return result(met, `Spellcasting traditions: ${[...sc.traditions].join(", ") || "none"}`);
            }
        }
    },

    spell(node, state, ctx) {
        const found = hasName(state, node.spell, ["spell"]);
        if (found) return result(true, `Has spell ${found.name}`);
        return result(ctx.knownNames?.has(node.spell) ? false : null, `Spell "${titleCase(node.spell)}" not found on the sheet`);
    },

    language(node, state) {
        return result(state.languages.has(node.language), `Languages: ${[...state.languages].join(", ") || "none"}`);
    },

    featTraits(node, state) {
        const matching = state.feats.filter((f) => node.traits.every((t) => f.traits.has(t)));
        const met = matching.length >= node.count;
        const names = matching.map((f) => f.name).join(", ") || "none";
        return result(met, `Feats with trait(s) ${node.traits.join(" + ")}: ${names} (needs ${node.count})`);
    },

    named(node, state, ctx) {
        const found = hasName(state, node.slug);
        if (found) return result(true, `Found on sheet: ${found.name} (${found.type})`);
        const known = ctx.knownNames?.has(node.slug);
        return result(known ? false : null, known
            ? `"${node.name}" not found on the sheet`
            : `"${node.name}" not found on the sheet and not recognized in the system compendia`);
    },

    subclass(node, state, ctx) {
        const types = ["feat", "class", "heritage"];
        const found = hasName(state, node.slug, types) ?? hasName(state, node.part, types)
            ?? hasName(state, `${node.part}-${slugify(node.subclassKind)}`, types);
        if (found) return result(true, `Found on sheet: ${found.name}`);
        const known = ctx.knownNames?.has(node.slug) || ctx.knownNames?.has(node.part);
        return result(known ? false : null, `${titleCase(node.slug)} not found on the sheet`);
    },

    unknown() {
        return result(null, "Cannot be verified automatically – review manually");
    },
};

/* -------------------------------------------------------------------------- */
/*  Tree evaluation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} node parsed requirement node
 * @param {object} state actor state
 * @param {{ knownNames?: Set<string> }} [ctx]
 * @returns {{ met: boolean|null, text: string, kind: string, type?: string, detail?: string, children?: object[] }}
 */
export function evaluate(node, state, ctx = {}) {
    if (!node) return { kind: "leaf", type: "none", text: "", met: true, detail: "No prerequisites" };
    switch (node.kind) {
        case "all":
        case "any": {
            const children = node.children.map((c) => evaluate(c, state, ctx));
            const values = children.map((c) => c.met);
            const met = node.kind === "all" ? combineAll(values) : combineAny(values);
            return { kind: node.kind, text: node.text, met, children };
        }
        case "not": {
            const child = evaluate(node.child, state, ctx);
            const met = child.met === null ? null : !child.met;
            return { kind: "not", text: node.text, met, children: [child] };
        }
        default: {
            const matcher = MATCHERS[node.type] ?? MATCHERS.unknown;
            const { met, detail } = matcher(node, state, ctx);
            return { kind: "leaf", type: node.type, text: node.text, met, detail };
        }
    }
}

/** Collects the leaves of an evaluated tree. */
export function leaves(evaluated) {
    if (!evaluated) return [];
    if (evaluated.kind === "leaf") return [evaluated];
    return (evaluated.children ?? []).flatMap(leaves);
}
