use crate::spotify::{
    clear_tokens, ensure_access_token, fetch_current_playback, idle_playback, load_store,
    run_login, PlaybackStatePayload,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::command;

static HTTP: OnceLock<Client> = OnceLock::new();

fn http_client() -> &'static Client {
    HTTP.get_or_init(Client::new)
}

// ---------------------------------------------------------------------------
// Spotify
// ---------------------------------------------------------------------------

/// Browser PKCE login; saves tokens to the plugin store.
#[command]
pub async fn spotify_login(app: tauri::AppHandle) -> Result<(), String> {
    run_login(app).await
}

#[command]
pub async fn spotify_logout(app: tauri::AppHandle) -> Result<(), String> {
    let store = load_store(&app)?;
    clear_tokens(store.as_ref())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyConnectionStatus {
    pub connected: bool,
}

#[command]
pub async fn spotify_connection_status(
    app: tauri::AppHandle,
) -> Result<SpotifyConnectionStatus, String> {
    let store = load_store(&app)?;
    Ok(SpotifyConnectionStatus {
        connected: crate::spotify::tokens::has_refresh_token(store.as_ref()),
    })
}

/// Poll Spotify Web API for the active player (Premium + active device recommended).
#[command]
pub async fn get_playback_state(app: tauri::AppHandle) -> Result<PlaybackStatePayload, String> {
    let Ok(client_id) = std::env::var("SPOTIFY_CLIENT_ID") else {
        return Ok(idle_playback());
    };

    let http = http_client();
    let Some(access) = ensure_access_token(&app, http, &client_id).await? else {
        return Ok(idle_playback());
    };

    match fetch_current_playback(http, &access).await {
        Ok(p) => Ok(p),
        Err(e) if e == "unauthorized" => {
            if let Ok(store) = load_store(&app) {
                let _ = clear_tokens(store.as_ref());
            }
            Ok(idle_playback())
        }
        Err(e) => Err(e),
    }
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
