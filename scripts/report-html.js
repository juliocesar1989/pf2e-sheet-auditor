/**
 * Builds a standalone HTML document from an audit result. Pure function, no
 * Foundry dependencies; all dynamic text is HTML-escaped.
 */

const STATUS = {
    ok: { label: "OK", icon: "✔", cls: "ok" },
    fail: { label: "Not met", icon: "✖", cls: "fail" },
    review: { label: "Review", icon: "?", cls: "review" },
    waived: { label: "Waived (granted)", icon: "↷", cls: "waived" },
};

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function metIcon(met) {
    if (met === true) return '<span class="mark ok" title="Met">✔</span>';
    if (met === false) return '<span class="mark fail" title="Not met">✖</span>';
    return '<span class="mark review" title="Cannot verify">?</span>';
}

function renderNode(node) {
    if (!node) return "";
    if (node.kind === "leaf") {
        return `<li>${metIcon(node.met)} <span class="req">${escapeHtml(node.text)}</span>`
            + (node.detail ? ` <span class="detail">— ${escapeHtml(node.detail)}</span>` : "")
            + "</li>";
    }
    const label = { all: "All of", any: "Any of", not: "Must NOT have" }[node.kind] ?? node.kind;
    const children = (node.children ?? []).map(renderNode).join("");
    return `<li>${metIcon(node.met)} <span class="group">${label}</span>`
        + (node.kind !== "all" || node.text !== "All prerequisites" ? ` <span class="req">${escapeHtml(node.text)}</span>` : "")
        + `<ul>${children}</ul></li>`;
}

function renderTree(evaluation) {
    if (!evaluation) return '<p class="muted">No prerequisites.</p>';
    // Flatten the implicit top-level AND for readability
    const roots = evaluation.kind === "all" && evaluation.text === "All prerequisites" ? evaluation.children : [evaluation];
    return `<ul class="tree">${roots.map(renderNode).join("")}</ul>`;
}

function renderIssues(issues) {
    if (!issues.length) return "";
    return `<ul class="issues">${issues
        .map((i) => `<li class="${escapeHtml(i.severity)}"><strong>${escapeHtml(i.severity)}:</strong> ${escapeHtml(i.message)}</li>`)
        .join("")}</ul>`;
}

function renderFeat(feat) {
    const s = STATUS[feat.status] ?? STATUS.review;
    const taken = feat.takenAt != null ? `taken at level ${feat.takenAt}` : "level taken unknown";
    return `<section class="feat ${s.cls}">
  <header>
    <span class="badge ${s.cls}">${s.icon} ${s.label}</span>
    <h3>${escapeHtml(feat.name)}</h3>
    <span class="meta">${escapeHtml(feat.category)} feat ${escapeHtml(feat.level)} · ${escapeHtml(taken)}${feat.source ? ` · ${escapeHtml(feat.source)}` : ""}</span>
  </header>
  ${feat.prerequisites.length ? `<p class="raw"><strong>Prerequisites:</strong> ${escapeHtml(feat.prerequisites.join("; "))}</p>` : ""}
  ${renderTree(feat.evaluation)}
  ${renderIssues(feat.issues)}
</section>`;
}

const CSS = `
:root { --ok:#2e7d32; --fail:#c62828; --review:#b26a00; --waived:#5c6bc0; --bg:#faf8f3; --card:#fff; --text:#222; --muted:#666; --border:#ddd; }
@media (prefers-color-scheme: dark) { :root { --bg:#1d1d1f; --card:#2a2a2d; --text:#eee; --muted:#aaa; --border:#444; } }
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px; font:14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); }
main { max-width: 960px; margin: 0 auto; }
h1 { margin:0 0 4px; font-size:24px; }
h2 { margin:28px 0 10px; font-size:18px; border-bottom:1px solid var(--border); padding-bottom:4px; }
h3 { margin:0; font-size:16px; display:inline; }
.muted, .meta, .detail { color:var(--muted); }
.meta { display:block; font-size:12px; margin-top:2px; }
.character { margin:0 0 4px; }
.summary { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
.chip { padding:6px 12px; border-radius:16px; border:1px solid var(--border); background:var(--card); font-weight:600; }
.chip.ok { color:var(--ok); } .chip.fail { color:var(--fail); } .chip.review { color:var(--review); } .chip.waived { color:var(--waived); }
.feat { background:var(--card); border:1px solid var(--border); border-left:5px solid var(--border); border-radius:6px; padding:12px 14px; margin:10px 0; }
.feat.ok { border-left-color:var(--ok); } .feat.fail { border-left-color:var(--fail); } .feat.review { border-left-color:var(--review); } .feat.waived { border-left-color:var(--waived); }
.badge { float:right; font-size:12px; font-weight:700; padding:2px 8px; border-radius:10px; color:#fff; }
.badge.ok { background:var(--ok); } .badge.fail { background:var(--fail); } .badge.review { background:var(--review); } .badge.waived { background:var(--waived); }
.raw { margin:8px 0 4px; }
ul.tree, ul.tree ul { list-style:none; padding-left:18px; margin:4px 0; }
ul.tree { padding-left:4px; }
.mark { display:inline-block; width:1.2em; text-align:center; font-weight:700; }
.mark.ok { color:var(--ok); } .mark.fail { color:var(--fail); } .mark.review { color:var(--review); }
.group { font-style:italic; }
ul.issues { margin:8px 0 0; padding-left:18px; }
ul.issues li.error { color:var(--fail); } ul.issues li.warning { color:var(--review); } ul.issues li.info { color:var(--muted); }
table { border-collapse:collapse; width:100%; background:var(--card); }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); }
footer { margin-top:32px; font-size:12px; color:var(--muted); }
@media print { body { background:#fff; color:#000; } .feat { break-inside:avoid; } }
`;

/**
 * @param {ReturnType<import("./auditor.js").auditFeats>} report
 * @param {{ generatedAt?: Date, systemVersion?: string, moduleVersion?: string }} [meta]
 */
export function buildReportHtml(report, meta = {}) {
    const c = report.character;
    const s = report.summary;
    const when = (meta.generatedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const identity = [c.ancestry, c.heritage, c.background, c.class, c.deity && `Deity: ${c.deity}`].filter(Boolean).map(escapeHtml).join(" · ");
    const problems = report.feats.filter((f) => f.status === "fail" || f.status === "review");
    const fine = report.feats.filter((f) => f.status === "ok" || f.status === "waived");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(c.name)} – Feat Audit</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <h1>Feat prerequisite audit: ${escapeHtml(c.name)}</h1>
  <p class="character">Level ${escapeHtml(c.level)}${identity ? ` · ${identity}` : ""}</p>
  <p class="muted">Generated ${escapeHtml(when)} · Pathfinder 2e (Remaster) · English prerequisite text</p>

  <div class="summary">
    <span class="chip">${s.total} feats audited</span>
    <span class="chip ok">✔ ${s.ok} OK</span>
    <span class="chip fail">✖ ${s.fail} not met</span>
    <span class="chip review">? ${s.review} to review</span>
    ${s.waived ? `<span class="chip waived">↷ ${s.waived} waived</span>` : ""}
    ${s.warnings ? `<span class="chip review">⚠ ${s.warnings} warnings</span>` : ""}
  </div>

  <h2>Needs attention (${problems.length})</h2>
  ${problems.length ? problems.map(renderFeat).join("\n") : '<p class="muted">Nothing to fix. 🎉</p>'}

  <h2>Valid feats (${fine.length})</h2>
  ${fine.length ? fine.map(renderFeat).join("\n") : '<p class="muted">None.</p>'}

  ${report.skipped.length ? `<h2>Not audited (${report.skipped.length})</h2>
  <p class="muted">Class features, ancestry features, boons and curses have no prerequisites to check.</p>
  <table><thead><tr><th>Item</th><th>Category</th></tr></thead><tbody>
  ${report.skipped.map((k) => `<tr><td>${escapeHtml(k.name)}</td><td>${escapeHtml(k.category)}</td></tr>`).join("")}
  </tbody></table>` : ""}

  <footer>
    <p><strong>Legend:</strong> ✔ met · ✖ not met · ? could not be verified automatically (free-text prerequisite, review manually).</p>
    <p>Prerequisites are evaluated against the character's current sheet. Feats granted by other abilities usually ignore prerequisites.</p>
    <p>PF2e Sheet Auditor${meta.moduleVersion ? ` v${escapeHtml(meta.moduleVersion)}` : ""}${meta.systemVersion ? ` · PF2e system ${escapeHtml(meta.systemVersion)}` : ""}</p>
  </footer>
</main>
</body>
</html>`;
}
