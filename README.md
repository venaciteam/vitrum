# Vitrum

Lecteur et éditeur Markdown à l'interface proche d'Obsidian, pour ouvrir des fichiers `.md`
**où qu'ils soient** sur le disque, sans les mettre dans un coffre. Windows et macOS.

*Vitrum* : « verre » en latin, clin d'œil à l'obsidienne, un verre volcanique.

## Télécharger

Dernière version :

- **[Télécharger pour Windows](https://github.com/venaciteam/vitrum/releases/latest/download/Vitrum-Setup.exe)**
  (Windows 10 et 11, 64 bits) : l'installateur ajoute Vitrum au menu « Ouvrir avec » et propose
  d'en faire l'application par défaut des `.md`.
- **[Télécharger pour Mac](https://github.com/venaciteam/vitrum/releases/latest/download/Vitrum-macOS.dmg)**
  (Mac à puce Apple, M1 et plus récent, macOS 11 ou plus récent) : ouvrir le `.dmg` et glisser
  Vitrum dans **Applications**. La 0.1.0 est universelle et marche aussi sur les Mac Intel.

Le dépôt est privé : les liens marchent une fois connecté à GitHub avec un compte qui y a accès.
Vitrum n'est pas signé : message du système au premier lancement, voir [Windows](#windows) et
[macOS](#macos). Toutes les versions : [publications](../../releases).

## Ce que fait Vitrum

- **Mode lecture** : rendu final comme dans Obsidian (propriétés du front matter, callouts
  repliables, tableaux, tâches cochables, `==surlignage==`, `#tags`, notes de bas de page,
  formules `$…$`, diagrammes Mermaid, code coloré, images locales et `![[intégrations]]`,
  commentaires `%%…%%` masqués).
- **Mode édition** : Markdown brut coloré (CodeMirror, comme Obsidian), enregistrement
  automatique après une seconde (désactivable). `Ctrl+E` bascule entre les deux modes en
  gardant la position dans le texte.
- Onglets, explorateur du dossier de la note, plan du document, recherche (`Ctrl+F`),
  thème clair/sombre, glisser-déposer de fichiers sur la fenêtre.
- Un fichier modifié par une autre application est rechargé ; s'il a aussi des modifications
  non enregistrées, Vitrum demande quelle version garder.
- Les fins de ligne (CRLF/LF) et le BOM UTF-8 d'origine sont conservés à l'enregistrement.
- Les liens entre notes ne sont pas un objectif, mais un `[[wikilink]]` s'ouvre quand la note
  est trouvée (à côté du fichier, ou dans le coffre Obsidian s'il y en a un au-dessus).

## Raccourcis

| Action | Windows | macOS |
| --- | --- | --- |
| Basculer lecture / édition | `Ctrl+E` | `⌘E` |
| Ouvrir un fichier | `Ctrl+O` | `⌘O` |
| Nouveau fichier | `Ctrl+N` | `⌘N` |
| Enregistrer tout de suite | `Ctrl+S` | `⌘S` |
| Rechercher dans la note | `Ctrl+F` | `⌘F` |
| Nouvel onglet / fermer l'onglet | `Ctrl+T` / `Ctrl+W` | `⌘T` / `⌘W` |
| Onglet suivant / précédent | `Ctrl+Tab` / `Ctrl+Maj+Tab` | idem |
| Rouvrir le dernier onglet fermé | `Ctrl+Maj+T` | `⌘⇧T` |
| Paramètres | `Ctrl+,` | `⌘,` |
| Zoom | `Ctrl+` `+` / `-` / `0` | `⌘` `+` / `-` / `0` |

Dans la vue de lecture, `Ctrl+clic` (ou clic molette) ouvre un lien dans un nouvel onglet.

## Windows

L'installateur ([`Vitrum-Setup.exe`](https://github.com/venaciteam/vitrum/releases/latest/download/Vitrum-Setup.exe))
s'installe pour l'utilisateur courant, sans droits administrateur. Il n'est pas signé : Windows
SmartScreen peut afficher « Windows a protégé votre ordinateur » ; cliquer alors sur
« Informations complémentaires », puis « Exécuter quand même ».

Il ajoute Vitrum au menu **Ouvrir avec** des fichiers `.md`, `.markdown`…, le
déclare dans les **Applications par défaut** de Windows et propose, à la fin, d'en faire
l'application par défaut des `.md`. Windows ne laisse aucun programme se déclarer par défaut
tout seul : il ouvre donc la page des Paramètres consacrée à Vitrum, où il reste à cliquer sur
`.md` puis sur Vitrum. Le même bouton existe dans les paramètres de Vitrum.

## macOS

### Installer

Télécharger [`Vitrum-macOS.dmg`](https://github.com/venaciteam/vitrum/releases/latest/download/Vitrum-macOS.dmg)
(Mac à puce Apple, M1 et plus récent), l'ouvrir et glisser Vitrum dans **Applications**.

Avec [GitHub CLI](https://cli.github.com) connecté (`gh auth login`), le `.dmg` arrive sans marque
de quarantaine, donc sans avertissement au premier lancement :

```bash
gh release download -R venaciteam/vitrum -p Vitrum-macOS.dmg
```

### Premier lancement

Vitrum n'a qu'une signature « ad hoc », sans identité de développeur Apple : macOS bloque la
première ouverture d'une copie téléchargée avec le navigateur.

- **macOS 15 (Sequoia) et suivants** : ouvrir Vitrum une fois (macOS refuse, cliquer sur
  **Terminé**), puis **Réglages Système** › **Confidentialité et sécurité** › tout en bas,
  **Ouvrir quand même**, et confirmer. Le clic droit › **Ouvrir** ne suffit plus.
- **macOS 14 (Sonoma) ou plus ancien** : clic droit sur Vitrum › **Ouvrir**, puis **Ouvrir**
  dans l'avertissement.
- Dans tous les cas, le Terminal fait la même chose :
  `xattr -dr com.apple.quarantine /Applications/Vitrum.app`

Ensuite Vitrum s'ouvre normalement. Une copie compilée sur le Mac n'a pas besoin de cette étape.

### Application par défaut des `.md`

Le paquet déclare les fichiers Markdown : Vitrum apparaît dans **Ouvrir avec** du Finder. Pour
en faire l'application par défaut : clic droit sur un `.md` › **Lire les informations** ›
**Ouvrir avec** : Vitrum › **Tout modifier…**

## Compiler

Prérequis : [Rust](https://rustup.rs) et [Node.js](https://nodejs.org) 20 ou plus récent.
Sur Mac, il faut aussi les outils en ligne de commande d'Xcode (`xcode-select --install`).
Windows 11 fournit déjà WebView2.

```bash
npm install
npm run tauri dev     # lancer en développement
npm run tauri build   # version finale + installateur
```

Résultat :

- Windows : `src-tauri/target/release/bundle/nsis/Vitrum_0.1.0_x64-setup.exe` (et
  `src-tauri/target/release/vitrum.exe`, utilisable sans installation) ;
- macOS : `src-tauri/target/release/bundle/dmg/Vitrum_0.1.0_aarch64.dmg` et `…/macos/Vitrum.app`.
  Pour un binaire universel (Apple Silicon et Intel, comme le workflow de secours) :
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, puis
  `npm run tauri build -- --target universal-apple-darwin` (résultat dans
  `src-tauri/target/universal-apple-darwin/release/bundle/`).

Tests du moteur Markdown : `cargo test` dans `src-tauri`.

## Publier une version

Chaque machine fabrique sa version et l'envoie elle-même dans la publication GitHub : le PC
l'installateur Windows, le Mac le `.dmg` (pour sa seule puce, bien plus rapide qu'un binaire
universel). Les deux fabriquent le même commit, `origin/main`, dans une copie propre sur le disque
interne (`~/Library/Caches/venacity-build/vitrum` sur le Mac, `%LOCALAPPDATA%\venacity-build\vitrum`
sur le PC) : dépendances et cache Rust y restent d'une version à l'autre.

Prérequis, en plus de ceux de [Compiler](#compiler) : [GitHub CLI](https://cli.github.com) connecté
(`gh auth login`). Sur le Mac : `xcode-select --install`, [Rust](https://rustup.rs), Node.js 20 ou
plus récent. Sur le PC : Rust avec les outils de compilation C++ de Visual Studio, Node.js 20 ou plus
récent.

1. Changer la version partout d'un coup (`package.json`, `package-lock.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`), commiter et pousser :

   ```bash
   node scripts/version.mjs 0.2.0
   git commit -am "Version 0.2.0" && git push
   ```

2. Essai sur chaque machine, sans rien envoyer : `scripts/publier.sh --essai` (Mac),
   `.\scripts\publier.ps1 -Essai` (PC). Le fichier produit est indiqué à la fin.
3. Publication : `scripts/publier.sh` sur le Mac, `.\scripts\publier.ps1` sur le PC, dans n'importe quel
   ordre. Le premier crée la version `vX.Y.Z` en **brouillon** (notes en français avec
   `--notes notes.md` / `-Notes notes.md`) et y dépose son fichier ; le second y ajoute le sien et
   publie la version. Les liens « dernière version » ne changent donc qu'une fois `Vitrum-Setup.exe`
   et `Vitrum-macOS.dmg` présents tous les deux.

Les scripts s'arrêtent s'il reste des modifications non commitées, si `main` diffère de
`origin/main`, si les versions des trois fichiers ne concordent pas, si les tests du cœur échouent,
ou si la publication existante vise un autre commit.

**Secours** : onglet **Actions** › **build** › **Run workflow** fabrique les deux sur GitHub (une
vingtaine de minutes, `.dmg` universel) ; avec l'option **publier**, il publie aussi la version
de `tauri.conf.json`. Sans l'option, les fichiers restent dans les **Artifacts** de l'exécution
(30 jours).

## Organisation

- `src-tauri/` — le cœur en **Rust** (Tauri 2) : lecture et écriture des fichiers, rendu Markdown
  façon Obsidian (comrak + retouches de l'arbre), recherche des notes et images liées,
  surveillance des fichiers ouverts, protocole `vmedia` pour afficher les médias locaux,
  instance unique, association des `.md`.
- `src-tauri/windows/hooks.nsh` — ajouts à l'installateur Windows (« Ouvrir avec », appli par défaut).
- `scripts/` — `publier.sh` (Mac) et `publier.ps1` (PC) fabriquent et publient une version,
  `version.mjs` change la version partout.
- `.github/workflows/build.yml` — fabrication de secours par GitHub Actions, lancée à la main.
- `src/` — l'interface (TypeScript sans framework) : onglets, explorateur, plan, éditeur
  CodeMirror 6, Mermaid, KaTeX, highlight.js, icônes Lucide.
- `dev/` — note d'exemple ; `npm run dev` seul affiche l'interface dans un navigateur avec un
  faux cœur, pratique pour retoucher l'apparence.
