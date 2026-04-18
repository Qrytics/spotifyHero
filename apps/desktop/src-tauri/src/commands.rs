use serde::{Deserialize, Serialize};
use tauri::command;

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlaybackState {
    pub is_playing: bool,
    pub position_ms: u64,
    pub track_id: Option<String>,
    pub track_name: Option<String>,
    pub artists: Vec<String>,
    pub duration_ms: u64,
    pub album_art: Option<String>,
}

// ---------------------------------------------------------------------------
// Commands (called from TypeScript via invoke())
// ---------------------------------------------------------------------------

/// Fetch the current Spotify playback state.
/// In a full implementation this calls the Spotify Web API using a stored token.
#[command]
pub async fn get_playback_state() -> Result<PlaybackState, String> {
    // TODO: delegate to spotify::fetch_playback() once OAuth is wired.
    // Returning a stub so the UI can develop independently.
    Ok(PlaybackState {
        is_playing: false,
        position_ms: 0,
        track_id: None,
        track_name: None,
        artists: vec![],
        duration_ms: 0,
        album_art: None,
    })
}

/// Toggle always-on-top for the overlay window.
#[command]
pub async fn set_always_on_top(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())
}

/// Persist window geometry so it is restored on next launch.
#[command]
pub async fn save_window_geometry(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let store = tauri_plugin_store::StoreBuilder::new(&app, "settings.json")
        .build()
        .map_err(|e| e.to_string())?;

    store.set("window_x", serde_json::json!(x));
    store.set("window_y", serde_json::json!(y));
    store.set("window_width", serde_json::json!(width));
    store.set("window_height", serde_json::json!(height));
    store.save().map_err(|e| e.to_string())
}
