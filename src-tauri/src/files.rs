//! Lecture et écriture des fichiers texte en conservant leur forme d'origine
//! (BOM UTF-8, fins de ligne CRLF ou LF) : l'interface ne voit que des `\n`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Extensions ouvertes comme des notes.
pub const NOTE_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"];

const MAX_SIZE: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    pub path: String,
    pub name: String,
    pub dir: String,
    /// Contenu avec des fins de ligne `\n`.
    pub content: String,
    /// Le fichier utilisait des fins de ligne Windows (`\r\n`).
    pub crlf: bool,
    /// Le fichier commençait par un BOM UTF-8.
    pub bom: bool,
    /// Date de modification, en millisecondes depuis l'époque Unix.
    pub mtime: u64,
    /// Fichier en lecture seule (attribut système ou encodage non UTF-8).
    pub readonly: bool,
    /// Le fichier n'était pas de l'UTF-8 valide : caractères remplacés.
    pub lossy: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

pub struct Decoded {
    pub content: String,
    pub crlf: bool,
    pub bom: bool,
    pub lossy: bool,
}

pub fn canonical(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| NOTE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn decode(bytes: &[u8]) -> Decoded {
    let (bom, body) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (true, rest),
        None => (false, bytes),
    };
    let (text, lossy) = match std::str::from_utf8(body) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (String::from_utf8_lossy(body).into_owned(), true),
    };
    let crlf = text.contains("\r\n");
    let content = if crlf { text.replace("\r\n", "\n") } else { text };
    Decoded { content, crlf, bom, lossy }
}

pub fn encode(content: &str, crlf: bool, bom: bool) -> Vec<u8> {
    let normalized = content.replace("\r\n", "\n");
    let body = if crlf { normalized.replace('\n', "\r\n") } else { normalized };
    let mut out = Vec::with_capacity(body.len() + 3);
    if bom {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    out.extend_from_slice(body.as_bytes());
    out
}

pub fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read(path: &Path) -> Result<FileData, String> {
    let meta = fs::metadata(path).map_err(|e| io_error(path, e))?;
    if meta.is_dir() {
        return Err(format!("« {} » est un dossier.", path.display()));
    }
    if meta.len() > MAX_SIZE {
        return Err(format!("« {} » est trop volumineux (plus de 50 Mo).", file_name(path)));
    }
    let bytes = fs::read(path).map_err(|e| io_error(path, e))?;
    let decoded = decode(&bytes);
    Ok(FileData {
        path: path.to_string_lossy().into_owned(),
        name: file_name(path),
        dir: path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        content: decoded.content,
        crlf: decoded.crlf,
        bom: decoded.bom,
        mtime: mtime_ms(path),
        readonly: meta.permissions().readonly() || decoded.lossy,
        lossy: decoded.lossy,
    })
}

/// Écrit sur place (comme VS Code) pour garder l'identité du fichier.
pub fn write(path: &Path, content: &str, crlf: bool, bom: bool) -> Result<u64, String> {
    fs::write(path, encode(content, crlf, bom)).map_err(|e| io_error(path, e))?;
    Ok(mtime_ms(path))
}

/// Crée un fichier vide s'il n'existe pas encore (jamais d'écrasement).
pub fn create(path: &Path) -> Result<(), String> {
    match fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(io_error(path, e)),
    }
}

/// Dossiers et notes d'un dossier, dossiers d'abord, sans les éléments cachés.
pub fn list_dir(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let read = fs::read_dir(dir).map_err(|e| io_error(dir, e))?;
    let mut entries: Vec<DirEntry> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.starts_with('$') {
                return None;
            }
            let path = entry.path();
            let is_dir = path.is_dir();
            if !is_dir && !is_note(&path) {
                return None;
            }
            Some(DirEntry { name, path: path.to_string_lossy().into_owned(), is_dir })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| natural_key(&a.name).cmp(&natural_key(&b.name)))
    });
    Ok(entries)
}

/// Clé de tri insensible à la casse, où « note 2 » passe avant « note 10 ».
fn natural_key(name: &str) -> Vec<(u8, String)> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut digits = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_digit() != digits && !current.is_empty() {
            parts.push(part(&current, digits));
            current.clear();
        }
        digits = c.is_ascii_digit();
        current.push(c);
    }
    if !current.is_empty() {
        parts.push(part(&current, digits));
    }
    parts
}

fn part(s: &str, digits: bool) -> (u8, String) {
    if digits {
        let trimmed = s.trim_start_matches('0');
        (0, format!("{:0>20}", trimmed))
    } else {
        (1, s.to_string())
    }
}

pub fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn io_error(path: &Path, e: io::Error) -> String {
    let name = file_name(path);
    match e.kind() {
        io::ErrorKind::NotFound => format!("« {name} » est introuvable (déplacé ou supprimé ?)."),
        io::ErrorKind::PermissionDenied => format!("Accès refusé à « {name} »."),
        _ => format!("« {name} » : {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_crlf_and_bom() {
        let original = b"\xEF\xBB\xBF# Titre\r\n\r\nTexte\r\n";
        let d = decode(original);
        assert!(d.bom && d.crlf && !d.lossy);
        assert_eq!(d.content, "# Titre\n\nTexte\n");
        assert_eq!(encode(&d.content, d.crlf, d.bom), original.to_vec());
    }

    #[test]
    fn keeps_lf() {
        let d = decode(b"a\nb\n");
        assert!(!d.bom && !d.crlf);
        assert_eq!(encode(&d.content, d.crlf, d.bom), b"a\nb\n".to_vec());
    }

    #[test]
    fn natural_sort() {
        let mut names = vec!["note 10", "Note 2", "note 1", "abc"];
        names.sort_by_key(|n| natural_key(n));
        assert_eq!(names, vec!["abc", "note 1", "Note 2", "note 10"]);
    }
}
