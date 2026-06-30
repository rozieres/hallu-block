# Hallu Block

**L'IA seulement quand vous la demandez.**

Extension navigateur qui masque l'IA imposée par défaut dans la navigation grand public : résumés IA de Google (AI Overviews), Mode IA, filtre anti-slop, et widgets IA de YouTube, Bing, DuckDuckGo, Amazon. 100 % local, zéro tracking, open source.

Un outil de [Hallu World](https://halluworld.kessel.media) — la newsletter fascinée par l'IA, consternée par ce qu'on en fait.

## État

En construction (MVP-0). Manifest V3, Chrome d'abord (Firefox-ready). Spécifications internes dans `_reflexion/` (non publié).

MVP-0 livré : masquage des **Aperçus IA de Google** (AI Overviews) avec barre d'annotation, popup complet (FR + EN), compteur local. Les autres sites/plateformes et le Mode Google classique arrivent dans les lots suivants.

## Développement

### Charger l'extension

- **Chrome / Edge** : `chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée** → sélectionner la **racine du dépôt** (le dossier qui contient `manifest.json`).
  > Les versions récentes de Chrome (137+) bloquent le chargement d'extensions non empaquetées via la ligne de commande (`--load-extension`) ; le bouton **Charger l'extension non empaquetée** reste, lui, fonctionnel.
- **Firefox** : `npm run start:firefox` (utilise `web-ext`).

### Tests

```bash
npm install
npx playwright test        # suite déterministe sur fixtures (Chrome via xvfb si headless)
```

- `tests/engine.spec.js` — exerce le moteur de masquage réel (engine.js + CSS + `rules.json` + locale FR) contre des fixtures. Tourne partout.
- `tests/e2e.spec.js` — charge l'extension empaquetée dans Chrome ; se met automatiquement en *skip* là où le chargement non empaqueté est bloqué.

## Licence

[MIT](LICENSE).
