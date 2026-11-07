import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrerequisite, parsePrerequisites, slugify } from "../scripts/parser.js";

const known = new Set(["battle-medicine", "strike-rivers-seize-winds", "sword-and-pistol", "quick-repair"]);
const p = (text) => parsePrerequisite(text, { knownNames: known });

test("slugify matches PF2e-style slugs", () => {
    assert.equal(slugify("Witch's Charge"), "witchs-charge");
    assert.equal(slugify("Jotun’s Battle Stance"), "jotuns-battle-stance");
    assert.equal(slugify("  Low-Light Vision "), "low-light-vision");
});

test("skill ranks", () => {
    assert.deepEqual(p("trained in Medicine"), { kind: "leaf", text: "trained in Medicine", type: "skill", skill: "medicine", rank: 1 });
    assert.equal(p("legendary in Survival").rank, 4);
    assert.equal(p("master at Deception").skill, "deception");
});

test("skill lists become any-of", () => {
    const node = p("master in either Arcana, Nature, Occultism, or Religion");
    assert.equal(node.kind, "any");
    assert.deepEqual(node.children.map((c) => c.skill), ["arcana", "nature", "occultism", "religion"]);
    assert.ok(node.children.every((c) => c.rank === 3));
});

test("lore skills", () => {
    assert.deepEqual(p("expert in Warfare Lore"), { kind: "leaf", text: "expert in Warfare Lore", type: "lore", lore: "warfare-lore", rank: 2 });
    assert.equal(p("trained in Lore").lore, null);
    const mixed = p("expert in Crafting, Herbalism Lore, or Medicine");
    assert.deepEqual(mixed.children.map((c) => c.type), ["skill", "lore", "skill"]);
    assert.equal(p("master in Crafting, Performance, or a Lore skill").children[2].type, "lore");
});

test("generic skill requirements", () => {
    assert.equal(p("trained in at least one skill").type, "anySkill");
    assert.equal(p("trained in a skill with the Recall Knowledge action").filter, "recall-knowledge");
    assert.equal(p("master in a Decipher Writing skill").filter, "decipher-writing");
});

test("proficiencies", () => {
    assert.equal(p("expert in Perception").stat, "perception");
    assert.equal(p("expert in Will").stat, "will");
    assert.deepEqual(p("expert in at least one saving throw").stat, ["fortitude", "reflex", "will"]);
    assert.equal(p("trained in all martial weapons").stat, "attack:martial");
    const armor = p("trained in light or medium armor");
    assert.equal(armor.kind, "any");
    assert.deepEqual(armor.children.map((c) => c.stat), ["armor:light", "armor:medium"]);
});

test("attributes", () => {
    assert.deepEqual(p("Strength +2"), { kind: "leaf", text: "Strength +2", type: "attribute", attribute: "str", value: 2 });
    const any = p("Strength, Dexterity, or Constitution +2");
    assert.equal(any.kind, "any");
    assert.deepEqual(any.children.map((c) => c.attribute), ["str", "dex", "con"]);
    assert.equal(p("Charisma 14").value, 2); // legacy score
});

test("or-combinations of different requirement types", () => {
    const node = p("Charisma +2 or ability to cast spells from spell slots");
    assert.equal(node.kind, "any");
    assert.deepEqual(node.children.map((c) => c.type), ["attribute", "spellcasting"]);
    const mix = p("leaf leshy heritage or Cat Fall skill feat");
    assert.deepEqual(mix.children.map((c) => c.type), ["heritage", "named"]);
    assert.equal(mix.children[1].slug, "cat-fall");
});

test("named feats and known names with conjunctions", () => {
    assert.equal(p("Battle Medicine").type, "named");
    assert.equal(p("Druid Dedication or Wizard Dedication").kind, "any");
    assert.equal(p("Strike Rivers, Seize Winds").type, "named");
    assert.equal(p("Sword and Pistol").slug, "sword-and-pistol");
    const comma = p("master in Crafting, Quick Repair");
    assert.equal(comma.kind, "all");
    assert.deepEqual(comma.children.map((c) => c.type), ["skill", "named"]);
});

test("ancestry, heritage, senses, sanctification", () => {
    assert.equal(p("snow goblin heritage").heritage, "snow-goblin");
    assert.equal(p("low-light vision").sense, "low-light-vision");
    assert.equal(p("darkvision").type, "sense");
    assert.equal(p("holy or unholy").kind, "any");
    const notHoly = p("you are not holy");
    assert.equal(notHoly.kind, "not");
    assert.equal(notHoly.child.trait, "holy");
});

test("deities and fonts", () => {
    assert.deepEqual(p("worshipper of Torag or Angradd").deities, ["torag", "angradd"]);
    assert.equal(p("you follow a deity").deities, null);
    assert.equal(p("deity who grants heal divine font").font, "heal");
    assert.equal(p("can't have a patron deity").kind, "not");
});

test("spellcasting", () => {
    assert.equal(p("focus pool").mode, "focus");
    assert.equal(p("Able to cast spells").mode, "any");
    assert.equal(p("ability to cast fireball").spell, "fireball");
    assert.equal(p("devotion spell (lay on hands)").spell, "lay-on-hands");
    assert.deepEqual(p("You have a spellcasting class feature with the divine or primal tradition").traditions, ["divine", "primal"]);
    assert.equal(p("able to cast 3rd-rank spells").rank, 3);
});

test("subclasses", () => {
    const order = p("flame order");
    assert.equal(order.type, "subclass");
    assert.equal(order.part, "flame");
    const inn = p("armor, construct, or weapon innovation");
    assert.deepEqual(inn.children.map((c) => c.slug), ["armor-innovation", "construct-innovation", "weapon-innovation"]);
});

test("feat traits and negation", () => {
    assert.deepEqual(p("any nephilim lineage feat").traits, ["lineage", "nephilim"]);
    assert.equal(p("at least two stances").count, 2);
    const neg = p("you can't already use the Rage action");
    assert.equal(neg.kind, "not");
    assert.equal(neg.child.slug, "rage");
});

test("narrative prerequisites are unknown, not split", () => {
    for (const text of [
        "member of the Zephyr Guard",
        "You have died at least once",
        "you have broken or forsaken the Aldori swordpact",
        "expert in any kind of weapon or unarmed attack",
        "ability to create or control undead",
    ]) {
        assert.equal(p(text).type, "unknown", text);
    }
});

test("parsePrerequisites joins entries with AND", () => {
    const tree = parsePrerequisites(["Battle Medicine", "master in Medicine"], { knownNames: known });
    assert.equal(tree.kind, "all");
    assert.equal(tree.children.length, 2);
    assert.equal(parsePrerequisites([]), null);
});
