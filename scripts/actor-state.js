/**
 * Reads a PF2e character actor into the plain "state" object used by the evaluator.
 * Every access is defensive so that minor data-model changes between PF2e
 * versions degrade to "unknown" instead of throwing.
 */

import { slugify } from "./parser.js";

const NAMED_ITEM_TYPES = ["feat", "spell", "action", "ancestry", "heritage", "background", "class", "deity", "lore"];
const ATTRIBUTE_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const SAVE_KEYS = ["fortitude", "reflex", "will"];
const ARMOR_KEYS = ["unarmored", "light", "medium", "heavy"];
const ATTACK_KEYS = ["unarmed", "simple", "martial", "advanced"];

function itemsOf(actor, type) {
    const fromTypes = actor.itemTypes?.[type];
    if (fromTypes) return [...fromTypes];
    return [...(actor.items ?? [])].filter((i) => i.type === type);
}

function itemSlug(item) {
    return item?.slug ?? item?.system?.slug ?? slugify(item?.name);
}

function rankOf(value) {
    const rank = typeof value === "object" && value !== null ? value.rank : value;
    return Number.isFinite(rank) ? rank : undefined;
}

function itemRef(item) {
    return item ? { slug: itemSlug(item), name: item.name } : null;
}

function readSkills(actor) {
    const skills = {};
    const lores = {};
    for (const [slug, stat] of Object.entries(actor.skills ?? {})) {
        const rank = rankOf(stat) ?? 0;
        if (stat?.lore || slug.endsWith("-lore")) lores[slug] = rank;
        else skills[slug] = rank;
    }
    // Fallback for data without prepared statistics
    if (Object.keys(skills).length === 0) {
        for (const [slug, data] of Object.entries(actor.system?.skills ?? {})) skills[slug] = rankOf(data) ?? 0;
    }
    for (const lore of itemsOf(actor, "lore")) {
        const slug = itemSlug(lore);
        const key = slug.endsWith("-lore") ? slug : `${slug}-lore`;
        lores[key] ??= rankOf(lore.system?.proficient?.value) ?? 0;
    }
    return { skills, lores };
}

function readAttributes(actor) {
    const out = {};
    for (const key of ATTRIBUTE_KEYS) {
        const mod = actor.abilities?.[key]?.mod ?? actor.system?.abilities?.[key]?.mod;
        if (Number.isFinite(mod)) out[key] = mod;
    }
    return out;
}

function readProficiencies(actor, spellcastingEntries) {
    const sys = actor.system ?? {};
    const out = {};
    const set = (key, value) => {
        const rank = rankOf(value);
        if (rank !== undefined) out[key] = rank;
    };
    set("perception", actor.perception ?? sys.perception);
    for (const save of SAVE_KEYS) set(save, actor.saves?.[save] ?? sys.saves?.[save]);
    set("class-dc", actor.classDC ?? sys.attributes?.classDC);
    for (const key of ARMOR_KEYS) set(`armor:${key}`, sys.proficiencies?.defenses?.[key]);
    for (const key of ATTACK_KEYS) set(`attack:${key}`, sys.proficiencies?.attacks?.[key]);

    set("spellcasting", sys.proficiencies?.spellcasting);
    const entryRanks = spellcastingEntries.map((e) => rankOf(e.statistic) ?? rankOf(e.system?.proficiency)).filter((r) => r !== undefined);
    if (entryRanks.length) out.spellcasting = Math.max(out.spellcasting ?? 0, ...entryRanks);
    return out;
}

function readSenses(actor) {
    const raw = actor.perception?.senses ?? actor.system?.perception?.senses ?? actor.system?.traits?.senses ?? [];
    const list = Array.isArray(raw) ? raw : [...(raw.values?.() ?? Object.values(raw))];
    return new Set(list.map((s) => slugify(typeof s === "string" ? s : s?.type ?? s?.label)).filter(Boolean));
}

function readSpellcasting(actor, entries) {
    const state = { any: false, classFeature: false, focus: false, slots: false, traditions: new Set(), classTraditions: new Set(), maxRank: 0 };
    const spells = itemsOf(actor, "spell");

    for (const entry of entries) {
        const kind = entry.system?.prepared?.value ?? entry.category;
        const tradition = entry.system?.tradition?.value ?? entry.tradition;
        const entrySpells = spells.filter((s) => s.system?.location?.value === entry.id);
        if (kind === "focus") {
            state.focus = true;
            continue;
        }
        if (kind === "ritual") continue;

        const isClass = kind === "prepared" || kind === "spontaneous";
        const hasSpells = entrySpells.length > 0 || isClass;
        if (!hasSpells) continue;
        state.any = true;
        if (tradition) state.traditions.add(tradition);
        if (isClass) {
            state.classFeature = true;
            state.slots = true;
            if (tradition) state.classTraditions.add(tradition);
            for (let rank = 10; rank >= 1; rank--) {
                if ((entry.system?.slots?.[`slot${rank}`]?.max ?? 0) > 0) {
                    state.maxRank = Math.max(state.maxRank, rank);
                    break;
                }
            }
        }
        for (const spell of entrySpells) {
            if (spell.isCantrip || spell.system?.traits?.value?.includes("cantrip")) continue;
            const rank = spell.rank ?? spell.system?.location?.heightenedLevel ?? spell.system?.level?.value ?? 0;
            state.maxRank = Math.max(state.maxRank, rank);
        }
    }
    if ((actor.system?.resources?.focus?.max ?? 0) > 0) state.focus = true;
    return state;
}

/**
 * @param {Actor} actor PF2e character
 * @returns {object} state consumed by evaluator.evaluate()
 */
export function buildActorState(actor) {
    const { skills, lores } = readSkills(actor);
    const spellcastingEntries = itemsOf(actor, "spellcastingEntry");
    const deityItem = actor.deity ?? itemsOf(actor, "deity")[0] ?? null;

    const names = new Map();
    const addName = (slug, item) => {
        if (!slug) return;
        const list = names.get(slug) ?? [];
        list.push({ type: item.type, name: item.name, id: item.id });
        names.set(slug, list);
    };
    for (const type of NAMED_ITEM_TYPES) {
        for (const item of itemsOf(actor, type)) {
            const slug = itemSlug(item);
            addName(slug, item);
            const nameSlug = slugify(item.name);
            if (nameSlug !== slug) addName(nameSlug, item);
        }
    }

    const traits = new Set(actor.system?.traits?.value ?? []);
    for (const ref of [actor.ancestry, actor.heritage]) {
        for (const t of ref?.system?.traits?.value ?? []) {
            if (!["common", "uncommon", "rare", "unique"].includes(t)) traits.add(t);
        }
    }
    if (actor.ancestry) traits.add(itemSlug(actor.ancestry));

    const feats = itemsOf(actor, "feat").map((f) => ({
        id: f.id,
        slug: itemSlug(f),
        name: f.name,
        category: f.category ?? f.system?.category,
        traits: new Set(f.system?.traits?.value ?? []),
    }));

    return {
        name: actor.name,
        level: actor.level ?? actor.system?.details?.level?.value ?? 1,
        ancestry: itemRef(actor.ancestry),
        heritage: itemRef(actor.heritage),
        background: itemRef(actor.background),
        class: itemRef(actor.class),
        deity: deityItem ? { ...itemRef(deityItem), fonts: [...(deityItem.system?.font ?? [])] } : null,
        traits,
        skills,
        lores,
        attributes: readAttributes(actor),
        proficiencies: readProficiencies(actor, spellcastingEntries),
        senses: readSenses(actor),
        languages: new Set((actor.system?.details?.languages?.value ?? []).map(slugify)),
        spellcasting: readSpellcasting(actor, spellcastingEntries),
        names,
        feats,
    };
}
