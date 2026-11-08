//! Application par défaut pour les fichiers `.md`.
//!
//! Windows interdit aux programmes de se déclarer eux-mêmes par défaut :
//! l'installateur enregistre Vitrum (« Ouvrir avec », page « Applications par
//! défaut »), puis c'est la personne qui valide dans les Paramètres.

use serde::Serialize;

/// Identifiant de type de fichier créé par l'installateur (voir `windows/hooks.nsh`).
pub const PROG_ID: &str = "Vitrum.Markdown";
/// Nom sous `HKCU\Software\RegisteredApplications`.
pub const REGISTERED_APP: &str = "Vitrum";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppStatus {
    pub platform: &'static str,
    /// Vitrum est déclaré auprès du système (installé avec l'installateur).
    pub registered: bool,
    /// Vitrum ouvre déjà les `.md` par défaut.
    pub is_default: bool,
}

#[cfg(windows)]
pub fn status() -> DefaultAppStatus {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let registered = hkcu
        .open_subkey(r"Software\RegisteredApplications")
        .and_then(|k| k.get_value::<String, _>(REGISTERED_APP))
        .is_ok();
    let base = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md";
    let is_default = ["UserChoiceLatest", r"UserChoiceLatest\ProgId", "UserChoice"].iter().any(|sub| {
        hkcu.open_subkey(format!(r"{base}\{sub}"))
            .and_then(|k| k.get_value::<String, _>("ProgId"))
            .map(|id| id.eq_ignore_ascii_case(PROG_ID))
            .unwrap_or(false)
    });
    DefaultAppStatus { platform: "windows", registered, is_default }
}

#[cfg(windows)]
pub fn open_settings() -> Result<(), String> {
    let uri = if status().registered {
        format!("ms-settings:defaultapps?registeredAppUser={REGISTERED_APP}")
    } else {
        "ms-settings:defaultapps".to_string()
    };
    std::process::Command::new("explorer.exe")
        .arg(uri)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Impossible d'ouvrir les Paramètres : {e}"))
}

#[cfg(target_os = "macos")]
pub fn status() -> DefaultAppStatus {
    DefaultAppStatus { platform: "macos", registered: true, is_default: false }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn status() -> DefaultAppStatus {
    DefaultAppStatus { platform: "linux", registered: false, is_default: false }
}

#[cfg(not(windows))]
pub fn open_settings() -> Result<(), String> {
    Err("Dans le Finder : Lire les informations sur un .md › Ouvrir avec › Vitrum › Tout modifier.".into())
}
