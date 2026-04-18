// spotifyHero – Tauri 2 application entry point

pub mod commands;
pub mod spotify;
pub mod settings;

use std::path::Path;
use tauri::{
    WebviewUrl,
    WebviewWindowBuilder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::from_filename(Path::new(env!("CARGO_MANIFEST_DIR")).join(".env"));

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Undecorated: compact custom title bar in overlay-ui (`WindowChrome`); native caption buttons cannot be scaled.
            let win = WebviewWindowBuilder::new(
                app,
                "overlay",
                WebviewUrl::App("index.html".into()),
            )
            .title("spotifyHero")
            // Default (first launch): ~3/4 of prior 380×840 — narrower and shorter.
            .inner_size(180.0, 420.0)
            .min_inner_size(180.0, 280.0)
            // Cap size so the overlay cannot be stretched to a full-screen panel (felt like it broke the desktop).
            .max_inner_size(640.0, 1200.0)
            .always_on_top(true)
            .decorations(false)
            .transparent(false)
            // WebView2: disable Ctrl+/wheel page zoom (often mistaken for “everything on my PC scaled”).
            .zoom_hotkeys_enabled(false)
            .maximizable(false)
            .visible_on_all_workspaces(true)
            .build()
            .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            // Restore persisted window geometry if available
            let store = tauri_plugin_store::StoreBuilder::new(app, "settings.json")
                .build()
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            if let Some(x) = store.get("window_x").and_then(|v| v.as_f64()) {
                // Ignore errors – first launch has no saved position
                let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, 0));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_playback_state,
            commands::get_spotify_user_profile,
            commands::get_spotify_followed_user_ids,
            commands::spotify_login,
            commands::spotify_logout,
            commands::spotify_connection_status,
            commands::spotify_pause_playback,
            commands::spotify_resume_playback,
            commands::set_always_on_top,
            commands::save_window_geometry,
            commands::load_app_settings,
            commands::save_app_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running spotifyHero");
}
