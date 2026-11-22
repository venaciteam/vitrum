# Fabrique Vitrum sur ce PC et envoie Vitrum-Setup.exe dans la publication GitHub.
#
#   .\scripts\publier.ps1                 fabrique origin/main et publie
#   .\scripts\publier.ps1 -Essai          fabrique et copie l'installateur, sans rien envoyer
#   .\scripts\publier.ps1 -Notes F.md     notes (en français) si c'est cette machine qui crée la publication
#
# La fabrication se fait dans une copie propre sur le disque interne ($env:VITRUM_BUILD_DIR, par défaut
# %LOCALAPPDATA%\venacity-build\vitrum), jamais sur le disque externe : bien plus rapide. node_modules et
# target y sont gardés d'une version à l'autre.
#
# Publication : la première machine crée la version en brouillon, la seconde la publie quand les deux
# fichiers (Vitrum-Setup.exe et Vitrum-macOS.dmg) sont présents. « latest » ne bouge donc qu'une fois la
# version complète.
param([switch]$Essai, [string]$Notes = "")

$ErrorActionPreference = "Stop"
# Accents corrects aussi quand la sortie est redirigée vers un journal (sinon page de code de la console).
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$Fichier = "Vitrum-Setup.exe"
$Autre = "Vitrum-macOS.dmg"
function Etape($t) { Write-Host "`n[*] $t" -ForegroundColor Cyan }
function Alerte($t) { Write-Host "    !! $t" -ForegroundColor Yellow }
function Arreter($t) { Write-Host "`n[!] $t" -ForegroundColor Red; exit 1 }
# Commande dont l'échec est une réponse attendue (« pas de publication ») : sous Windows PowerShell 5.1,
# rediriger sa sortie d'erreur avec $ErrorActionPreference = "Stop" arrêterait le script.
function Reussit([scriptblock]$Commande) {
    $avant = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $Commande *> $null } finally { $ErrorActionPreference = $avant }
    return $LASTEXITCODE -eq 0
}
function Verifier($quoi) { if ($LASTEXITCODE -ne 0) { Arreter "$quoi a échoué (code $LASTEXITCODE)" } }

$Depot = Split-Path -Parent $PSScriptRoot
$Cible = if ($env:VITRUM_BUILD_DIR) { $env:VITRUM_BUILD_DIR } else { Join-Path $env:LOCALAPPDATA "venacity-build\vitrum" }

Etape "Outils"
foreach ($c in "git", "gh", "node", "npm", "cargo") {
    if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Arreter "$c introuvable (voir « Publier une version » dans le README)." }
}
$Distant = git -C $Depot remote get-url origin
$Nom = $Distant -replace '^.*github\.com[:/]', '' -replace '\.git$', ''
if (-not $Essai -and -not (Reussit { gh auth status })) { Arreter "gh n'est pas connecté : gh auth login" }

Etape "État du dépôt ($Depot)"
git -C $Depot fetch -q origin; Verifier "git fetch"
$Commit = git -C $Depot rev-parse origin/main
$Probleme = @()
if (git -C $Depot status --porcelain) { $Probleme += "modifications non commitées dans le dépôt local" }
if ((git -C $Depot rev-parse main) -ne $Commit) { $Probleme += "main local différent de origin/main" }
if ($Probleme) {
    $texte = $Probleme -join " ; "
    if ($Essai) { Alerte "$texte (ignoré en essai : la fabrication part de origin/main)" }
    else { Arreter "$texte. Les deux machines doivent fabriquer le même commit : commiter, pousser ou tirer d'abord." }
}
Write-Host "    commit fabriqué : $(git -C $Depot log -1 --format='%h %s' $Commit)"

Etape "Copie propre dans $Cible"
if (-not (Test-Path (Join-Path $Cible ".git"))) {
    New-Item -ItemType Directory -Force (Split-Path $Cible) | Out-Null
    gh repo clone $Nom $Cible -- --quiet; Verifier "gh repo clone"
}
git -C $Cible fetch -q origin; Verifier "git fetch (copie)"
git -C $Cible checkout -q --force --detach $Commit; Verifier "git checkout"
git -C $Cible clean -q -ffdx -e node_modules -e src-tauri/target; Verifier "git clean"

Etape "Version"
Set-Location $Cible
$Version = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$VPkg = (Get-Content package.json -Raw | ConvertFrom-Json).version
$VCargo = (Select-String -Path src-tauri\Cargo.toml -Pattern '^version\s*=\s*"(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
if ($Version -ne $VPkg -or $Version -ne $VCargo) {
    Arreter "versions différentes : tauri.conf.json $Version, package.json $VPkg, Cargo.toml $VCargo (node scripts/version.mjs X.Y.Z)"
}
$Etiquette = "v$Version"
Write-Host "    $Etiquette"

Etape "Dépendances et tests du cœur (npm ci, cargo test)"
npm ci --no-audit --no-fund; Verifier "npm ci"
Push-Location src-tauri; cargo test --locked; Verifier "cargo test"; Pop-Location

Etape "Fabrication (tauri build)"
npm run tauri build; Verifier "tauri build"
$Exe = Get-ChildItem src-tauri\target\release\bundle\nsis\*-setup.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Exe) { Arreter "aucun installateur dans src-tauri\target\release\bundle\nsis" }
$Sortie = Join-Path (Split-Path $Cible) "sorties\vitrum-$Version"
New-Item -ItemType Directory -Force $Sortie | Out-Null
Copy-Item $Exe.FullName (Join-Path $Sortie $Fichier) -Force
Write-Host "    $(Join-Path $Sortie $Fichier)"

if ($Essai) { Write-Host "`nEssai terminé, rien n'est envoyé : $(Join-Path $Sortie $Fichier)" -ForegroundColor Green; exit 0 }

Etape "Publication $Etiquette sur $Nom"
if (Reussit { gh release view $Etiquette -R $Nom }) {
    $CiblePub = gh release view $Etiquette -R $Nom --json targetCommitish -q .targetCommitish
    if ($CiblePub -ne $Commit -and $CiblePub -ne "main") { Arreter "la publication $Etiquette vise $CiblePub, pas $Commit : l'autre machine a fabriqué un autre commit." }
} else {
    if ($Notes) { gh release create $Etiquette -R $Nom --draft --target $Commit --title "Vitrum $Version" --notes-file $Notes }
    else { Alerte "pas de -Notes : notes minimales, à compléter sur GitHub"; gh release create $Etiquette -R $Nom --draft --target $Commit --title "Vitrum $Version" --notes "Vitrum $Version." }
    Verifier "gh release create"
    Write-Host "    brouillon créé"
}
gh release upload $Etiquette (Join-Path $Sortie $Fichier) -R $Nom --clobber; Verifier "gh release upload"
$Fichiers = gh release view $Etiquette -R $Nom --json assets -q '.assets[].name'
if ($Fichiers -contains $Autre) {
    gh release edit $Etiquette -R $Nom --draft=false --latest; Verifier "gh release edit"
    Write-Host "`nPubliée : $Etiquette est la dernière version, avec $Fichier et $Autre." -ForegroundColor Green
} else {
    Write-Host "`n$Fichier envoyé. La version reste en brouillon jusqu'à l'envoi de $Autre par le Mac." -ForegroundColor Green
}
