import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActorState } from "../scripts/actor-state.js";
import { auditFeats, featRecordFromItem } from "../scripts/auditor.js";
import { evaluate } from "../scripts/evaluator.js";
import { parsePrerequisite } from "../scripts/parser.js";
import { buildReportHtml, escapeHtml } from "../scripts/report-html.js";
import { makeActor, makeFeat, makeItem } from "./fixtures.js";

const knownNames = new Set(["battle-medicine", "power-attack", "sudden-charge", "fighter-dedication", "rogue-dedication", "flame-order", "shield-block"]);

function audit(actor) {
    const state = buildActorState(actor);
    const records = actor.itemTypes.feat.map((i) => featRecordFromItem(i, actor));
    return auditFeats(records, state, { knownNames });
}

function find(report, name) {
    return report.feats.find((f) => f.name === name);
}

test("actor state reads skills, lores, attributes, senses and names", () => {
    const actor = makeActor({
        skills: { medicine: 2, athletics: 1, "warfare-lore": 1 },
        abilities: { str: 4 },
        senses: ["darkvision"],
        items: [makeItem("ancestry", "Dwarf", { slug: "dwarf", traits: { value: ["dwarf", "humanoid"] } }), makeFeat("Battle Medicine", { category: "skill" })],
    });
    const state = buildActorState(actor);
    assert.equal(state.skills.medicine, 2);
    assert.equal(state.lores["warfare-lore"], 1);
    assert.equal(state.attributes.str, 4);
    assert.ok(state.senses.has("darkvision"));
    assert.ok(state.traits.has("dwarf"));
    assert.ok(state.names.has("battle-medicine"));
    assert.equal(state.proficiencies["attack:martial"], 0);
});

test("three-valued evaluation", () => {
    const state = buildActorState(makeActor({ skills: { medicine: 1 }, senses: ["darkvision"] }));
    const ctx = { knownNames };
    assert.equal(evaluate(parsePrerequisite("trained in Medicine"), state, ctx).met, true);
    assert.equal(evaluate(parsePrerequisite("master in Medicine"), state, ctx).met, false);
    assert.equal(evaluate(parsePrerequisite("low-light vision"), state, ctx).met, true, "darkvision satisfies low-light vision");
    assert.equal(evaluate(parsePrerequisite("Battle Medicine"), state, ctx).met, false, "known feat, missing");
    assert.equal(evaluate(parsePrerequisite("Mystery Homebrew Thing"), state, ctx).met, null, "unrecognized name");
    assert.equal(evaluate(parsePrerequisite("member of the Zephyr Guard"), state, ctx).met, null);
    assert.equal(evaluate(parsePrerequisite("trained in Medicine or member of the Zephyr Guard"), state, ctx).met, true);
});

test("audit flags unmet prerequisites and passes met ones", () => {
    const actor = makeActor({
        level: 4,
        skills: { medicine: 1, athletics: 2 },
        items: [
            makeFeat("Battle Medicine", { category: "skill", taken: 2, prerequisites: ["trained in Medicine"] }),
            makeFeat("Paragon Battle Medicine", { category: "skill", level: 7, taken: 4, prerequisites: ["Battle Medicine", "master in Medicine"] }),
            makeFeat("Titan Wrestler", { category: "skill", taken: 2, prerequisites: ["trained in Athletics"] }),
        ],
    });
    const report = audit(actor);
    assert.equal(find(report, "Battle Medicine").status, "ok");
    assert.equal(find(report, "Titan Wrestler").status, "ok");
    const paragon = find(report, "Paragon Battle Medicine");
    assert.equal(paragon.status, "fail");
    assert.equal(paragon.met, false);
    assert.ok(paragon.issues.some((i) => /higher than the character level/.test(i.message)));
    assert.equal(report.summary.fail, 1);
    assert.equal(report.feats[0].name, "Paragon Battle Medicine", "failures sorted first");
});

test("unverifiable prerequisites are marked for review", () => {
    const report = audit(makeActor({ items: [makeFeat("Odd Feat", { prerequisites: ["You have died at least once"] })] }));
    assert.equal(find(report, "Odd Feat").status, "review");
});

test("structural rules: onlyLevel1, maxTakable, legacy, granted", () => {
    const granter = makeItem("feat", "Some Class Feature", { category: "classfeature", level: { value: 1 }, traits: { value: [] }, prerequisites: { value: [] } });
    const granted = makeFeat("Shield Block", { category: "general", prerequisites: ["master in Medicine"] });
    granted.flags = { pf2e: { grantedBy: { id: granter.id } } };
    const actor = makeActor({
        level: 5,
        items: [
            granter,
            granted,
            makeFeat("Natural Ambition", { category: "ancestry", taken: 5, onlyLevel1: true }),
            makeFeat("Toughness", { category: "general", taken: 3 }),
            makeFeat("Toughness", { category: "general", taken: 5 }),
            makeFeat("Old Feat", { category: "general", taken: 1, remaster: false }),
        ],
    });
    const report = audit(actor);
    assert.equal(find(report, "Shield Block").status, "waived");
    assert.equal(find(report, "Natural Ambition").status, "fail");
    assert.ok(report.feats.filter((f) => f.name === "Toughness").every((f) => f.status === "fail"));
    const old = find(report, "Old Feat");
    assert.equal(old.status, "ok");
    assert.ok(old.issues.some((i) => i.severity === "warning" && /Legacy/.test(i.message)));
    assert.deepEqual(report.skipped, [{ name: "Some Class Feature", category: "classfeature" }]);
});

test("taken level falls back to the feat slot location", () => {
    const record = featRecordFromItem(makeFeat("X", { location: "class-6" }), null);
    assert.equal(record.takenAt, 6);
});

test("archetype dedication rule", () => {
    const actor = makeActor({
        level: 8,
        items: [
            makeFeat("Fighter Dedication", { taken: 2, traits: ["archetype", "dedication"] }),
            makeFeat("Basic Maneuver", { taken: 4, traits: ["archetype"], prerequisites: ["Fighter Dedication"] }),
            makeFeat("Rogue Dedication", { taken: 6, traits: ["archetype", "dedication"] }),
        ],
    });
    let report = audit(actor);
    const fighter = find(report, "Fighter Dedication");
    assert.equal(fighter.status, "fail");
    assert.ok(fighter.issues.some((i) => /two other feats/.test(i.message)));

    actor.itemTypes.feat.push(makeFeat("Opportunist", { taken: 5, traits: ["archetype"], prerequisites: ["Fighter Dedication"] }));
    report = audit(actor);
    assert.equal(find(report, "Fighter Dedication").status, "ok");
});

test("subclass, deity and spellcasting checks", () => {
    const actor = makeActor({
        focusMax: 1,
        items: [
            makeItem("feat", "Flame Order", { category: "classfeature", level: { value: 1 }, traits: { value: [] }, prerequisites: { value: [] } }),
            makeItem("deity", "Sarenrae", { slug: "sarenrae", font: ["heal"] }),
            makeFeat("Fire Feat", { prerequisites: ["flame order"] }),
            makeFeat("Font Feat", { prerequisites: ["deity who grants heal divine font"] }),
            makeFeat("Focus Feat", { prerequisites: ["focus pool"] }),
            makeFeat("Torag Feat", { prerequisites: ["worshipper of Torag"] }),
        ],
    });
    const report = audit(actor);
    assert.equal(find(report, "Fire Feat").status, "ok");
    assert.equal(find(report, "Font Feat").status, "ok");
    assert.equal(find(report, "Focus Feat").status, "ok");
    assert.equal(find(report, "Torag Feat").status, "fail");
});

test("HTML report is standalone and escapes text", () => {
    const actor = makeActor({ name: "<script>alert(1)</script>", items: [makeFeat("Bad <b>Feat</b>", { prerequisites: ["master in Medicine"] })] });
    const html = buildReportHtml(audit(actor), { generatedAt: new Date("2026-01-01T00:00:00Z"), moduleVersion: "0.1.0" });
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("Bad &lt;b&gt;Feat&lt;/b&gt;"));
    assert.ok(html.includes("Needs attention (1)"));
    assert.ok(html.includes("2026-01-01 00:00 UTC"));
    assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
});
