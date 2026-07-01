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

  // --- Anti-slop (family C): filter SERP results by community domain blocklist -
  const bareHost = (h) => (h || "").replace(/^www\./, "").toLowerCase();

  function fromBase64Url(s) {
    try {
      let b = s.replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      return atob(b);
    } catch (_) {
      return "";
    }
  }

  // Resolve a result link to its REAL destination, unwrapping the redirectors the
  // engines wrap results in (DDG /l/?uddg=, Bing /ck/a?u=a1<b64>, generic ?url=).
  function realHref(a) {
    let u;
    try {
      u = new URL(a.getAttribute("href") || "", location.href);
    } catch (_) {
      return "";
    }
    const h = bareHost(u.hostname);
    if (h.endsWith("duckduckgo.com") && u.searchParams.has("uddg")) {
      return u.searchParams.get("uddg") || "";
    }
    if (h.endsWith("bing.com") && u.searchParams.has("u")) {
      const raw = u.searchParams.get("u") || "";
      const dec = fromBase64Url(raw.startsWith("a1") ? raw.slice(2) : raw);
      if (/^https?:\/\//i.test(dec)) return dec;
    }
    for (const k of ["url", "q"]) {
      const v = u.searchParams.get(k);
      if (v && /^https?:\/\//i.test(v)) return v;
    }
    return u.href;
  }

  // The destination host of a result: first link that resolves to a host other
  // than the SERP itself; falls back to the displayed <cite> URL.
  function resultHost(resultEl, serpHost) {
    for (const a of resultEl.querySelectorAll("a[href]")) {
      let host;
      try {
        host = bareHost(new URL(realHref(a), location.href).hostname);
      } catch (_) {
        continue;
      }
      if (host && host !== serpHost && !host.endsWith("." + serpHost)) return host;
    }
    const cite = resultEl.querySelector("cite");
    if (cite) {
      const m = (cite.textContent || "").match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
      if (m) return bareHost(m[0]);
    }
    return "";
  }

  // True if `host` or any of its parent domains is on the blocklist (so a hit on
  // "example.ai" also blocks "blog.example.ai").
  function isBlocked(host, set) {
    if (!host) return false;
    const parts = host.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      if (set.has(parts.slice(i).join("."))) return true;
    }
    return false;
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

  const hostMatch = (hosts) =>
    Array.isArray(hosts) && hosts.some((h) => host === h || host.endsWith("." + h));

  const activeRules = (rules.hide || []).filter(
    (r) => hostMatch(r.hosts) && (!r.path || path.startsWith(r.path))
  );

  // Anti-slop (family C) applies independently of the hide rules — some SERPs
  // (e.g. DuckDuckGo) get result filtering but no in-page masking.
  const slop = rules.slopFilter;
  const slopActive = !!slop && toggles[slop.id] !== false && hostMatch(slop.hosts);

  if (!activeRules.length && !slopActive) return;

  const showBlocks = toggles["show-blocks"] !== false; // default on

  // Features toggled OFF: release the anti-flicker baseline (page-wide marker).
  for (const r of activeRules) {
    if (toggles[r.id] === false) showFeature(r.id);
  }

  // Fetch the blocklist once (kept out of getState so only slop pages pay for it).
  let slopSet = null;
  if (slopActive) {
    try {
      const resp = await api.runtime.sendMessage({ type: "hb-get-slop" });
      if (resp && Array.isArray(resp.domains)) slopSet = new Set(resp.domains);
    } catch (_) {
      /* couldn't load the list — skip filtering, never break the page */
    }
  }

  function filterSlop() {
    let nodes;
    try {
      nodes = document.querySelectorAll(slop.resultSelector);
    } catch (_) {
      return; // unsupported selector — skip
    }
    for (const res of nodes) {
      if (res.dataset.hbDone || res.dataset.hbSlopSeen) continue;
      const target = resultHost(res, host);
      if (!target) continue; // link not resolvable yet — re-check on next pass
      if (isBlocked(target, slopSet)) {
        if (hideAndAnnotate(res, { id: slop.id, annotateKey: slop.annotateKey }, showBlocks)) {
          api.runtime.sendMessage({ type: "hb-bump", feature: slop.id }).catch(() => {});
        }
      } else {
        res.dataset.hbSlopSeen = "1"; // resolved & clean — don't re-scan it
      }
    }
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
    if (slopSet && slopSet.size) filterSlop();
  }

  apply(); // initial sweep
  const obs = new MutationObserver(debounce(apply, 80));
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Timed re-scans: AI Overviews populate async, and results hydrate / paginate.
  for (const t of [500, 1000, 2000, 3500, 6000]) setTimeout(apply, t);
})();
