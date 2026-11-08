//! Protocole `vmedia` : sert à la vue de lecture les images, sons, vidéos et
//! PDF locaux référencés par les notes. L'URL contient le chemin absolu encodé ;
//! seuls les types de médias connus sont servis.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::http::{header, Request, Response, StatusCode};

pub const SCHEME: &str = "vmedia";

/// Taille maximale d'un morceau servi pour une requête `Range` ouverte.
const RANGE_CHUNK: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Image,
    Audio,
    Video,
    Pdf,
}

pub fn url_for(path: &Path) -> String {
    let encoded = utf8_percent_encode(&path.to_string_lossy(), NON_ALPHANUMERIC).to_string();
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{encoded}")
    } else {
        format!("{SCHEME}://localhost/{encoded}")
    }
}

pub fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default()
}

pub fn mime(ext: &str) -> Option<(&'static str, Kind)> {
    use Kind::*;
    Some(match ext {
        "png" => ("image/png", Image),
        "jpg" | "jpeg" | "jfif" => ("image/jpeg", Image),
        "gif" => ("image/gif", Image),
        "webp" => ("image/webp", Image),
        "svg" => ("image/svg+xml", Image),
        "bmp" => ("image/bmp", Image),
        "avif" => ("image/avif", Image),
        "ico" => ("image/x-icon", Image),
        "mp3" => ("audio/mpeg", Audio),
        "wav" => ("audio/wav", Audio),
        "ogg" | "oga" | "opus" => ("audio/ogg", Audio),
        "m4a" => ("audio/mp4", Audio),
        "flac" => ("audio/flac", Audio),
        "webm" => ("video/webm", Video),
        "mp4" | "m4v" => ("video/mp4", Video),
        "mov" => ("video/quicktime", Video),
        "ogv" => ("video/ogg", Video),
        "mkv" => ("video/x-matroska", Video),
        "pdf" => ("application/pdf", Pdf),
        _ => return None,
    })
}

pub fn kind(path: &Path) -> Option<Kind> {
    mime(&extension(path)).map(|(_, k)| k)
}

pub fn handle(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let raw = request.uri().path().trim_start_matches('/');
    let path = PathBuf::from(percent_decode_str(raw).decode_utf8_lossy().into_owned());
    let Some((mime, _)) = mime(&extension(&path)) else {
        return status(StatusCode::FORBIDDEN);
    };
    let Ok(mut file) = File::open(&path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, len));
    let (start, end, partial) = match range {
        Some((s, e)) => (s, e, true),
        None => (0, len.saturating_sub(1), false),
    };
    let count = if len == 0 { 0 } else { end - start + 1 };
    let mut body = vec![0u8; count as usize];
    if count > 0 && (file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut body).is_err()) {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    builder = if partial {
        builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
    } else {
        builder.status(StatusCode::OK)
    };
    builder.body(body).unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).expect("réponse vide")
}

fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (s, e) = spec.split_once('-')?;
    if s.is_empty() {
        let n: u64 = e.parse().ok()?;
        let n = n.min(len);
        return (n > 0).then(|| (len - n, len - 1));
    }
    let start: u64 = s.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if e.is_empty() {
        (start + RANGE_CHUNK - 1).min(len - 1)
    } else {
        e.parse::<u64>().ok()?.min(len - 1)
    };
    (end >= start).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
    }

    #[test]
    fn url_round_trip() {
        let p = Path::new(if cfg!(windows) { r"C:\Notes\mon image.png" } else { "/Notes/mon image.png" });
        let url = url_for(p);
        let encoded = url.rsplit('/').next().unwrap();
        assert_eq!(percent_decode_str(encoded).decode_utf8_lossy(), p.to_string_lossy());
    }
}
