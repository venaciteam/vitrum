#!/bin/bash
# Fabrique Vitrum sur ce Mac (Apple Silicon) et envoie Vitrum-macOS.dmg dans la publication GitHub.
#
#   scripts/publier.sh               fabrique origin/main et publie
#   scripts/publier.sh --essai       fabrique et copie le .dmg, sans rien envoyer
#   scripts/publier.sh --notes F.md  notes (en français) si c'est cette machine qui crée la publication
#
# La fabrication se fait dans une copie propre sur le disque interne (VITRUM_BUILD_DIR, par défaut
# ~/Library/Caches/venacity-build/vitrum), jamais sur le disque externe : plus rapide, et pas de
# fichiers ._ sur l'exFAT. node_modules et target y sont gardés d'une version à l'autre.
#
# Publication : la première machine crée la version en brouillon, la seconde la publie quand les
# deux fichiers (Vitrum-Setup.exe et Vitrum-macOS.dmg) sont présents. « latest » ne bouge donc
# qu'une fois la version complète.
set -euo pipefail

FICHIER="Vitrum-macOS.dmg"
AUTRE="Vitrum-Setup.exe"
ESSAI=0
NOTES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --essai) ESSAI=1 ;;
    --notes) NOTES="${2:?--notes demande un fichier}"; shift ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
etape() { printf '\n[*] %s\n' "$1"; }
stop() { printf '\n[!] %s\n' "$1" >&2; exit 1; }
alerte() { printf '    !! %s\n' "$1"; }

DEPOT="$(cd "$(dirname "$0")/.." && pwd)"
CIBLE="${VITRUM_BUILD_DIR:-$HOME/Library/Caches/venacity-build/vitrum}"

etape "Outils"
for c in git gh node npm cargo; do command -v "$c" >/dev/null || stop "$c introuvable (voir « Publier une version » dans le README)."; done
[ "$(uname -m)" = "arm64" ] || alerte "ce Mac n'est pas Apple Silicon : le .dmg sera pour $(uname -m)"
DISTANT="$(git -C "$DEPOT" remote get-url origin)"
NOM="$(printf '%s' "$DISTANT" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
[ "$ESSAI" = 1 ] || gh auth status >/dev/null 2>&1 || stop "gh n'est pas connecté : gh auth login"

etape "État du dépôt ($DEPOT)"
# Sur l'exFAT de VNCT, macOS pose des ._ dans .git (dont ._pack-*.idx, que git prend pour un index) : purge.
purger() { find "$DEPOT/.git" -name '._*' -delete 2>/dev/null || true; }
purger
git -C "$DEPOT" fetch -q origin
purger
COMMIT="$(git -C "$DEPOT" rev-parse origin/main)"
PROBLEME=""
[ -z "$(git -C "$DEPOT" status --porcelain)" ] || PROBLEME="modifications non commitées dans le dépôt local"
[ "$(git -C "$DEPOT" rev-parse main)" = "$COMMIT" ] || PROBLEME="${PROBLEME:+$PROBLEME ; }main local différent de origin/main"
if [ -n "$PROBLEME" ]; then
  if [ "$ESSAI" = 1 ]; then alerte "$PROBLEME (ignoré en essai : la fabrication part de origin/main)"
  else stop "$PROBLEME. Les deux machines doivent fabriquer le même commit : commiter, pousser ou tirer d'abord."; fi
fi
echo "    commit fabriqué : $(git -C "$DEPOT" log -1 --format='%h %s' "$COMMIT")"

etape "Copie propre dans $CIBLE"
if [ ! -d "$CIBLE/.git" ]; then
  mkdir -p "$(dirname "$CIBLE")"
  gh repo clone "$NOM" "$CIBLE" -- --quiet
fi
git -C "$CIBLE" fetch -q origin
git -C "$CIBLE" checkout -q --force --detach "$COMMIT"
git -C "$CIBLE" clean -q -ffdx -e node_modules -e src-tauri/target

etape "Version"
cd "$CIBLE"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
V_PKG="$(node -p "require('./package.json').version")"
V_CARGO="$(sed -n 's/^version *= *"\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
[ "$VERSION" = "$V_PKG" ] && [ "$VERSION" = "$V_CARGO" ] \
  || stop "versions différentes : tauri.conf.json $VERSION, package.json $V_PKG, Cargo.toml $V_CARGO (node scripts/version.mjs X.Y.Z)"
ETIQUETTE="v$VERSION"
echo "    $ETIQUETTE"

etape "Dépendances et tests du cœur (npm ci, cargo test)"
npm ci --no-audit --no-fund
(cd src-tauri && cargo test --locked)

etape "Fabrication (tauri build)"
# CI=true : Tauri passe --skip-jenkins à bundle_dmg.sh, qui ne pilote plus le Finder par AppleScript
# pour mettre en page la fenêtre du .dmg. Sans ça, lancé sans session graphique interactive (par Claude),
# l'AppleEvent expire (-1712) et la fabrication échoue.
CI=true npm run tauri build
DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)"
[ -n "$DMG" ] || stop "aucun .dmg dans src-tauri/target/release/bundle/dmg"
SORTIE="$(dirname "$CIBLE")/sorties/vitrum-$VERSION"
mkdir -p "$SORTIE"
cp "$DMG" "$SORTIE/$FICHIER"
echo "    $SORTIE/$FICHIER"

if [ "$ESSAI" = 1 ]; then
  printf '\nEssai terminé, rien n envoyé : %s\n' "$SORTIE/$FICHIER"
  exit 0
fi

etape "Publication $ETIQUETTE sur $NOM"
if gh release view "$ETIQUETTE" -R "$NOM" >/dev/null 2>&1; then
  CIBLE_PUB="$(gh release view "$ETIQUETTE" -R "$NOM" --json targetCommitish -q .targetCommitish)"
  case "$CIBLE_PUB" in
    "$COMMIT"|main) ;;
    *) stop "la publication $ETIQUETTE vise $CIBLE_PUB, pas $COMMIT : l'autre machine a fabriqué un autre commit." ;;
  esac
else
  if [ -n "$NOTES" ]; then ARG_NOTES=(--notes-file "$NOTES")
  else ARG_NOTES=(--notes "Vitrum $VERSION."); alerte "pas de --notes : notes minimales, à compléter sur GitHub"; fi
  gh release create "$ETIQUETTE" -R "$NOM" --draft --target "$COMMIT" --title "Vitrum $VERSION" "${ARG_NOTES[@]}"
  echo "    brouillon créé"
fi
gh release upload "$ETIQUETTE" "$SORTIE/$FICHIER" -R "$NOM" --clobber
FICHIERS="$(gh release view "$ETIQUETTE" -R "$NOM" --json assets -q '.assets[].name')"
if printf '%s\n' "$FICHIERS" | grep -qx "$AUTRE"; then
  gh release edit "$ETIQUETTE" -R "$NOM" --draft=false --latest
  printf '\nPubliée : %s est la dernière version, avec %s et %s.\n' "$ETIQUETTE" "$AUTRE" "$FICHIER"
else
  printf '\n%s envoyé. La version reste en brouillon jusqu à l envoi de %s par le PC.\n' "$FICHIER" "$AUTRE"
fi
