//! Spotify Web API — current user profile and social graph (followed users).

use crate::spotify::tokens::{ensure_access_token, load_store};
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const ME: &str = "https://api.spotify.com/v1/me";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyUserPayload {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// `GET /v1/me` — requires `user-read-email` for email field.
pub async fn fetch_current_user(
    app: &AppHandle,
    http: &Client,
    client_id: &str,
) -> Result<Option<SpotifyUserPayload>, String> {
    let _store = load_store(app)?;
    let Some(access) = ensure_access_token(app, http, client_id).await? else {
        return Ok(None);
    };

    let res = http
        .get(ME)
        .bearer_auth(&access)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status() == 401 {
        return Ok(None);
    }
    let status = res.status();
    if !status.is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("Spotify /me error {}: {}", status, t));
    }

    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    let id = v["id"].as_str().unwrap_or("").to_string();
    if id.is_empty() {
        return Ok(None);
    }

    let display_name = v["display_name"]
        .as_str()
        .unwrap_or("Spotify player")
        .to_string();

    Ok(Some(SpotifyUserPayload {
        email: v["email"].as_str().map(std::string::ToString::to_string),
        id,
        display_name,
    }))
}

/// `GET /v1/me/following?type=user` — requires `user-follow-read`.
pub async fn fetch_followed_user_ids(
    app: &AppHandle,
    http: &Client,
    client_id: &str,
) -> Result<Vec<String>, String> {
    let _store = load_store(app)?;
    let Some(access) = ensure_access_token(app, http, client_id).await? else {
        return Ok(Vec::new());
    };

    let mut collected: Vec<String> = Vec::new();
    let mut next_url: Option<String> = Some(format!(
        "https://api.spotify.com/v1/me/following?type=user&limit=50"
    ));

    while let Some(url) = next_url.take() {
        let res = http
            .get(&url)
            .bearer_auth(&access)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if res.status() == 403 || res.status() == 401 {
            return Ok(collected);
        }
        let status = res.status();
        if !status.is_success() {
            let t = res.text().await.unwrap_or_default();
            return Err(format!(
                "Spotify /me/following error {}: {}",
                status,
                t
            ));
        }

        let v: Value = res.json().await.map_err(|e| e.to_string())?;
        append_following_user_ids(&v, &mut collected);
        next_url = v["next"].as_str().map(std::string::ToString::to_string);
        if next_url.as_ref().map_or(true, |s| s.is_empty()) {
            break;
        }
    }

    collected.sort();
    collected.dedup();
    Ok(collected)
}

fn append_following_user_ids(body: &Value, out: &mut Vec<String>) {
    if let Some(items) = body.get("items").and_then(|i| i.as_array()) {
        for item in items {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                out.push(id.to_string());
            }
        }
    }
    for key in ["artists", "users"] {
        let Some(obj) = body.get(key) else {
            continue;
        };
        let Some(items) = obj.get("items").and_then(|i| i.as_array()) else {
            continue;
        };
        for item in items {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                out.push(id.to_string());
            }
        }
    }
}
