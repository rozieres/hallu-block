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

applyI18n();
renderCounter();
