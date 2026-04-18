//! Spotify token persistence via `tauri-plugin-store` (`settings.json`).

use crate::spotify::types::TokenResponse;
use reqwest::Client;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::Store;

pub const SPOTIFY_ACCESS_TOKEN: &str = "spotify_access_token";
pub const SPOTIFY_REFRESH_TOKEN: &str = "spotify_refresh_token";
pub const SPOTIFY_EXPIRES_AT_MS: &str = "spotify_expires_at_ms";

pub fn ms_now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn load_store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Arc<Store<R>>, String> {
    tauri_plugin_store::StoreBuilder::new(app, "settings.json")
        .build()
        .map_err(|e| e.to_string())
}

pub fn has_refresh_token<R: Runtime>(store: &Store<R>) -> bool {
    store
        .get(SPOTIFY_REFRESH_TOKEN)
        .and_then(|v| v.as_str().map(|s| !s.is_empty()))
        .unwrap_or(false)
}

pub fn save_tokens<R: Runtime>(
    store: &Store<R>,
    resp: &TokenResponse,
    previous_refresh: Option<&str>,
) -> Result<(), String> {
    store.set(
        SPOTIFY_ACCESS_TOKEN,
        serde_json::json!(resp.access_token.clone()),
    );
    if let Some(rt) = resp.refresh_token.as_ref() {
        store.set(SPOTIFY_REFRESH_TOKEN, serde_json::json!(rt));
    } else if let Some(prev) = previous_refresh {
        store.set(SPOTIFY_REFRESH_TOKEN, serde_json::json!(prev));
    }
    let expires_ms = ms_now() + u128::from(resp.expires_in) * 1000;
    store.set(SPOTIFY_EXPIRES_AT_MS, serde_json::json!(expires_ms.to_string()));
    store.save().map_err(|e| e.to_string())
}

pub fn clear_tokens<R: Runtime>(store: &Store<R>) -> Result<(), String> {
    store.delete(SPOTIFY_ACCESS_TOKEN);
    store.delete(SPOTIFY_REFRESH_TOKEN);
    store.delete(SPOTIFY_EXPIRES_AT_MS);
    store.save().map_err(|e| e.to_string())
}

pub fn access_needs_refresh<R: Runtime>(store: &Store<R>) -> bool {
    let expires = store.get(SPOTIFY_EXPIRES_AT_MS).and_then(|v| {
        if let Some(s) = v.as_str() {
            return s.parse::<u128>().ok();
        }
        v.as_u64().map(|u| u128::from(u))
    });

    match expires {
        None => true,
        Some(at) => ms_now() >= at.saturating_sub(60_000),
    }
}

/// Returns `None` if the user has never connected Spotify.
pub async fn ensure_access_token<R: Runtime>(
    app: &AppHandle<R>,
    client: &Client,
    client_id: &str,
) -> Result<Option<String>, String> {
    let store = load_store(app)?;
    if !has_refresh_token(store.as_ref()) {
        return Ok(None);
    }

    if !access_needs_refresh(store.as_ref()) {
        let t = store
            .get(SPOTIFY_ACCESS_TOKEN)
            .and_then(|v| v.as_str().map(str::to_string))
            .filter(|s| !s.is_empty());
        if let Some(tok) = t {
            return Ok(Some(tok));
        }
    }

    let refresh = store
        .get(SPOTIFY_REFRESH_TOKEN)
        .and_then(|v| v.as_str().map(str::to_string))
        .ok_or_else(|| "Missing Spotify refresh token — use Connect Spotify.".to_string())?;

    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("client_id", client_id),
    ];

    let res = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let _ = clear_tokens(store.as_ref());
        return Err(format!(
            "Spotify token refresh failed ({}). Use Connect Spotify again.",
            res.status()
        ));
    }

    let tr: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    save_tokens(store.as_ref(), &tr, Some(refresh.as_str()))?;
    Ok(Some(tr.access_token))
}
