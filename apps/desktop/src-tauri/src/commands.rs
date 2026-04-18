use crate::spotify::{
    clear_tokens, ensure_access_token, fetch_current_playback, idle_playback, load_store,
    run_login, PlaybackStatePayload,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::command;
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;

static HTTP: OnceLock<Client> = OnceLock::new();

/// In-flight OAuth task so a new "Connect Spotify" click can abort the previous attempt
/// (e.g. user closed the browser tab) and bind :8888 again.
static SPOTIFY_OAUTH_TASK: OnceLock<TokioMutex<Option<JoinHandle<()>>>> = OnceLock::new();

fn oauth_task_slot() -> &'static TokioMutex<Option<JoinHandle<()>>> {
    SPOTIFY_OAUTH_TASK.get_or_init(|| TokioMutex::new(None))
}

async fn abort_spotify_oauth() {
    let mut guard = oauth_task_slot().lock().await;
    if let Some(h) = guard.take() {
        h.abort();
    }
}

fn http_client() -> &'static Client {
    HTTP.get_or_init(Client::new)
}

// ---------------------------------------------------------------------------
// Spotify
// ---------------------------------------------------------------------------

/// Starts browser PKCE login in the background and returns immediately.
/// Clicking again aborts any in-flight login so the user can reopen Spotify after closing the tab.
#[command]
pub async fn spotify_login(app: tauri::AppHandle) -> Result<(), String> {
    std::env::var("SPOTIFY_CLIENT_ID").map_err(|_| {
        "Missing SPOTIFY_CLIENT_ID. Add it to apps/desktop/src-tauri/.env".to_string()
    })?;

    let mut guard = oauth_task_slot().lock().await;
    if let Some(h) = guard.take() {
        h.abort();
    }

    let app_spawn = app.clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = run_login(app_spawn).await {
            eprintln!("[spotifyHero] Spotify login failed: {}", e);
        }
    });
    *guard = Some(handle);

    Ok(())
}

#[command]
pub async fn spotify_logout(app: tauri::AppHandle) -> Result<(), String> {
    abort_spotify_oauth().await;
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
        // Avoid failing the IPC channel on transient limits — UI keeps last good state via poller.
        Err(e) if e.contains("rate limited") => Ok(idle_playback()),
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
