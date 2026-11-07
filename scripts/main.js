/**
 * PF2e Sheet Auditor – Foundry VTT entry point.
 * Adds an "Audit Feats" button to PF2e character sheets. Clicking it checks every
 * feat's prerequisites and opens an HTML report that can be downloaded.
 */

import { slugify } from "./parser.js";
import { buildActorState } from "./actor-state.js";
import { auditFeats, featRecordFromItem } from "./auditor.js";
import { buildReportHtml } from "./report-html.js";

const MODULE_ID = "pf2e-sheet-auditor";
const MIN_PF2E_VERSION = "7.0.0";
const ACTION_ID = "pf2eSheetAuditorAudit";

const t = (key, data) => (data ? game.i18n.format(`PF2E_SHEET_AUDITOR.${key}`, data) : game.i18n.localize(`PF2E_SHEET_AUDITOR.${key}`));

/** @returns {string|null} reason the module cannot run, or null if supported */
function unsupportedReason() {
    if (game.system?.id !== "pf2e") return t("Unsupported.System");
    if (game.i18n.lang !== "en") return t("Unsupported.Language");
    if (foundry.utils.isNewerVersion(MIN_PF2E_VERSION, game.system.version)) {
        return t("Unsupported.Version", { version: MIN_PF2E_VERSION });
    }
    return null;
}

function canUseButton(actor) {
    if (actor?.type !== "character") return false;
    if (unsupportedReason()) return false;
    if (game.settings.get(MODULE_ID, "gmOnly") && !game.user.isGM) return false;
    return true;
}

/* -------------------------------------------------------------------------- */
/*  Compendium name index (to tell "missing" from "unrecognized")             */
/* -------------------------------------------------------------------------- */

let knownNamesPromise = null;

function loadKnownNames() {
    knownNamesPromise ??= (async () => {
        const names = new Set();
        const packs = game.packs.filter((p) => p.documentName === "Item" && p.metadata.packageType === "system" && p.metadata.packageName === "pf2e");
        await Promise.all(packs.map(async (pack) => {
            try {
                const index = await pack.getIndex({ fields: ["system.slug"] });
                for (const entry of index) {
                    names.add(slugify(entry.name));
                    if (entry.system?.slug) names.add(entry.system.slug);
                }
            } catch (err) {
                console.warn(`${MODULE_ID} | Could not index ${pack.collection}`, err);
            }
        }));
        return names;
    })();
    return knownNamesPromise;
}

/* -------------------------------------------------------------------------- */
/*  Report window                                                             */
/* -------------------------------------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

class AuditReportApp extends ApplicationV2 {
    constructor(actor, html, report, options = {}) {
        super({ ...options, id: `${MODULE_ID}-report-${actor.id}` });
        this.actor = actor;
        this.html = html;
        this.report = report;
    }

    static DEFAULT_OPTIONS = {
        classes: [MODULE_ID],
        tag: "div",
        window: { icon: "fa-solid fa-clipboard-check", resizable: true },
        position: { width: 860, height: 760 },
        actions: {
            download: AuditReportApp.#onDownload,
            reaudit: AuditReportApp.#onReaudit,
        },
    };

    get title() {
        return t("Report.Title", { name: this.actor.name });
    }

    async _renderHTML() {
        const s = this.report.summary;
        const wrapper = document.createElement("div");
        wrapper.classList.add("psa-report");

        const toolbar = document.createElement("div");
        toolbar.classList.add("psa-toolbar");
        toolbar.innerHTML = `
            <span class="psa-counts">
                <span class="ok">✔ ${s.ok}</span>
                <span class="fail">✖ ${s.fail}</span>
                <span class="review">? ${s.review}</span>
            </span>
            <button type="button" data-action="reaudit"><i class="fa-solid fa-rotate"></i> ${t("Report.Reaudit")}</button>
            <button type="button" data-action="download"><i class="fa-solid fa-download"></i> ${t("Report.Download")}</button>`;

        const frame = document.createElement("iframe");
        frame.classList.add("psa-frame");
        frame.setAttribute("sandbox", "");
        frame.srcdoc = this.html;

        wrapper.append(toolbar, frame);
        return wrapper;
    }

    _replaceHTML(result, content) {
        content.replaceChildren(result);
    }

    static #onDownload() {
        const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
        save(this.html, "text/html", `${slugify(this.actor.name) || "character"}-feat-audit.html`);
    }

    static async #onReaudit() {
        const { html, report } = await auditActor(this.actor);
        this.html = html;
        this.report = report;
        this.render({ force: true });
    }
}

/* -------------------------------------------------------------------------- */
/*  Audit                                                                     */
/* -------------------------------------------------------------------------- */

async function auditActor(actor) {
    const knownNames = await loadKnownNames();
    const state = buildActorState(actor);
    const records = [...(actor.itemTypes?.feat ?? actor.items.filter((i) => i.type === "feat"))].map((i) => featRecordFromItem(i, actor));
    const report = auditFeats(records, state, { knownNames });
    const html = buildReportHtml(report, {
        generatedAt: new Date(),
        systemVersion: game.system.version,
        moduleVersion: game.modules.get(MODULE_ID)?.version,
    });
    return { report, html };
}

async function runAudit(actor) {
    const reason = unsupportedReason();
    if (reason) return ui.notifications.warn(reason);
    try {
        const { report, html } = await auditActor(actor);
        new AuditReportApp(actor, html, report).render({ force: true });
        const s = report.summary;
        const notify = s.fail ? "warn" : "info";
        ui.notifications[notify](t("Notify.Done", { name: actor.name, ok: s.ok, fail: s.fail, review: s.review }));
    } catch (err) {
        console.error(`${MODULE_ID} | Audit failed`, err);
        ui.notifications.error(t("Notify.Error"));
    }
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "gmOnly", {
        name: "PF2E_SHEET_AUDITOR.Settings.GmOnly.Name",
        hint: "PF2E_SHEET_AUDITOR.Settings.GmOnly.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    game.modules.get(MODULE_ID).api = { auditActor, runAudit };
});

Hooks.once("ready", () => {
    const reason = unsupportedReason();
    if (reason) {
        console.warn(`${MODULE_ID} | Disabled: ${reason}`);
        if (game.user.isGM) ui.notifications.warn(reason);
    }
});

// Application V1 sheets (the PF2e character sheet)
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet.actor ?? sheet.document;
    if (!canUseButton(actor)) return;
    buttons.unshift({
        label: t("Button.Label"),
        class: "pf2e-sheet-auditor-button",
        icon: "fa-solid fa-clipboard-check",
        onclick: () => runAudit(actor),
    });
});

// Application V2 sheets (future-proofing)
Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
    const actor = sheet.actor ?? sheet.document;
    if (!canUseButton(actor)) return;
    sheet.options.actions ??= {};
    sheet.options.actions[ACTION_ID] ??= () => runAudit(actor);
    controls.unshift({
        icon: "fa-solid fa-clipboard-check",
        label: t("Button.Label"),
        action: ACTION_ID,
    });
});
