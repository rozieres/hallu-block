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

**Vie privée : aucune donnée ne sort du navigateur.** Les règles de détection sont **embarquées** dans l'extension (aucun appel réseau). Quand un site change sa mise en page, on corrige les sélecteurs dans `src/rules/rules.json` et on publie une mise à jour du store (pas de récupération de règles à distance). Voir [docs/privacy.md](docs/privacy.md).

## Navigateurs

- **Chrome / Edge** — cible principale, publiée sur le Chrome Web Store (MV3).
- **Firefox** — supporté. Le manifest Firefox est dérivé automatiquement du canonique
  Chrome ; toutes les fonctionnalités marchent, DNR inclus. Voir [docs/firefox.md](docs/firefox.md).
- **Safari** — portable (code au standard WebExtension) ; la conversion se fait sur
  Mac avec Xcode. Le masquage DOM fonctionne ; les deux redirections DNR (`udm=14`,
  `noai=1`) sont peu fiables sur Safari. Voir [docs/safari.md](docs/safari.md).

## Développement

### Charger l'extension (Chrome / Edge)

`chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée** → sélectionner la **racine du dépôt** (le dossier qui contient `manifest.json`).

### Tests & vérifications

```bash
npm install
npm run lint               # gate verte : JSON, fichiers, locales, toggles, invariant 100 % local, manifest Firefox
npx playwright test        # suite déterministe sur fixtures (Chrome via xvfb si headless)
npm run build              # ZIP store-ready Chrome dans web-ext-artifacts/ (allowlist)
npm run build:firefox      # ZIP store-ready Firefox (manifest dérivé du canonique Chrome)
```

- `tests/engine.spec.js` — exerce le moteur de masquage réel (engine.js + CSS + `rules.json` + locale FR) contre des fixtures. Tourne partout.
- `tests/popup.spec.js` — câblage du popup + forme des rulesets DNR + invariants de vie privée.
- `tests/manifest.spec.js` — dérivation du manifest par navigateur : forme Firefox + parité des clés partagées avec le canonique Chrome.
- `tests/e2e.spec.js` — charge l'extension empaquetée dans Chrome ; se met automatiquement en *skip* là où le chargement non empaqueté est bloqué.
- `npm run lint:firefox` — validation `web-ext` du paquet Firefox (0 erreur). `npm run lint:webext` fait la même sur la cible Chrome et **échoue par design** (web-ext rejette le `service_worker` MV3) : informatif, pas une gate.

## Licence

[MIT](LICENSE).
