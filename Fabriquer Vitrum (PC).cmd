@echo off
chcp 65001 >nul
rem Double-clic : fabrique l’installateur Windows de Vitrum a partir de la version poussee sur GitHub
rem (origin/main). Au choix : essai seulement, ou envoi dans la publication GitHub (scripts\publier.ps1).
echo 1 = fabriquer seulement (essai, rien n’est envoyé)
echo 2 = fabriquer et envoyer sur GitHub
choice /C 12 /N /M "Choix (1 ou 2) : "
if errorlevel 2 (set "MODE=") else (set "MODE=-Essai")
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publier.ps1" %MODE%
if errorlevel 1 (
  echo.
  echo La fabrication a échoué : voir les messages ci-dessus.
) else (
  explorer "%LOCALAPPDATA%\venacity-build\sorties"
)
echo.
pause
