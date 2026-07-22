# Porter Hallu Block sur Safari

Safari sait faire tourner les extensions au standard WebExtension, et le code de
Hallu Block l'est déjà. Mais Safari a deux particularités qui changent le travail
par rapport à Firefox : **la conversion et le build ne se font que sur un Mac avec
Xcode**, et **une extension Safari est livrée dans une app** (macOS et/ou iOS)
publiée sur l'App Store. Ce guide décrit tout ce que tu as à faire, côté Mac.

## À lire d'abord : une réserve technique

Safari supporte mal l'action **`redirect` de `declarativeNetRequest`**, en
particulier depuis une **page de résultats de recherche** — exactement le cas de
nos deux redirections. Concrètement, sur Safari :

- ❌ **Mode Google classique (`udm=14`)** et **DuckDuckGo `noai=1`** risquent de ne
  pas fonctionner de façon fiable (voire de casser le chargement de la page selon
  la version de Safari).
- ✅ Tout le **masquage DOM** fonctionne : Aperçus IA Google, anti-slop,
  widgets YouTube / Amazon (Rufus) / Bing (Copilot). C'est le cœur du produit.

**Déjà géré côté code :** le popup **masque automatiquement** ces deux toggles sur
Safari (détection via `navigator.vendor === "Apple Computer, Inc."`, voir
`src/popup/popup.js`). L'utilisateur Safari ne voit donc pas de switch mort — le
reste du popup est identique. Tu n'as rien à faire pour ça.

Si un jour tu veux vraiment ces deux fonctions sur Safari, il faudra les
**réimplémenter en content script** (réécrire l'URL via une navigation côté page
plutôt que par le DNR) — un vrai chantier, à planifier séparément.

> Réserve résiduelle : le service worker active quand même le ruleset DDG par
> défaut. Si une version de Safari fait *échouer* la page (et pas juste ignorer la
> redirection), il faudra aussi ne pas activer les rulesets DNR côté service worker
> sur Safari. À vérifier lors du premier vrai test sur Mac.

## Prérequis

- Un **Mac** récent sous macOS à jour.
- **Xcode** (gratuit, sur le Mac App Store).
- Un compte **Apple Developer Program** (99 $/an) — obligatoire pour distribuer sur
  l'App Store et pour signer l'app.
- Le dépôt cloné sur le Mac, avec `npm install` fait.

## 1. Préparer les fichiers de l'extension

Sur le Mac, à la racine du dépôt :

```bash
npm run stage:chrome      # produit un dossier propre dans dist/chrome/
```

On part de la cible **Chrome** (background `service_worker`, supporté par Safari
16.4+). `dist/chrome/` ne contient que ce qui doit être embarqué (`manifest.json`,
`_locales/`, `src/`).

## 2. Convertir en projet Xcode

```bash
xcrun safari-web-extension-converter dist/chrome \
  --app-name "Hallu Block" \
  --bundle-identifier fr.halluworld.hallublock \
  --project-location ./safari \
  --copy-resources \
  --macos-only          # retire cette ligne pour cibler aussi iOS/iPadOS
```

Ce que font ces options :

- `--app-name` — le nom de l'app hôte qui embarque l'extension.
- `--bundle-identifier` — l'identifiant Apple (convention alignée sur le domaine :
  `fr.halluworld.hallublock`).
- `--project-location` — où générer le projet Xcode (ici `./safari`, à gitignorer).
- `--copy-resources` — **copie** les fichiers de l'extension dans le projet plutôt
  que de les référencer en place ; le projet Xcode devient autonome.
- `--macos-only` / `--ios-only` — limite les plateformes (par défaut : les deux).
- `--no-open` — n'ouvre pas Xcode automatiquement (utile en CI).

Le convertisseur peut afficher des avertissements (par ex. sur le service worker ou
le DNR redirect) : ils sont attendus, voir la réserve plus haut.

## 3. Signer et lancer depuis Xcode

1. Ouvre le projet généré (`safari/Hallu Block/Hallu Block.xcodeproj`).
2. Sélectionne la cible de l'app → onglet **Signing & Capabilities** → choisis ton
   **Team** (ton compte Apple Developer). Fais de même pour la cible **Extension**.
3. Choisis un schéma **macOS** (ou iOS) et **Run** (⌘R). L'app hôte s'ouvre.
4. **Icône de l'app hôte** : le convertisseur reprend les icônes de l'extension,
   mais Xcode veut un `AppIcon` complet (jusqu'à 1024 px). Ajoute-le dans les
   *Assets* du projet si Xcode le réclame.

## 4. Activer et tester dans Safari

1. Safari → **Réglages** → onglet **Extensions** → coche **Hallu Block**.
2. Pour une extension **non signée en développement**, active d'abord le menu
   Développement (Réglages → Avancées → « Afficher les fonctionnalités pour
   développeurs web »), puis **Développement → Autoriser les extensions non
   signées** (à refaire à chaque session Safari).
3. Teste : popup, masquage des Aperçus IA (via fixtures/VPN US), anti-slop,
   widgets YouTube / Amazon / Bing. Vérifie le comportement des toggles `udm=14` /
   `noai=1` et confirme la stratégie retenue (les masquer si tu pars sur l'option 1).

## 5. Publier sur l'App Store

L'extension étant embarquée dans une app, la publication passe par **App Store
Connect**, comme n'importe quelle app.

1. Dans Xcode : **Product → Archive**, puis **Distribute App → App Store Connect**.
2. Sur <https://appstoreconnect.apple.com/> : crée la fiche de l'app (macOS et/ou
   iOS), avec captures d'écran, description, catégorie, et **politique de
   confidentialité** (pointer vers `docs/privacy.md` / halluworld.fr — argument
   « 100 % local »). Renseigne la section *App Privacy* : aucune donnée collectée.
3. Soumets pour **relecture Apple**. Mentionne dans les notes de relecture que
   certaines fonctions de redirection sont désactivées sur Safari (limitation
   connue du DNR), pour éviter un rejet « fonctionnalité annoncée mais absente ».

### Alternative macOS hors App Store

Pour distribuer l'app macOS en dehors du store (téléchargement direct), il faut la
**signer avec un certificat Developer ID** puis la faire **notariser** par Apple
(`notarytool`). iOS/iPadOS, en revanche, **impose l'App Store**.

## 6. Mises à jour

À chaque nouvelle version :

1. Bump `version` dans `manifest.json` (le canonique — partagé avec Chrome/Firefox).
2. `npm run stage:chrome` puis relance le convertisseur **ou**, si le projet Xcode
   est déjà en place, recopie le contenu de `dist/chrome/` dans les ressources de
   l'extension du projet.
3. **Archive** et resoumets via App Store Connect.

## Récapitulatif de faisabilité

| Fonctionnalité                       | Safari |
|--------------------------------------|--------|
| Masquage Aperçus IA Google           | ✅ |
| Filtre anti-slop                     | ✅ |
| Masquage YouTube / Amazon / Bing     | ✅ |
| Popup + compteur local               | ✅ |
| Mode Google classique (`udm=14`)     | ⚠️ DNR redirect peu fiable |
| DuckDuckGo `noai=1`                   | ⚠️ DNR redirect peu fiable |

Le portage Safari est **faisable** et le code est prêt ; le vrai coût est
opérationnel (Mac + Xcode + compte Apple payant + relecture App Store), pas
technique.
