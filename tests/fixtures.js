/**
 * Minimal stand-ins for PF2e documents, shaped like the prepared data the
 * module reads (actor.skills, actor.itemTypes, item.system...).
 */

let nextId = 1;

export function makeItem(type, name, system = {}, extra = {}) {
    const id = `item${nextId++}`;
    return { id, type, name, slug: system.slug ?? null, system, flags: {}, category: system.category, ...extra };
}

export function makeFeat(name, { level = 1, category = "class", taken = null, location = null, prerequisites = [], traits = [], ...rest } = {}) {
    return makeItem("feat", name, {
        level: { value: level, ...(taken != null ? { taken } : {}) },
        category,
        location,
        prerequisites: { value: prerequisites.map((value) => ({ value })) },
        traits: { value: traits, rarity: rest.rarity ?? "common" },
        maxTakable: rest.maxTakable ?? 1,
        onlyLevel1: rest.onlyLevel1 ?? false,
        publication: { remaster: rest.remaster ?? true, title: "Player Core" },
    }, rest.extra ?? {});
}

export function makeActor({ name = "Valeros", level = 5, items = [], skills = {}, abilities = {}, traits = ["human", "humanoid"], senses = [], perception = 2, saves = {}, attacks = {}, defenses = {}, focusMax = 0, languages = ["common"] } = {}) {
    const byType = {};
    for (const item of items) (byType[item.type] ??= []).push(item);
    const skillStats = {};
    for (const [slug, rank] of Object.entries(skills)) skillStats[slug] = { rank, lore: slug.endsWith("-lore") };
    const itemMap = new Map(items.map((i) => [i.id, i]));
    return {
        name,
        type: "character",
        level,
        items: Object.assign([...items], { get: (id) => itemMap.get(id) }),
        itemTypes: byType,
        skills: skillStats,
        abilities: Object.fromEntries(Object.entries({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, ...abilities }).map(([k, mod]) => [k, { mod }])),
        perception: { rank: perception, senses: senses.map((type) => ({ type })) },
        saves: Object.fromEntries(Object.entries({ fortitude: 1, reflex: 1, will: 1, ...saves }).map(([k, rank]) => [k, { rank }])),
        ancestry: byType.ancestry?.[0] ?? null,
        heritage: byType.heritage?.[0] ?? null,
        background: byType.background?.[0] ?? null,
        class: byType.class?.[0] ?? null,
        deity: byType.deity?.[0] ?? null,
        system: {
            traits: { value: traits },
            proficiencies: {
                attacks: Object.fromEntries(Object.entries({ unarmed: 1, simple: 1, martial: 0, advanced: 0, ...attacks }).map(([k, rank]) => [k, { rank }])),
                defenses: Object.fromEntries(Object.entries({ unarmored: 1, light: 0, medium: 0, heavy: 0, ...defenses }).map(([k, rank]) => [k, { rank }])),
            },
            resources: { focus: { max: focusMax, value: focusMax } },
            details: { languages: { value: languages } },
        },
    };
}
