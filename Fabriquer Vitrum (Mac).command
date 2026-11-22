#!/bin/bash
# Double-clic : fabrique le .dmg de Vitrum à partir de la version poussée sur GitHub (origin/main).
# Au choix : essai seulement, ou envoi dans la publication GitHub (scripts/publier.sh).
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")" || exit 1
printf '1 = fabriquer seulement (essai, rien n’est envoyé)\n2 = fabriquer et envoyer sur GitHub\n'
read -r -p "Choix (1 ou 2) : " choix
if [ "$choix" = 2 ]; then mode=""; else mode="--essai"; fi
printf '\nCompter 5 à 10 minutes. La fabrication du cœur (« Compiling vitrum ») reste longtemps sans rien\n'
printf 'afficher : c’est normal. Ne pas fermer la fenêtre avant le message TERMINÉ ou ÉCHEC.\n'
if bash scripts/publier.sh $mode; then
  printf '\n=================== TERMINÉ ====================\n'
  open "$HOME/Library/Caches/venacity-build/sorties"
else
  printf '\n==================== ÉCHEC ====================\n'
  printf 'La fabrication s’est arrêtée : voir les messages ci-dessus.\n'
fi
printf '\n'
read -r -p "Appuie sur Entrée pour fermer cette fenêtre."
