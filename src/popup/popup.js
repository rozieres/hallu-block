"use strict";

// External links. The "À propos" page is a later milestone — for now it points
// at the public repo. The slop-list link is the community source (transparency).
const LINKS = {
  newsletter: "https://halluworld.kessel.media",
  about: "https://github.com/rozieres/hallu-block",
  "slop-list": "https://codeberg.org/just_a_husk/uBlockOrigin-AI-Blocklist",
};

const t = (key, subs) => browser.i18n.getMessage(key, subs);

// Turn a trailing "→" into a green arrow span (matches the mockup).
function greenifyArrow(el) {
  const text = el.textContent;
  const idx = text.lastIndexOf("→");
  if (idx === -1) return;
  el.textContent = text.slice(0, idx);
  const arr = document.createElement("span");
  arr.className = "arr";
  arr.textContent = "→";
  el.append(arr);
}

function applyI18n() {
  document.documentElement.lang = browser.i18n.getUILanguage();

  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }

  for (const el of document.querySelectorAll("[data-href]")) {
    const url = LINKS[el.dataset.href];
    if (url) el.href = url;
  }

  // The ASCII glyphs ([█]/[ ], ▌, █) are decorative — the switch state is carried
  // by aria-checked/aria-pressed, so hide the glyphs from assistive tech.
  for (const el of document.querySelectorAll(".check, .cur")) {
    el.setAttribute("aria-hidden", "true");
  }

  // Footer brand line: emphasize "Hallu World" inside the sentence.
  const brandEl = document.querySelector(".foot-brand");
  if (brandEl) {
    const full = t("foot_brand");
    const name = t("foot_brand_name");
    const i = full.indexOf(name);
    if (i >= 0) {
      brandEl.textContent = full.slice(0, i);
      const strong = document.createElement("strong");
      strong.textContent = name;
      brandEl.append(strong, document.createTextNode(full.slice(i + name.length)));
    } else {
      brandEl.textContent = full;
    }
  }

  greenifyArrow(document.querySelector(".foot-brand"));
  greenifyArrow(document.querySelector(".foot-about"));
}

async function renderCounter() {
  let count = 0;
  let total = 0;
  try {
    const { counter } = await browser.storage.local.get("counter");
    if (counter) {
      count = counter.week?.count ?? 0;
      total = counter.total ?? 0;
    }
  } catch (_) {
    // storage unavailable (e.g. opened as a plain file) — keep zeros.
  }

  const fmt = new Intl.NumberFormat(browser.i18n.getUILanguage());
  document.querySelector(".num-val").textContent = fmt.format(count);
  document.querySelector(".num-sub").textContent = t("counter_since_install", [fmt.format(total)]);
}

// ---- Switches ----------------------------------------------------------------
// Must mirror the service worker's defaults exactly: this is the state shown
// before the user touches anything, and on a fresh profile storage is empty.
const DEFAULT_TOGGLES = {
  "google-ai-overview": true,
  "google-ai-mode": true,
  "anti-slop": true,
  "ddg-assist": true,
  "youtube-ask": true,
  "amazon-rufus": true,
  "bing-copilot": false,
  "show-blocks": true,
  udm14: false,
};

let toggles = { ...DEFAULT_TOGGLES };

async function loadToggles() {
  try {
    const stored = await browser.storage.local.get("toggles");
    toggles = { ...DEFAULT_TOGGLES, ...(stored.toggles || {}) };
  } catch (_) {
    // storage unavailable — keep defaults so the UI still renders.
  }
}

async function saveToggles() {
  try {
    await browser.storage.local.set({ toggles });
  } catch (_) {
    /* best-effort; the popup stays in its in-memory state regardless */
  }
}

// Paint a list switch: the .on class drives the CSS colour, the glyph the ASCII
// look ([█] on / [ ] off) from the mockup.
function paintLi(li, on) {
  li.classList.toggle("on", on);
  li.setAttribute("aria-checked", String(on)); // role="switch" state
  const check = li.querySelector(".check");
  if (check) check.textContent = on ? "[█]" : "[ ]";
}

// The radical button is all-or-nothing (DNR), not a list switch: invert its
// colours when engaged so it reads as a pressed state.
function paintRadical(btn, on) {
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  const check = btn.querySelector(".check");
  if (check) check.textContent = on ? "[█]" : "[ ]";
}

function renderToggleState() {
  for (const li of document.querySelectorAll("li[data-feature]")) {
    paintLi(li, !!toggles[li.dataset.feature]);
  }
  const radical = document.querySelector('button[data-feature="udm14"]');
  if (radical) paintRadical(radical, !!toggles.udm14);
}

// Toggles backed by a declarativeNetRequest ruleset (family A): flipping the
// switch also flips the live ruleset via the service worker (which owns it).
const DNR_FEATURES = new Set(["udm14", "ddg-assist"]);

function notifyDnr(feature, value) {
  // Worker asleep/unreachable is fine — it reconciles from storage on next wake.
  browser.runtime
    .sendMessage({ type: "hb-set-dnr", feature, value })
    .catch(() => {});
}

function wireToggles() {
  for (const li of document.querySelectorAll("li[data-feature]")) {
    const feature = li.dataset.feature;
    li.style.cursor = "pointer";

    // Make each row a real, keyboard-operable switch for screen-reader users.
    li.setAttribute("role", "switch");
    li.setAttribute("tabindex", "0");
    const labelEl = li.querySelector(".tg-label");
    if (labelEl) li.setAttribute("aria-label", labelEl.textContent);
    const subEl = li.querySelector(".tg-sub");
    if (subEl) {
      subEl.id = subEl.id || `hb-sub-${feature}`;
      li.setAttribute("aria-describedby", subEl.id);
    }

    const flip = () => {
      toggles[feature] = !toggles[feature];
      paintLi(li, toggles[feature]);
      saveToggles();
      if (DNR_FEATURES.has(feature)) notifyDnr(feature, toggles[feature]);
    };

    li.addEventListener("click", (e) => {
      // Let the embedded "community list" link work without flipping the switch.
      if (e.target.closest("a")) return;
      flip();
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault(); // Space would otherwise scroll the popup
        flip();
      }
    });
  }

  const radical = document.querySelector('button[data-feature="udm14"]');
  if (radical) {
    radical.addEventListener("click", async () => {
      toggles.udm14 = !toggles.udm14;
      paintRadical(radical, toggles.udm14);
      await saveToggles();
      notifyDnr("udm14", toggles.udm14);
    });
  }
}

async function init() {
  applyI18n();
  await loadToggles();
  renderToggleState();
  wireToggles();
  await renderCounter();
}

init();
