// Change la version de Vitrum d'un coup, partout où elle est écrite.
//   node scripts/version.mjs 0.2.0
// Fichiers : package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml et
// src-tauri/Cargo.lock (sinon la première compilation le modifie et le dépôt n'est plus propre).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error("Usage : node scripts/version.mjs X.Y.Z");
  process.exit(2);
}
const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => readFileSync(join(racine, f), "utf8");
const ecrire = (f, t) => writeFileSync(join(racine, f), t);

// Remplacement textuel (pas de JSON.stringify : la mise en forme d'origine reste intacte).
function remplacer(f, motif, quoi) {
  const texte = lire(f);
  if (!motif.test(texte)) {
    console.error(`${f} : ${quoi} introuvable`);
    process.exit(1);
  }
  ecrire(f, texte.replace(motif, `$1${version}$2`));
}

// La première clé "version" de ces fichiers est celle du projet.
remplacer("package.json", /^(\s*"version":\s*")[^"]+(")/m, "version");
remplacer("src-tauri/tauri.conf.json", /^(\s*"version":\s*")[^"]+(")/m, "version");
// package-lock.json : la version de tête, puis celle du paquet racine (packages[""]).
remplacer("package-lock.json", /^(\s*"version":\s*")[^"]+(")/m, "version de tête");
remplacer("package-lock.json", /("":\s*\{[^}]*?"version":\s*")[^"]+(")/, "packages[\"\"].version");

// Cargo.toml : seule la clé version de la section [package].
const cargo = lire("src-tauri/Cargo.toml");
const nom = cargo.match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m)?.[1];
const cargoMaj = cargo.replace(/(^\[package\][^[]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
if (!nom || cargoMaj === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error("Cargo.toml : section [package] introuvable");
  process.exit(1);
}
ecrire("src-tauri/Cargo.toml", cargoMaj);

// Cargo.lock : l'entrée du paquet de l'appli.
const lock = lire("src-tauri/Cargo.lock");
const motif = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${nom}"\\r?\\nversion = ")[^"]+(")`);
if (!motif.test(lock)) {
  console.error(`Cargo.lock : paquet ${nom} introuvable`);
  process.exit(1);
}
ecrire("src-tauri/Cargo.lock", lock.replace(motif, `$1${version}$2`));

console.log(`Vitrum passe en ${version} : package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock.`);
console.log(`Ensuite : git commit -am "Version ${version}" && git push`);
