"use strict";

/* Hallu Block — generic masking engine (content script).
 *
 * Reads rules.json (resolved by the service worker, which lets remote hot-fix
 * rules override the bundled ones later) and the user's toggles, then for each
 * rule that applies to this page:
 *   1. finds AI blocks by stable SEMANTIC selectors and by localized HEADING
 *      TEXT (never obfuscated classes), climbing to the outermost stable
 *      container so the whole block is hidden and the annotation stays visible;
 *   2. hides them and leaves a discreet annotation bar (if "show blocks" is on);
 *   3. tells the service worker to bump the local counter.
 *
 * Google's AI Overview loads async (~2.5–3s after first paint), so we re-scan
 * on DOM mutations plus a few timed passes — a one-shot scan would miss it. */

(async () => {
  const api = (typeof browser !== "undefined" && browser) || chrome;

  // SERP landmarks we never climb past (keeps "outermost container" bounded).
  const BOUNDARY_IDS = new Set([
    "rcnt", "center_col", "search", "rso", "main", "appbar", "topstuff", "cnt",
  ]);

  const norm = (s) => (s || "").trim().toLowerCase();
  const showClass = (id) => "hb-show-" + id;
  const showFeature = (id) => document.documentElement.classList.add(showClass(id));
  const hideFeatureAgain = (id) => document.documentElement.classList.remove(showClass(id));

  // Walk up from `el` and return the OUTERMOST ancestor matching any of
  // `ancestorSelectors`, stopping at SERP landmarks. Returns null if none.
  function climb(el, ancestorSelectors) {
    if (!ancestorSelectors || !ancestorSelectors.length) return null;
    let cur = el;
    let best = null;
    let depth = 0;
    while (cur && cur !== document.body && cur !== document.documentElement && depth < 12) {
      if (cur.id && BOUNDARY_IDS.has(cur.id)) break;
      for (const sel of ancestorSelectors) {
        try {
          if (cur.matches && cur.matches(sel)) {
            best = cur;
            break;
          }
        } catch (_) {
          /* invalid selector — ignore */
        }
      }
      cur = cur.parentElement;
      depth++;
    }
    return best;
  }

  // Text/aria detection: short headings or aria-labels whose text matches the
  // localized table. Requires a stable ancestor to bound the block — if none is
  // found we skip rather than risk hiding the wrong element (the "Google changed
  // its DOM" case is handled by hot-fixable rules + the reliable udm=14 mode).
  function findByText(rule) {
    const out = [];
    const wanted = (rule.textHeadings || []).map(norm);
    if (!wanted.length) return out;
    const candidates = document.querySelectorAll(
      'h1, h2, h3, [role="heading"], div[aria-level], [aria-label]'
    );
    for (const node of candidates) {
      const hay = node.hasAttribute("aria-label")
        ? norm(node.getAttribute("aria-label"))
        : norm(node.textContent);
      if (!hay) continue;
      if (wanted.some((w) => hay === w || hay.startsWith(w))) {
        const c = climb(node, rule.ancestorSelectors);
        if (c) out.push(c);
      }
    }
    return out;
  }

  function collect(rule) {
    const set = new Set();
    for (const sel of rule.selectors || []) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (_) {
        continue; // unsupported selector — skip
      }
      for (const n of nodes) set.add(climb(n, rule.ancestorSelectors) || n);
    }
    for (const c of findByText(rule)) set.add(c);
    return set;
  }

  function buildAnnotation(el, rule) {
    const bar = document.createElement("div");
    bar.className = "hb-annot";

    const blk = document.createElement("span");
    blk.className = "hb-annot-blk";
    blk.textContent = "▌";

    const label = document.createElement("span");
    label.className = "hb-annot-label";
    label.textContent =
      api.i18n.getMessage(rule.annotateKey) || api.i18n.getMessage("annot_generic");

    const sep = document.createElement("span");
    sep.className = "hb-annot-sep";
    sep.textContent = "·";

    const link = document.createElement("a");
    link.className = "hb-annot-link";
    link.href = "#";
    link.textContent = api.i18n.getMessage("annot_show");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const revealed = !el.classList.contains("hb-hidden");
      if (revealed) {
        el.classList.add("hb-hidden");
        hideFeatureAgain(rule.id);
        link.textContent = api.i18n.getMessage("annot_show");
      } else {
        el.classList.remove("hb-hidden");
        showFeature(rule.id); // also releases the attribute-based baseline hide
        link.textContent = api.i18n.getMessage("annot_hide");
      }
    });

    bar.append(
      blk,
      document.createTextNode(" "),
      label,
      document.createTextNode(" "),
      sep,
      document.createTextNode(" "),
      link
    );
    return bar;
  }

  function hideAndAnnotate(el, rule, showBlocks) {
    if (!el || el.dataset.hbDone) return false;
    // Skip if an ancestor was already handled (avoid nested double-annotation).
    if (el.parentElement && el.parentElement.closest('[data-hb-done="1"]')) return false;
    el.dataset.hbDone = "1";
    el.classList.add("hb-hidden");
    if (showBlocks && el.parentNode) {
      el.parentNode.insertBefore(buildAnnotation(el, rule), el);
    }
    return true;
  }

  function debounce(fn, ms) {
    let h;
    return () => {
      clearTimeout(h);
      h = setTimeout(fn, ms);
    };
  }

  // --- Execution ------------------------------------------------------------
  let state;
  try {
    state = await api.runtime.sendMessage({ type: "hb-get-state" });
  } catch (_) {
    return; // service worker unreachable — fail open (don't break the page).
  }
  if (!state || !state.rules) return;

  const { rules, toggles } = state;
  const host = location.hostname.replace(/^www\./, "");
  const path = location.pathname;

  const activeRules = (rules.hide || []).filter(
    (r) =>
      Array.isArray(r.hosts) &&
      r.hosts.some((h) => host === h || host.endsWith("." + h)) &&
      (!r.path || path.startsWith(r.path))
  );
  if (!activeRules.length) return;

  const showBlocks = toggles["show-blocks"] !== false; // default on

  // Features toggled OFF: release the anti-flicker baseline (page-wide marker).
  for (const r of activeRules) {
    if (toggles[r.id] === false) showFeature(r.id);
  }

  function apply() {
    for (const rule of activeRules) {
      if (toggles[rule.id] === false) continue;
      for (const el of collect(rule)) {
        if (hideAndAnnotate(el, rule, showBlocks)) {
          api.runtime.sendMessage({ type: "hb-bump", feature: rule.id }).catch(() => {});
        }
      }
    }
  }

  apply(); // initial sweep
  const obs = new MutationObserver(debounce(apply, 80));
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Timed re-scans: the AI Overview populates async, well after first paint.
  for (const t of [500, 1000, 2000, 3500, 6000]) setTimeout(apply, t);
})();
