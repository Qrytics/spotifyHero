//! Spotify OAuth app registration. The client ID is public (PKCE); it is safe to ship in-repo.

use super::tokens::load_store;
use tauri::AppHandle;
use tauri::Runtime;

/// Default app client ID for this project. Friends can run without creating a `.env`.
/// Override with environment variable `SPOTIFY_CLIENT_ID` if you use a different Spotify app.
pub const DEFAULT_SPOTIFY_CLIENT_ID: &str = "12eb5467aec542e8ad3fb47fa8249675";

pub fn spotify_client_id() -> String {
    match std::env::var("SPOTIFY_CLIENT_ID") {
        Ok(s) => {
            let t = s.trim();
            if t.is_empty() {
                DEFAULT_SPOTIFY_CLIENT_ID.to_string()
            } else {
                t.to_string()
            }
        }
        Err(_) => DEFAULT_SPOTIFY_CLIENT_ID.to_string(),
    }
}

/// Per-user Client ID from app settings (`settings.json`), then env, then built-in default.
/// Lets players use their own Spotify Developer app so they are not limited by the shared app’s dev-mode allowlist.
pub fn resolve_spotify_client_id<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Ok(store) = load_store(app) {
        if let Some(v) = store.get("spotify_client_id") {
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    spotify_client_id()
}
