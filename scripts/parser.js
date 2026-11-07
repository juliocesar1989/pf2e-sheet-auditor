/**
 * Prerequisite parser for Pathfinder 2e (Remaster) feats, English text only.
 *
 * Turns the free-text strings stored in `feat.system.prerequisites.value[].value`
 * into a requirement tree:
 *
 *   { kind: "all" | "any", text, children: Node[] }
 *   { kind: "not", text, child: Node }
 *   { kind: "leaf", text, type, ...typeSpecificFields }
 *
 * This file has no Foundry dependencies so it can be unit tested with Node.
 */

export const RANKS = Object.freeze({ untrained: 0, trained: 1, expert: 2, master: 3, legendary: 4 });
export const RANK_LABELS = Object.freeze(["untrained", "trained", "expert", "master", "legendary"]);

export const SKILLS = Object.freeze([
    "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine",
    "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery",
]);

export const ATTRIBUTES = Object.freeze({
    strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
});

export const TRADITIONS = Object.freeze(["arcane", "divine", "occult", "primal"]);

export const SENSES = Object.freeze([
    "low-light vision", "darkvision", "greater darkvision", "scent", "tremorsense", "echolocation",
    "lifesense", "thoughtsense", "wavesense", "see invisibility", "truesight",
]);

/** Subclass-style class features written as "<name> <kind>", e.g. "flame order", "enigma muse". */
const SUBCLASS_KINDS = [
    "research field", "hybrid study", "sorcerer bloodline", "bloodline", "muse", "order", "cause", "doctrine",
    "methodology", "innovation", "school", "patron", "mystery", "instinct", "racket", "implement", "conscious mind",
    "subconscious mind", "element", "style", "way", "eidolon", "apparition", "ikon",
];

const NAMED_STOP_WORDS =
    /\b(you|your|you're|must|have|has|had|are|is|was|were|can|can't|cannot|member|any|least|ability|able|who|which|with|whose|that|than|per|seen|died|dead|willing|ally|kind)\b/i;

/** Lowercase slug compatible with the PF2e system's `sluggify` for English names. */
export function slugify(text) {
    return String(text ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/['’`]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function cleanText(text) {
    return String(text ?? "")
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.;,]+$/, "")
        .trim();
}

function leaf(text, type, fields = {}) {
    return { kind: "leaf", text, type, ...fields };
}

function group(kind, text, children) {
    if (children.length === 1) return children[0];
    return { kind, text, children };
}

function ordinal(n) {
    return Number(String(n).replace(/\D/g, ""));
}

/* -------------------------------------------------------------------------- */
/*  Proficiency targets ("trained in <target>")                               */
/* -------------------------------------------------------------------------- */

const ARMOR_CATEGORIES = ["unarmored", "light", "medium", "heavy"];
const ATTACK_CATEGORIES = ["unarmed", "simple", "martial", "advanced"];
const SAVES = ["fortitude", "reflex", "will"];

/**
 * Converts one item of a proficiency list into a descriptor, or null if unknown.
 * @returns {{type: string, [k: string]: unknown} | null}
 */
export function parseProficiencyTarget(raw) {
    const item = raw
        .toLowerCase()
        .replace(/^(?:the|a|an|any|either|both|all)\s+/, "")
        .replace(/\s+(?:proficiency|proficiencies)$/, "")
        .trim();

    if (SKILLS.includes(item)) return { type: "skill", skill: item };
    if (/^(?:skill|at least one skill|one skill)$/.test(item)) return { type: "anySkill", filter: null };
    if (/^(?:skill with the recall knowledge action|recall knowledge skill)$/.test(item)) {
        return { type: "anySkill", filter: "recall-knowledge" };
    }
    if (/^decipher writing skill$/.test(item)) return { type: "anySkill", filter: "decipher-writing" };

    if (/^(?:at least one )?lore(?: skill)?$/.test(item)) return { type: "lore", lore: null };
    const lore = item.match(/^([a-z][a-z' -]*?) lore$/);
    if (lore) return { type: "lore", lore: slugify(`${lore[1]} lore`) };

    if (item === "perception") return { type: "proficiency", stat: "perception" };
    const save = item.match(/^(fortitude|reflex|will)(?: saves?| saving throws?)?$/);
    if (save) return { type: "proficiency", stat: save[1] };
    if (/^(?:at least one |one )?saving throws?$/.test(item)) {
        return { type: "proficiency", stat: SAVES, mode: "any" };
    }
    if (/^class dcs?$/.test(item)) return { type: "proficiency", stat: "class-dc" };
    if (/^(?:spell attack (?:rolls?|modifiers?)|spell dcs?|spellcasting|spell attack modifiers? and spell dcs?)$/.test(item)) {
        return { type: "proficiency", stat: "spellcasting" };
    }

    if (/^unarmored defense$/.test(item)) return { type: "proficiency", stat: "armor:unarmored" };
    const armor = item.match(/^(unarmored|light|medium|heavy) armor$/);
    if (armor) return { type: "proficiency", stat: `armor:${armor[1]}` };
    if (/^unarmed (?:attacks?|strikes?)$/.test(item)) return { type: "proficiency", stat: "attack:unarmed" };
    const attack = item.match(/^(simple|martial|advanced) weapons?$/);
    if (attack) return { type: "proficiency", stat: `attack:${attack[1]}` };

    return null;
}

/** "light or medium armor" → ["light armor", "medium armor"] */
function distributeSuffixes(items) {
    const suffixes = [
        { re: /\barmor$/, bare: ARMOR_CATEGORIES, suffix: "armor" },
        { re: /\bweapons?$/, bare: ATTACK_CATEGORIES.filter((c) => c !== "unarmed"), suffix: "weapons" },
        { re: /\bsav(?:es?|ing throws?)$/, bare: SAVES, suffix: "saves" },
    ];
    for (const { re, bare, suffix } of suffixes) {
        if (!items.some((i) => re.test(i.toLowerCase()))) continue;
        items = items.map((i) => (bare.includes(i.toLowerCase()) ? `${i} ${suffix}` : i));
    }
    return items;
}

function splitList(text) {
    return text
        .split(/\s*,\s*(?:or|and)\s+|\s*,\s*|\s+(?:or|and)\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseRankRequirement(text) {
    const m = text.match(/^(?:you are |you're )?(?:at least )?(trained|expert|master|legendary) (?:in|with|at) (.+)$/i);
    if (!m) return null;
    const rank = RANKS[m[1].toLowerCase()];
    const body = m[2].replace(/^(?:either|both)\s+/i, "");

    const whole = parseProficiencyTarget(body);
    if (whole) return leaf(text, whole.type, { ...whole, rank });

    const hasOr = /\bor\b/i.test(body);
    const hasAnd = /\band\b/i.test(body);
    if (hasOr && hasAnd) return null; // ambiguous mix, leave for manual review

    const items = distributeSuffixes(splitList(body));
    const parsed = items.map(parseProficiencyTarget);
    if (items.length < 2 || parsed.some((p) => !p)) return null;

    const all = /^all\s/i.test(m[2]) || (hasAnd && !hasOr);
    const children = parsed.map((p, i) => leaf(`${m[1]} in ${items[i]}`, p.type, { ...p, rank }));
    return group(all ? "all" : "any", text, children);
}

/* -------------------------------------------------------------------------- */
/*  Other leaf parsers                                                        */
/* -------------------------------------------------------------------------- */

function parseAttribute(text) {
    // Remaster: "Strength +2"; also "Strength, Dexterity, or Constitution +2"; legacy: "Strength 14"
    const m = text.match(/^((?:strength|dexterity|constitution|intelligence|wisdom|charisma)(?:(?:\s*,\s*|\s+)(?:or\s+|and\s+)?(?:strength|dexterity|constitution|intelligence|wisdom|charisma))*)\s+(\+\d+|\d{2})$/i);
    if (!m) return null;
    const value = m[2].startsWith("+") ? Number(m[2]) : Math.floor((Number(m[2]) - 10) / 2);
    const names = m[1].toLowerCase().match(/strength|dexterity|constitution|intelligence|wisdom|charisma/g);
    const all = /\band\b/i.test(m[1]);
    const children = names.map((n) => leaf(`${n[0].toUpperCase()}${n.slice(1)} +${value}`, "attribute", { attribute: ATTRIBUTES[n], value }));
    return group(all ? "all" : "any", text, children);
}

function parseLevel(text) {
    const m = text.match(/^(?:(?:at least|character) )?level (\d+)$/i) ?? text.match(/^(?:at least )?(\d+)(?:st|nd|rd|th) level$/i);
    return m ? leaf(text, "level", { level: ordinal(m[1]) }) : null;
}

function parseSense(text) {
    const m = text.toLowerCase().match(/^(?:you have )?(?:the )?(.+?)(?: sense)?$/);
    const sense = m?.[1];
    return sense && SENSES.includes(sense) ? leaf(text, "sense", { sense: slugify(sense) }) : null;
}

function parseAncestry(text) {
    const lower = text.toLowerCase();
    const heritage = lower.match(/^(?:the )?([a-z][a-z' -]*?) heritage$/);
    if (heritage && !/\b(any|versatile)\b/.test(heritage[1])) {
        return leaf(text, "heritage", { heritage: slugify(heritage[1]) });
    }
    const ancestry = lower.match(/^(?:the )?([a-z][a-z' -]*?) ancestry$/);
    if (ancestry && !/\bany\b/.test(ancestry[1])) return leaf(text, "ancestry", { ancestry: slugify(ancestry[1]) });
    return null;
}

function parseSanctification(text) {
    const lower = text.toLowerCase();
    const notHoly = lower.match(/^you are not (holy|unholy)$/);
    if (notHoly) return { kind: "not", text, child: leaf(notHoly[1], "trait", { trait: notHoly[1] }) };
    const m = lower.match(/^(?:you are )?(holy|unholy)(?: or (holy|unholy))?(?: trait| sanctification)?$/);
    if (!m) return null;
    const traits = [m[1], m[2]].filter(Boolean);
    return group("any", text, traits.map((t) => leaf(t, "trait", { trait: t })));
}

function parseDeity(text) {
    const lower = text.toLowerCase();
    const font = lower.match(/^(?:a )?deity (?:who|that) grants (heal|harm|healing|harmful) (?:as a |as their )?(?:divine )?font$/);
    if (font) return leaf(text, "divineFont", { font: font[1].startsWith("heal") ? "heal" : "harm" });

    if (/^(?:you )?(?:follow|worship|have) a deity$|^(?:follower|worshipper) of a deity$/.test(lower)) {
        return leaf(text, "deity", { deities: null });
    }
    if (/^(?:you )?(?:can't|cannot) have a (?:patron )?deity$/.test(lower)) {
        return { kind: "not", text, child: leaf("a deity", "deity", { deities: null }) };
    }
    const named = text.match(/^(?:you )?(?:are an? )?(?:worshipper|worshiper|follower|worship|follow)s? of (.+)$/i)
        ?? text.match(/^you (?:worship|follow) (.+)$/i);
    if (named && !/\b(specific|religion|philosophy|laws?)\b/i.test(named[1])) {
        const deities = splitList(named[1]).map(slugify);
        return leaf(text, "deity", { deities });
    }
    return null;
}

function parseSpellcasting(text) {
    const lower = text.toLowerCase();
    if (/^(?:a )?focus pool$|^(?:the )?ability to cast focus spells$|^you have a focus pool$/.test(lower)) {
        return leaf(text, "spellcasting", { mode: "focus" });
    }
    if (/^(?:the )?ability to cast spells from spell slots$|^spell slots$/.test(lower)) {
        return leaf(text, "spellcasting", { mode: "slots" });
    }
    if (/^(?:the )?(?:ability|able) to cast (?:a )?spells?$|^(?:you can )?cast spells$/.test(lower)) {
        return leaf(text, "spellcasting", { mode: "any" });
    }
    if (/^(?:you have )?(?:a |the )?spellcasting class feature$/.test(lower)) {
        return leaf(text, "spellcasting", { mode: "class" });
    }
    const trad = lower.match(/^(?:the )?ability to cast (arcane|divine|occult|primal) spells$/);
    if (trad) return leaf(text, "spellcasting", { mode: "any", traditions: [trad[1]] });

    const classTrad = lower.match(/^(?:you have )?a spellcasting class feature with the (arcane|divine|occult|primal)(?:,? or (arcane|divine|occult|primal))? tradition$/);
    if (classTrad) {
        return leaf(text, "spellcasting", { mode: "class", traditions: [classTrad[1], classTrad[2]].filter(Boolean) });
    }
    const rank = lower.match(/^(?:the )?(?:ability|able) to cast (\d+)(?:st|nd|rd|th)[- ](?:rank|level) spells$/);
    if (rank) return leaf(text, "spellcasting", { mode: "rank", rank: ordinal(rank[1]) });

    const devotion = lower.match(/^(?:devotion|focus) spell \(([a-z][a-z' -]*)\)$/);
    if (devotion) return leaf(text, "spell", { spell: slugify(devotion[1]) });

    const spell = lower.match(/^(?:the )?ability to cast ([a-z][a-z' -]*)$/);
    if (spell && !/\b(spells?|or|from|undead)\b/.test(spell[1])) return leaf(text, "spell", { spell: slugify(spell[1]) });
    return null;
}

function parseLanguage(text) {
    const m = text.match(/^(?:you can )?speak (?:the )?([A-Za-z-]+)(?: language)?$/i) ?? text.match(/^([A-Za-z-]+) language$/i);
    return m ? leaf(text, "language", { language: slugify(m[1]) }) : null;
}

function parseFeatTraits(text) {
    const lower = text.toLowerCase();
    const lineage = lower.match(/^(?:any |an? )?([a-z-]+) lineage feat$/);
    if (lineage) return leaf(text, "featTraits", { traits: ["lineage", slugify(lineage[1])], count: 1 });
    const withTrait = lower.match(/^(?:any |an? )?feat with the ([a-z-]+) trait$/);
    if (withTrait) return leaf(text, "featTraits", { traits: [withTrait[1]], count: 1 });
    const words = { one: 1, two: 2, three: 3, four: 4 };
    const stances = lower.match(/^at least (one|two|three|four|\d+) (stance|dedication|archetype)s?(?: feats?)?$/);
    if (stances) {
        return leaf(text, "featTraits", { traits: [stances[2]], count: words[stances[1]] ?? Number(stances[1]) });
    }
    return null;
}

function parseNegation(text) {
    const m = text.match(/^you (?:can't|cannot|don't|do not) (?:already )?(?:use the |have (?:the |a |an )?)(.+?)(?: action| feat| class feature| ability)?$/i);
    if (!m) return null;
    return { kind: "not", text, child: parseNamed(m[1]) ?? leaf(m[1], "unknown") };
}

function parseSubclass(text) {
    const lower = text.toLowerCase();
    for (const kind of SUBCLASS_KINDS) {
        const m = lower.match(new RegExp(`^(?:the )?([a-z][a-z' -]*?) ${kind}$`));
        if (m && m[1].split(" ").length <= 3) {
            return leaf(text, "subclass", { slug: slugify(lower), part: slugify(m[1]), subclassKind: kind });
        }
    }
    const way = lower.match(/^way of the ([a-z' -]+)$/);
    if (way) return leaf(text, "subclass", { slug: slugify(lower), part: slugify(way[1]), subclassKind: "way" });
    return null;
}

/** "armor, construct, or weapon innovation" → each part gets "innovation". */
function distributeSubclassKind(parts) {
    const last = parts.at(-1)?.toLowerCase() ?? "";
    const kind = SUBCLASS_KINDS.find((k) => last.endsWith(` ${k}`));
    if (!kind) return parts;
    const bare = parts.slice(0, -1);
    if (!bare.every((p) => p.split(/\s+/).length <= 2 && !p.toLowerCase().endsWith(kind))) return parts;
    return [...bare.map((p) => `${p} ${kind}`), parts.at(-1)];
}

/** A specific named thing (feat, class feature, spell...). */
function parseNamed(text) {
    const name = text
        .replace(/^(?:the|a|an)\s+/i, "")
        .replace(/\s+(?:skill feat|general feat|class feat|ancestry feat|feat|class feature|action|reaction)$/i, "")
        .trim();
    if (!name || name.split(/\s+/).length > 6 || NAMED_STOP_WORDS.test(name) || /[()"]/.test(name)) return null;
    return leaf(text, "named", { name, slug: slugify(name) });
}

const LEAF_PARSERS = [
    parseRankRequirement,
    parseAttribute,
    parseLevel,
    parseSense,
    parseSanctification,
    parseDeity,
    parseSpellcasting,
    parseLanguage,
    parseFeatTraits,
    parseNegation,
    parseAncestry,
];

/**
 * Parses a single prerequisite string.
 * @param {string} raw
 * @param {{ knownNames?: Set<string> }} [options] knownNames: slugs of every feat/feature/spell in the
 *   system compendia. Used to keep names like "Sword and Pistol" from being split on "and".
 */
export function parsePrerequisite(raw, options = {}) {
    const text = cleanText(raw);
    if (!text) return leaf(text, "unknown");
    const known = options.knownNames;

    for (const parser of LEAF_PARSERS) {
        const node = parser(text);
        if (node) return node;
    }

    if (known?.has(slugify(text))) return leaf(text, "named", { name: text, slug: slugify(text) });
    const stripped = parseNamed(text);
    if (stripped && known?.has(stripped.slug)) return stripped;

    // Sentences ("you have...", "ability to...") are not split further.
    if (/^(?:you|your|must|ability|able)\b/i.test(text)) return leaf(text, "unknown");

    // A rank requirement that failed as a whole ("trained in Medicine or <something else>"):
    // split on "or" only if the first alternative is itself a valid rank requirement.
    if (/^(?:trained|expert|master|legendary) (?:in|with|at) /.test(text) && /\bor\b/i.test(text)) {
        const [first, ...rest] = text.split(/\s*,?\s+or\s+/i);
        const head = parseRankRequirement(first);
        if (!head || rest.length === 0) return leaf(text, "unknown");
        return group("any", text, [head, ...rest.map((t) => parsePrerequisite(t, options))]);
    }

    // "A, B, or C" → any; "A; B" / "A, B" → all
    if (text.includes(";")) {
        return group("all", text, text.split(/\s*;\s*/).filter(Boolean).map((t) => parsePrerequisite(t, options)));
    }
    if (/\bor\b/i.test(text) && !/\b(?:as well as|and)\b/i.test(text)) {
        const parts = distributeSubclassKind(text.replace(/^either\s+/i, "").split(/\s*,\s*or\s+|\s*,\s*|\s+or\s+/i).filter(Boolean));
        if (parts.length > 1) return group("any", text, parts.map((t) => parsePrerequisite(t, options)));
    }
    if (/,/.test(text) && !/\bor\b/i.test(text)) {
        const parts = text.split(/\s*,\s*(?:and\s+)?/).filter(Boolean);
        if (parts.length > 1) return group("all", text, parts.map((t) => parsePrerequisite(t, options)));
    }

    return parseSubclass(text) ?? stripped ?? leaf(text, "unknown");
}

/**
 * Parses every prerequisite of a feat into one tree (implicit AND between entries).
 * @param {string[]} texts
 */
export function parsePrerequisites(texts, options = {}) {
    const children = (texts ?? []).map((t) => cleanText(t)).filter(Boolean).map((t) => parsePrerequisite(t, options));
    if (children.length === 0) return null;
    return group("all", "All prerequisites", children);
}
