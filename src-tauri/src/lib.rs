//! Vitrum : lecteur et éditeur Markdown façon Obsidian, pour des fichiers
//! ouverts depuis n'importe où (pas besoin de coffre).

pub mod files;
pub mod markdown;
pub mod media;
pub mod platform;
pub mod resolve;
pub mod watch;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

use files::{DirEntry, FileData};
use markdown::RenderOptions;
use resolve::{IndexCache, Resolver};
use watch::FileWatcher;

#[derive(Default)]
pub struct AppState {
    pending: Mutex<Pending>,
    index: IndexCache,
    watcher: FileWatcher,
}

/// Fichiers à ouvrir reçus avant que l'interface soit prête.
#[derive(Default)]
struct Pending {
    ready: bool,
    files: Vec<String>,
}

/// Arguments de la ligne de commande (« Ouvrir avec », double-clic) → chemins.
fn file_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let p = PathBuf::from(a.strip_prefix("file://").unwrap_or(&a));
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            p.is_file().then(|| files::canonical(&p).to_string_lossy().into_owned())
        })
        .collect()
}

fn deliver(app: &AppHandle, files: Vec<String>) {
    if !files.is_empty() {
        let state = app.state::<AppState>();
        let mut pending = state.pending.lock().unwrap();
        if pending.ready {
            drop(pending);
            let _ = app.emit("open-files", files);
        } else {
            pending.files.extend(files);
        }
    }
    focus_main(app);
}

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn startup_files(state: State<'_, AppState>) -> Vec<String> {
    let mut pending = state.pending.lock().unwrap();
    pending.ready = true;
    std::mem::take(&mut pending.files)
}

#[tauri::command]
async fn read_file(path: String, state: State<'_, AppState>) -> Result<FileData, String> {
    let path = files::canonical(Path::new(&path));
    let data = files::read(&path)?;
    state.watcher.track(&path, &data.content);
    Ok(data)
}

#[tauri::command]
async fn write_file(path: String, content: String, crlf: bool, bom: bool, state: State<'_, AppState>) -> Result<u64, String> {
    let path = PathBuf::from(path);
    let previous = state.watcher.expect_content(&path, &content);
    files::write(&path, &content, crlf, bom).inspect_err(|_| {
        if let Some(hash) = previous {
            state.watcher.restore_hash(&path, hash);
        }
    })
}

#[tauri::command]
async fn create_file(path: String, state: State<'_, AppState>) -> Result<FileData, String> {
    files::create(Path::new(&path))?;
    read_file(path, state).await
}

#[tauri::command]
async fn forget_file(path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.watcher.untrack(Path::new(&path));
    Ok(())
}

#[tauri::command]
async fn render_markdown(
    path: Option<String>,
    content: String,
    strict_line_breaks: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let file = path.map(PathBuf::from);
    let resolver = Resolver::new(file.as_deref(), &state.index);
    Ok(markdown::render(&content, &resolver, &RenderOptions { strict_line_breaks }))
}

#[tauri::command]
async fn resolve_link(from: Option<String>, href: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let file = from.map(PathBuf::from);
    let resolver = Resolver::new(file.as_deref(), &state.index);
    Ok(resolver.resolve_link(&href).map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    files::list_dir(Path::new(&path))
}

#[tauri::command]
fn default_app_status() -> platform::DefaultAppStatus {
    platform::status()
}

#[tauri::command]
fn open_default_app_settings() -> Result<(), String> {
    platform::open_settings()
}

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Vitrum")
        .inner_size(1200.0, 800.0)
        .min_inner_size(520.0, 380.0)
        .visible(false)
        .zoom_hotkeys_enabled(true);
    // Windows : barre de titre dessinée par l'interface (onglets dans la barre).
    #[cfg(windows)]
    let builder = builder.decorations(false).shadow(true);
    // macOS : feux tricolores natifs par-dessus la barre d'onglets.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(14.0, 13.0));
    let window = builder.build()?;

    // L'interface s'affiche d'elle-même une fois prête ; filet de sécurité.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
        }
    });
    Ok(())
}

/// Menu macOS en français, sans « Fermer la fenêtre » : ⌘W ferme l'onglet.
/// (Compilé partout pour vérifier l'API, utilisé seulement sur Mac.)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mac_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, PredefinedMenuItem as P, Submenu};
    let app_menu = Submenu::with_items(
        app,
        "Vitrum",
        true,
        &[
            &P::about(app, Some("À propos de Vitrum"), None)?,
            &P::separator(app)?,
            &P::services(app, Some("Services"))?,
            &P::separator(app)?,
            &P::hide(app, Some("Masquer Vitrum"))?,
            &P::hide_others(app, Some("Masquer les autres"))?,
            &P::show_all(app, Some("Tout afficher"))?,
            &P::separator(app)?,
            &P::quit(app, Some("Quitter Vitrum"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Édition",
        true,
        &[
            &P::undo(app, Some("Annuler"))?,
            &P::redo(app, Some("Rétablir"))?,
            &P::separator(app)?,
            &P::cut(app, Some("Couper"))?,
            &P::copy(app, Some("Copier"))?,
            &P::paste(app, Some("Coller"))?,
            &P::select_all(app, Some("Tout sélectionner"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Fenêtre",
        true,
        &[&P::minimize(app, Some("Réduire"))?, &P::fullscreen(app, Some("Plein écran"))?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(mac_menu);
    let app = builder
        // Une seule instance : un deuxième lancement passe ses fichiers à la première.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = file_args(argv.into_iter().skip(1), Path::new(&cwd));
            deliver(app, files);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .manage(AppState::default())
        .register_asynchronous_uri_scheme_protocol(media::SCHEME, |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(media::handle(&request)));
        })
        .invoke_handler(tauri::generate_handler![
            startup_files,
            read_file,
            write_file,
            create_file,
            forget_file,
            render_markdown,
            resolve_link,
            list_dir,
            default_app_status,
            open_default_app_settings,
        ])
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let files = file_args(std::env::args().skip(1), &cwd);
            app.state::<AppState>().pending.lock().unwrap().files.extend(files);
            app.state::<AppState>().watcher.start(app.handle().clone());
            create_main_window(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("impossible de démarrer Vitrum");

    app.run(|_app, _event| {
        // macOS : fichiers ouverts depuis le Finder (« Ouvrir avec », double-clic).
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let files: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .filter(|p| p.is_file())
                .map(|p| files::canonical(&p).to_string_lossy().into_owned())
                .collect();
            deliver(_app, files);
        }
    });
}
