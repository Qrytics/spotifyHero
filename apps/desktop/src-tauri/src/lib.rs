// spotifyHero – Tauri 2 application entry point

pub mod commands;
pub mod spotify;
pub mod settings;

use tauri::{
    WebviewUrl,
    WebviewWindowBuilder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Build the overlay window: small, always-on-top, no decorations on macOS/Linux
            let win = WebviewWindowBuilder::new(
                app,
                "overlay",
                WebviewUrl::App("index.html".into()),
            )
            .title("spotifyHero")
            .inner_size(360.0, 640.0)
            .min_inner_size(200.0, 400.0)
            .always_on_top(true)
            .decorations(true)          // Keep OS chrome so user can drag/minimize
            .transparent(false)
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
            commands::set_always_on_top,
            commands::save_window_geometry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running spotifyHero");
}
