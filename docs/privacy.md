# Politique de confidentialité — Hallu Block

_Dernière mise à jour : 2 juillet 2026_

## En résumé

**Hallu Block ne collecte, ne transmet et ne vend aucune donnée. Rien ne sort de votre navigateur.**

L'extension n'effectue **aucun appel réseau** : elle ne contacte aucun serveur, ni le nôtre, ni un tiers. Il n'y a ni analytics, ni télémétrie, ni identifiant, ni compte.

## Ce que fait l'extension, localement

- **Masquer des contenus IA** (Aperçus IA et Mode IA de Google, Copilot de Bing, assistant de DuckDuckGo, widgets de YouTube et Amazon) directement dans la page que vous consultez, selon des règles de détection **embarquées** dans l'extension.
- **Rediriger certaines URL** vers une variante sans IA (par ex. `udm=14` pour le "Mode Google classique", `noai=1` sur DuckDuckGo). Ces redirections sont réalisées en local par le navigateur via `declarativeNetRequest` — aucune requête ne nous est envoyée.
- **Compter** le nombre de blocs IA écartés. Ce compteur est stocké dans `storage.local` (sur votre machine) et n'est jamais transmis.

## Données stockées sur votre appareil

Uniquement, et uniquement en local (`storage.local`) :

- vos préférences d'interrupteurs (quels filtres sont activés) ;
- un compteur de blocs écartés (total + semaine en cours).

Vous pouvez les effacer à tout moment en supprimant les données de l'extension ou en la désinstallant.

## Permissions demandées, et pourquoi

- `storage` — mémoriser vos réglages et le compteur, en local.
- `declarativeNetRequest` — appliquer les redirections sans IA, en local, sans observer votre navigation.
- Accès aux sites cibles (`google.com/.fr/.be/.ch/.ca`, `bing.com`, `duckduckgo.com`, `youtube.com`, `amazon.fr/.com`) — nécessaire pour masquer l'IA **sur ces pages uniquement**. L'extension n'a pas accès aux autres sites.

## Mises à jour des règles

Quand un site modifie sa mise en page et qu'un filtre doit être corrigé, la correction est intégrée dans une **nouvelle version publiée sur le Chrome Web Store**. L'extension ne télécharge jamais de règles à distance : la seule façon dont elle change de comportement est une mise à jour que vous recevez via le store.

## Contact

Hallu Block est un outil libre et open source de [Hallu World](https://halluworld.kessel.media). Code source : <https://github.com/rozieres/hallu-block>.
