//! Retrouve les fichiers visés par les liens et intégrations d'une note :
//! d'abord à côté de la note, puis dans le coffre Obsidian s'il y en a un
//! (dossier parent contenant `.obsidian`), sinon dans les sous-dossiers.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use percent_encoding::percent_decode_str;

const INDEX_TTL: Duration = Duration::from_secs(20);

type Index = Arc<Vec<(String, PathBuf)>>;

/// Index des fichiers par dossier racine, gardé quelques secondes.
#[derive(Default)]
pub struct IndexCache {
    entries: Mutex<HashMap<PathBuf, (Instant, Index)>>,
}

impl IndexCache {
    fn get(&self, root: &Path, max_depth: usize, max_entries: usize) -> Index {
        if let Some((at, index)) = self.entries.lock().unwrap().get(root) {
            if at.elapsed() < INDEX_TTL {
                return index.clone();
            }
        }
        let index: Index = Arc::new(build_index(root, max_depth, max_entries));
        self.entries.lock().unwrap().insert(root.to_path_buf(), (Instant::now(), index.clone()));
        index
    }
}

pub struct Resolver<'c> {
    base_dir: Option<PathBuf>,
    vault: Option<PathBuf>,
    cache: &'c IndexCache,
    index: OnceLock<Index>,
}

impl<'c> Resolver<'c> {
    /// `file` : la note affichée (absente pour un nouvel onglet sans fichier).
    pub fn new(file: Option<&Path>, cache: &'c IndexCache) -> Self {
        let base_dir = file.and_then(|f| f.parent()).map(Path::to_path_buf);
        let vault = base_dir.as_deref().and_then(find_vault_root);
        Resolver { base_dir, vault, cache, index: OnceLock::new() }
    }

    pub fn vault(&self) -> Option<&Path> {
        self.vault.as_deref()
    }

    /// Une note visée par un wikilink ou un lien Markdown (`.md` implicite).
    pub fn resolve_note(&self, target: &str) -> Option<PathBuf> {
        self.find(target, true)
    }

    /// Un fichier quelconque (image, PDF…) ; l'extension doit être donnée.
    pub fn resolve_file(&self, target: &str) -> Option<PathBuf> {
        self.find(target, false)
    }

    /// Lien cliqué dans la vue de lecture : `href` brut (encodé) ou cible de wikilink.
    pub fn resolve_link(&self, href: &str) -> Option<PathBuf> {
        let decoded = decode(href);
        let (target, _) = split_subpath(&decoded);
        let target = target.strip_prefix("file:///").unwrap_or(target);
        self.resolve_note(target)
    }

    fn find(&self, target: &str, try_note: bool) -> Option<PathBuf> {
        let target = target.trim();
        if target.is_empty() {
            return None;
        }
        let mut names = vec![target.to_string()];
        if try_note && !crate::files::is_note(Path::new(target)) {
            names.insert(0, format!("{target}.md"));
        }

        for name in &names {
            let as_path = Path::new(name);
            if as_path.is_absolute() {
                if as_path.is_file() {
                    return Some(crate::files::canonical(as_path));
                }
                continue;
            }
            for dir in [self.base_dir.as_deref(), self.vault.as_deref()].into_iter().flatten() {
                let candidate = dir.join(as_path);
                if candidate.is_file() {
                    return Some(crate::files::canonical(&candidate));
                }
            }
        }

        // Recherche par nom dans l'index (Obsidian prend le chemin le plus court).
        let index = self.index();
        for name in &names {
            let needle = normalize(name.trim_start_matches("./"));
            let suffix = format!("/{needle}");
            let found = index
                .iter()
                .filter(|(key, _)| key.ends_with(&suffix) || *key == needle)
                .min_by_key(|(key, _)| key.len());
            if let Some((_, path)) = found {
                return Some(path.clone());
            }
        }
        None
    }

    fn index(&self) -> &Index {
        self.index.get_or_init(|| match (&self.vault, &self.base_dir) {
            (Some(vault), _) => self.cache.get(vault, 16, 100_000),
            (None, Some(base)) => self.cache.get(base, 3, 5_000),
            (None, None) => Arc::new(Vec::new()),
        })
    }
}

/// Dossier ancêtre contenant `.obsidian`, s'il existe.
pub fn find_vault_root(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().take(40).find(|d| d.join(".obsidian").is_dir()).map(Path::to_path_buf)
}

/// Sépare `note#Titre` ou `note#^bloc` en (`note`, `#Titre`).
pub fn split_subpath(target: &str) -> (&str, &str) {
    match target.find('#') {
        Some(i) => (&target[..i], &target[i..]),
        None => (target, ""),
    }
}

pub fn decode(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().into_owned()
}

fn normalize(s: &str) -> String {
    s.replace('\\', "/").to_lowercase()
}

fn build_index(root: &Path, max_depth: usize, max_entries: usize) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name.starts_with('$') {
                continue;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if depth < max_depth && !matches!(name.as_ref(), "node_modules" | "target") {
                    stack.push((entry.path(), depth + 1));
                }
            } else if kind.is_file() {
                let path = entry.path();
                out.push((normalize(&path.to_string_lossy()), path));
                if out.len() >= max_entries {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree() -> PathBuf {
        let root = std::env::temp_dir().join(format!("vitrum-resolve-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::create_dir_all(root.join("notes/sub")).unwrap();
        fs::create_dir_all(root.join("attachments")).unwrap();
        fs::write(root.join("notes/sub/page.md"), "# Page").unwrap();
        fs::write(root.join("notes/autre note.md"), "x").unwrap();
        fs::write(root.join("attachments/image 1.png"), [0u8; 4]).unwrap();
        root
    }

    #[test]
    fn resolves_in_vault() {
        let root = temp_tree();
        let cache = IndexCache::default();
        let file = root.join("notes/sub/page.md");
        let r = Resolver::new(Some(&file), &cache);
        assert_eq!(r.vault().map(crate::files::canonical), Some(crate::files::canonical(&root)));
        assert!(r.resolve_file("image 1.png").unwrap().ends_with("image 1.png"));
        assert!(r.resolve_note("autre note").unwrap().ends_with("autre note.md"));
        assert!(r.resolve_note("notes/autre note").is_some());
        assert!(r.resolve_link("../autre%20note.md#Titre").is_some());
        assert!(r.resolve_note("absente").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
