// Écrit latest.json, le fichier que Vitrum lit pour savoir s'il existe une nouvelle version
// (plugin updater de Tauri). Appelé par publier.ps1 / publier.sh quand les fichiers des deux
// machines sont dans la publication.
//
//   node scripts/latest-json.mjs <version> <dépôt owner/nom> <dossier des .sig> <fichier de sortie>
//
// Le dossier doit contenir Vitrum-Setup.exe.sig (PC) et Vitrum-macOS.app.tar.gz.sig (Mac).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, repo, dir, out] = process.argv.slice(2);
if (!version || !repo || !dir || !out) {
  console.error('usage : node scripts/latest-json.mjs <version> <owner/nom> <dossier des .sig> <sortie>');
  process.exit(2);
}

const base = `https://github.com/${repo}/releases/download/v${version}`;
const sig = (name) => readFileSync(join(dir, `${name}.sig`), 'utf8').trim();

const latest = {
  version,
  notes: `Vitrum ${version}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: {
    'windows-x86_64': { signature: sig('Vitrum-Setup.exe'), url: `${base}/Vitrum-Setup.exe` },
    'darwin-aarch64': { signature: sig('Vitrum-macOS.app.tar.gz'), url: `${base}/Vitrum-macOS.app.tar.gz` },
  },
};
writeFileSync(out, JSON.stringify(latest, null, 2) + '\n');
console.log(`    latest.json : ${version}, Windows et Mac (Apple Silicon)`);
