# Publier Hallu Block sur Firefox

Ce guide couvre tout ce que **tu** as à faire pour mettre l'extension sur Firefox,
du test local jusqu'à la publication sur addons.mozilla.org (AMO). Le code est
déjà prêt : il ne reste que des étapes de build, de test et de soumission.

## Ce qui est déjà fait côté code

- Le moteur utilise le namespace standard `browser` + le polyfill officiel Mozilla,
  donc rien n'est spécifique à Chrome dans la logique.
- Le manifest Firefox est **généré automatiquement** depuis `manifest.json` (le
  canonique Chrome) par `scripts/manifest.mjs`. Seule différence : Firefox n'accepte
  pas `background.service_worker`, il reçoit donc un `background.scripts` équivalent
  (le service worker est chargé comme module d'événement). Tout le reste — sites
  couverts, règles DNR, CSP, identifiant de l'extension — est identique.
- L'identifiant AMO est fixé : `hallu-block@halluworld.fr` (bloc `browser_specific_settings.gecko`).
- La collecte de données est déclarée à `none` (`data_collection_permissions`).
- `npm run lint:firefox` valide le paquet Firefox avec `web-ext` : **0 erreur**
  (voir la note sur les 2 warnings plus bas).

> **Les fonctionnalités DNR marchent sur Firefox** (contrairement à Safari) :
> `udm=14` (Mode Google classique) et `noai=1` (DuckDuckGo) sont supportés depuis
> Firefox 128, notre version minimale.

## Prérequis

- **Node.js** installé (pour le build). `npm install` à la racine du dépôt.
- Un **compte développeur AMO** (gratuit) : <https://addons.mozilla.org/developers/>.
- Firefox de bureau pour tester (idéalement Firefox Developer Edition ou Nightly).

## 1. Construire le paquet

```bash
npm run build:firefox
```

Produit `web-ext-artifacts/hallu-block-firefox-<version>.zip` — c'est le fichier à
téléverser sur AMO. Le zip ne contient que `manifest.json`, `_locales/` et `src/`
(allowlist stricte, rien du dépôt de dev ne fuite).

## 2. Tester en local avant de publier

Deux méthodes.

**A. Chargement temporaire (rapide, manuel)**

```bash
npm run stage:firefox      # laisse un dossier propre dans dist/firefox/
```

Puis dans Firefox : `about:debugging#/runtime/this-firefox` →
**« Charger un module complémentaire temporaire… »** → sélectionner
`dist/firefox/manifest.json`. L'extension reste active jusqu'au redémarrage de Firefox.

**B. `web-ext run` (lance un Firefox de test jetable)**

```bash
npx web-ext run --source-dir=dist/firefox
```

**À vérifier :** le popup s'ouvre et les toggles persistent ; la redirection
DuckDuckGo (`noai=1`) et le Mode Google classique (`udm=14`) s'appliquent ;
l'anti-slop filtre les résultats ; YouTube / Amazon / Bing masquent leurs widgets.
Pour les **Aperçus IA Google**, rappel : ils sont absents depuis une IP française —
tester via les fixtures (`npx playwright test`) ou une IP/VPN US.

## 3. Publier sur AMO

Sur <https://addons.mozilla.org/developers/> → **« Soumettre un nouveau module »**.
Deux canaux :

- **Listé** (recommandé) — visible et installable depuis le store Firefox. Mozilla
  valide (automatique, parfois relecture humaine), signe, puis publie.
- **Auto-distribué** — Mozilla signe le `.xpi` mais ne le liste pas ; tu l'héberges
  toi-même (par ex. sur halluworld.fr). Utile pour une bêta privée.

### Option automatisée : `web-ext sign`

Récupère une clé API (JWT issuer + secret) sur
<https://addons.mozilla.org/developers/addon/api/key/>, puis :

```bash
npx web-ext sign \
  --source-dir=dist/firefox \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET" \
  --channel=listed          # ou "unlisted" pour l'auto-distribution
```

Ne mets **jamais** ces clés dans le dépôt (variables d'environnement / secret CI).

## 4. Ce que la fiche AMO va te demander

- **Nom / résumé / description** — réutilisables depuis `_locales/*/messages.json`
  et le README.
- **Captures d'écran** du popup et d'un avant/après sur un moteur de recherche.
- **Catégorie** (ex. « Confidentialité et sécurité »).
- **Politique de confidentialité** — pointer vers `docs/privacy.md` (ou sa version
  publiée sur halluworld.fr). Argument fort : 100 % local, aucune donnée ne sort.
- **Déclaration de collecte de données** — « aucune » ; c'est cohérent avec le
  `data_collection_permissions: none` déjà dans le manifest.
- **Notes pour le relecteur** — important : `src/lib/browser-polyfill.js` est du
  code **minifié**. AMO exige alors la source et la méthode de génération. Indique :
  > « `src/lib/browser-polyfill.js` est le polyfill officiel `webextension-polyfill`
  > v0.12.0, non modifié, intégré via `npm run vendor:polyfill`. Tout le reste du
  > code est écrit à la main et non minifié. »

## 5. Versions et mises à jour

- La version vit dans `manifest.json` (le canonique) — **Chrome et Firefox
  partagent le même numéro**. Incrémente-le à chaque publication.
- L'identifiant `hallu-block@halluworld.fr` ne change jamais : c'est lui qui relie
  une mise à jour à l'extension installée.
- Quand un site change son layout, on corrige `src/rules/rules.json`, on bump la
  version, on republie sur AMO **et** sur le Chrome Web Store (pas de règles
  distantes — c'est l'invariant produit).

## Note : `strict_min_version` 128 et les 2 warnings de lint

`npm run lint:firefox` sort **0 erreur** mais **2 warnings** : le champ
`data_collection_permissions` n'est réellement pris en compte qu'à partir de
Firefox 140 (desktop) / 142 (Android), alors que notre minimum est 128.

C'est un arbitrage volontaire : rester à **128** garde les utilisateurs de l'ESR
128 (répandue en entreprise), et comme il n'y a de toute façon **aucune collecte
de données**, le fait que le champ soit ignoré sur Firefox 128–139 est sans effet.
Si un jour tu veux que le champ soit honoré au runtime, passe
`browser_specific_settings.gecko.strict_min_version` à `"140.0"` dans
`manifest.json` — au prix des utilisateurs sous 128–139.
