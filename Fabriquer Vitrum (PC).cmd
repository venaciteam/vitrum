@echo off
chcp 65001 >nul
rem Double-clic : fabrique l’installateur Windows de Vitrum a partir de la version poussee sur GitHub
rem (origin/main). Au choix : essai seulement, ou envoi dans la publication GitHub (scripts\publier.ps1).
echo 1 = fabriquer seulement (essai, rien n’est envoyé)
echo 2 = fabriquer et envoyer sur GitHub
choice /C 12 /N /M "Choix (1 ou 2) : "
if errorlevel 2 (set "MODE=") else (set "MODE=-Essai")
echo.
echo Compter 5 à 10 minutes. La fabrication du cœur (« Compiling vitrum ») reste longtemps sans rien
echo afficher : c’est normal. Ne pas fermer la fenêtre avant le message TERMINÉ ou ÉCHEC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publier.ps1" %MODE%
if errorlevel 1 (
  echo.
  echo ==================== ÉCHEC ====================
  echo La fabrication s’est arrêtée : voir les messages ci-dessus.
) else (
  echo.
  echo =================== TERMINÉ ====================
  explorer "%LOCALAPPDATA%\venacity-build\sorties"
)
echo.
echo Appuie sur une touche pour fermer cette fenêtre.
pause >nul
