# Hallu Block

**L'IA seulement quand vous la demandez.**

Extension navigateur qui masque l'IA imposée par défaut dans la navigation grand public : résumés IA de Google (AI Overviews), filtre anti-slop, et widgets IA de YouTube, Bing, DuckDuckGo, Amazon. 100 % local, zéro tracking, open source.

Un outil de [Hallu World](https://halluworld.fr/) — la newsletter fascinée par l'IA, consternée par ce qu'on en fait.

## État

Fonctionnalités embarquées :

- **Google** — masquage des **Aperçus IA** (AI Overviews), avec barre d'annotation. Option **"Mode Google classique"** (redirection `udm=14`). Couverture : `google.com`, `.fr`, `.be`, `.ch`, `.ca`.
- **Filtre anti-slop** — écarte des résultats (Google, Bing, DuckDuckGo) les sites d'une liste communautaire de contenus générés par IA.
- **DuckDuckGo** — désactive l'assistant IA (`noai=1`).
- **YouTube** et **Amazon (Rufus)** — masquage des widgets IA.
- **Bing (Copilot)** — masquage des réponses IA (Copilot), activé par défaut. Rendu via un bandeau CSS "removal-proof" (Bing supprime les nœuds injectés).
- Popup complet, compteur **100 % local**.

**Vie privée : aucune donnée ne sort du navigateur.** Les règles de détection sont **embarquées** dans l'extension (aucun appel réseau). Quand un site change sa mise en page, on corrige les sélecteurs dans `src/rules/rules.json` et on publie une mise à jour du Chrome Web Store (pas de récupération de règles à distance). Voir [docs/privacy.md](docs/privacy.md).

> Firefox n'est pas supporté en v1.0 : le validateur `web-ext` rejette le `service_worker` MV3.

## Développement

### Charger l'extension (Chrome / Edge)

`chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée** → sélectionner la **racine du dépôt** (le dossier qui contient `manifest.json`).

### Tests & vérifications

```bash
npm install
npm run lint               # gate verte : JSON, fichiers, locales, toggles, invariant 100 % local
npx playwright test        # suite déterministe sur fixtures (Chrome via xvfb si headless)
npm run build              # ZIP store-ready dans web-ext-artifacts/ (allowlist)
```

- `tests/engine.spec.js` — exerce le moteur de masquage réel (engine.js + CSS + `rules.json` + locale FR) contre des fixtures. Tourne partout.
- `tests/popup.spec.js` — câblage du popup + forme des rulesets DNR + invariants de vie privée.
- `tests/e2e.spec.js` — charge l'extension empaquetée dans Chrome ; se met automatiquement en *skip* là où le chargement non empaqueté est bloqué.
- `npm run lint:webext` — validation `web-ext` (Firefox), **informatif** : échoue par design sur le `service_worker` MV3.

## Licence

[MIT](LICENSE).
