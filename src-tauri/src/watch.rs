//! Surveillance des fichiers ouverts : prévient l'interface quand une autre
//! application modifie, remplace ou supprime une note affichée.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter, Manager};

use crate::files;

pub fn content_hash(content: &str) -> u64 {
    let mut h = DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
}

fn key(path: &Path) -> String {
    let s = path.to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.into_owned()
    }
}

struct Tracked {
    path: PathBuf,
    hash: u64,
    exists: bool,
}

#[derive(Default)]
struct Inner {
    files: HashMap<String, Tracked>,
    dirs: HashMap<PathBuf, usize>,
}

#[derive(Default)]
pub struct FileWatcher {
    inner: Mutex<Inner>,
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl FileWatcher {
    pub fn start(&self, app: AppHandle) {
        let handler = move |result: DebounceEventResult| {
            if let Ok(events) = result {
                let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
                app.state::<crate::AppState>().watcher.on_change(&app, paths);
            }
        };
        match new_debouncer(Duration::from_millis(300), handler) {
            Ok(d) => *self.debouncer.lock().unwrap() = Some(d),
            Err(e) => eprintln!("surveillance des fichiers indisponible : {e}"),
        }
    }

    /// Note ouverte dans un onglet : surveille son dossier.
    pub fn track(&self, path: &Path, content: &str) {
        let Some(dir) = path.parent().map(Path::to_path_buf) else { return };
        let watch_dir = {
            let mut inner = self.inner.lock().unwrap();
            let k = key(path);
            let is_new = !inner.files.contains_key(&k);
            inner.files.insert(k, Tracked { path: path.to_path_buf(), hash: content_hash(content), exists: true });
            if !is_new {
                return;
            }
            let count = inner.dirs.entry(dir.clone()).or_insert(0);
            *count += 1;
            *count == 1
        };
        if watch_dir {
            if let Some(d) = self.debouncer.lock().unwrap().as_mut() {
                let _ = d.watcher().watch(&dir, RecursiveMode::NonRecursive);
            }
        }
    }

    pub fn untrack(&self, path: &Path) {
        let unwatch = {
            let mut inner = self.inner.lock().unwrap();
            if inner.files.remove(&key(path)).is_none() {
                return;
            }
            let Some(dir) = path.parent().map(Path::to_path_buf) else { return };
            match inner.dirs.get_mut(&dir) {
                Some(count) if *count > 1 => {
                    *count -= 1;
                    None
                }
                Some(_) => {
                    inner.dirs.remove(&dir);
                    Some(dir)
                }
                None => None,
            }
        };
        if let Some(dir) = unwatch {
            if let Some(d) = self.debouncer.lock().unwrap().as_mut() {
                let _ = d.watcher().unwatch(&dir);
            }
        }
    }

    /// Avant une écriture par Vitrum : ce contenu ne doit pas être signalé
    /// comme une modification extérieure. Renvoie l'empreinte précédente.
    pub fn expect_content(&self, path: &Path, content: &str) -> Option<u64> {
        let mut inner = self.inner.lock().unwrap();
        inner.files.get_mut(&key(path)).map(|t| {
            t.exists = true;
            std::mem::replace(&mut t.hash, content_hash(content))
        })
    }

    pub fn restore_hash(&self, path: &Path, hash: u64) {
        if let Some(t) = self.inner.lock().unwrap().files.get_mut(&key(path)) {
            t.hash = hash;
        }
    }

    fn on_change(&self, app: &AppHandle, paths: Vec<PathBuf>) {
        for changed in paths {
            let k = key(&changed);
            let Some((path, hash, existed)) = self
                .inner
                .lock()
                .unwrap()
                .files
                .get(&k)
                .map(|t| (t.path.clone(), t.hash, t.exists))
            else {
                continue;
            };
            if path.is_file() {
                let Ok(data) = files::read(&path) else { continue };
                let new_hash = content_hash(&data.content);
                if new_hash != hash || !existed {
                    if let Some(t) = self.inner.lock().unwrap().files.get_mut(&k) {
                        t.hash = new_hash;
                        t.exists = true;
                    }
                    let _ = app.emit("file-changed", &data);
                }
            } else if existed {
                if let Some(t) = self.inner.lock().unwrap().files.get_mut(&k) {
                    t.exists = false;
                }
                let _ = app.emit("file-removed", path.to_string_lossy().into_owned());
            }
        }
    }
}
