//! Spotify Web API — playback state (currently-playing + full player fallback).

use crate::spotify::types::{PlaybackStatePayload, TrackPayload};
use reqwest::Client;
use reqwest::RequestBuilder;
use serde_json::Value;

const CURRENTLY_PLAYING: &str = "https://api.spotify.com/v1/me/player/currently-playing";
const PLAYER: &str = "https://api.spotify.com/v1/me/player";

pub fn idle_playback() -> PlaybackStatePayload {
    PlaybackStatePayload {
        is_playing: false,
        position_ms: 0,
        track_id: None,
        track: None,
    }
}

fn rate_limit_message(res: &reqwest::Response) -> String {
    res.headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .map(|s| format!("Spotify rate limited — retry after {} s.", s))
        .unwrap_or_else(|| "Spotify rate limited.".into())
}

fn player_request(client: &Client, access_token: &str, with_market: bool) -> RequestBuilder {
    let mut b = client
        .get(PLAYER)
        .bearer_auth(access_token);
    if with_market {
        b = b.query(&[("market", "from_token")]);
    }
    b
}

async fn fetch_full_player_inner(
    client: &Client,
    access_token: &str,
    with_market: bool,
) -> Result<PlaybackStatePayload, String> {
    let pl = player_request(client, access_token, with_market)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    match pl.status().as_u16() {
        401 => Err("unauthorized".into()),
        429 => Err(rate_limit_message(&pl)),
        204 => Ok(idle_playback()),
        s if !(200..300).contains(&s) => {
            let body = pl.text().await.unwrap_or_default();
            Err(format!("Spotify /me/player error {}: {}", s, body))
        }
        _ => {
            let body: Value = pl.json().await.map_err(|e| e.to_string())?;
            Ok(parse_playback_body(&body))
        }
    }
}

/// Full player state — often populated when `currently-playing` is empty or restricted.
/// Retries once **without** `market` when the first response has no track (some accounts differ).
async fn fetch_full_player(
    client: &Client,
    access_token: &str,
) -> Result<PlaybackStatePayload, String> {
    let first = fetch_full_player_inner(client, access_token, true).await?;
    if first.track_id.is_some() {
        return Ok(first);
    }
    fetch_full_player_inner(client, access_token, false).await
}

fn currently_playing_request(client: &Client, access_token: &str, with_market: bool) -> RequestBuilder {
    let mut b = client
        .get(CURRENTLY_PLAYING)
        .bearer_auth(access_token);
    if with_market {
        b = b.query(&[("market", "from_token")]);
    }
    b
}

/// Spotify often returns **204** from `currently-playing` even when the desktop app is playing.
/// **403** can appear for account/region edge cases — **`GET /me/player`** still often works.
/// **5xx** from currently-playing is treated as transient; we fall back to the player endpoint.
pub async fn fetch_current_playback(
    client: &Client,
    access_token: &str,
) -> Result<PlaybackStatePayload, String> {
    let cp = currently_playing_request(client, access_token, true)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    match cp.status().as_u16() {
        401 => Err("unauthorized".into()),
        429 => Err(rate_limit_message(&cp)),
        200 => {
            let body: Value = cp.json().await.map_err(|e| e.to_string())?;
            let parsed = parse_playback_body(&body);
            if parsed.track_id.is_some() {
                return Ok(parsed);
            }
            fetch_full_player(client, access_token).await
        }
        204 | 403 => fetch_full_player(client, access_token).await,
        s if (500..600).contains(&s) => fetch_full_player(client, access_token).await,
        s => {
            let body = cp.text().await.unwrap_or_default();
            Err(format!(
                "Spotify currently-playing error {}: {}",
                s, body
            ))
        }
    }
}

fn parse_playback_body(body: &Value) -> PlaybackStatePayload {
    let is_playing = body["is_playing"].as_bool().unwrap_or(false);
    let progress_ms = json_u64(&body["progress_ms"]).unwrap_or(0);

    let item = match body.get("item") {
        Some(v) if v.is_object() && !v.is_null() => v,
        _ => return idle_playback(),
    };

    let track = item_to_track(item);
    let tid = track.id.clone();

    PlaybackStatePayload {
        is_playing,
        position_ms: progress_ms,
        track_id: Some(tid),
        track: Some(track),
    }
}

fn json_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_i64().map(|i| i.max(0) as u64))
        .or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
}

/// Spotify local files and rare catalog rows may omit `id`; `uri` is usually present.
fn spotify_item_id(item: &Value) -> String {
    if let Some(id) = item["id"].as_str() {
        if !id.is_empty() {
            return id.to_string();
        }
    }
    if let Some(uri) = item["uri"].as_str() {
        if !uri.is_empty() {
            return uri.to_string();
        }
    }
    let name = item["name"].as_str().unwrap_or("unknown");
    format!("unknown:{name}")
}

fn item_to_track(item: &Value) -> TrackPayload {
    let id = spotify_item_id(item);
    let name = item["name"]
        .as_str()
        .unwrap_or("Unknown")
        .to_string();
    let duration_ms = json_u64(&item["duration_ms"])
        .unwrap_or(60_000)
        .clamp(1, u64::MAX);

    let kind = item["type"].as_str().unwrap_or("track");

    let (artists, album_art) = if kind == "episode" {
        let show_name = item["show"]["name"]
            .as_str()
            .or_else(|| item["show"]["publisher"].as_str())
            .unwrap_or("Podcast");
        let artists = vec![show_name.to_string()];
        let art = best_image_url(item.get("images").or_else(|| item["show"].get("images")));
        (artists, art)
    } else {
        let mut artists: Vec<String> = item["artists"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a["name"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if artists.is_empty() {
            artists.push("Unknown artist".into());
        }
        let art = item
            .get("album")
            .and_then(|a| best_image_url(a.get("images")));
        (artists, art)
    };

    TrackPayload {
        id,
        name,
        artists,
        duration_ms,
        bpm: None,
        album_art,
    }
}

fn best_image_url(images: Option<&Value>) -> Option<String> {
    let arr = images?.as_array()?;
    arr.iter()
        .filter_map(|img| {
            let url = img["url"].as_str()?.to_string();
            let h = img["height"].as_u64().unwrap_or(0);
            Some((h, url))
        })
        .max_by_key(|(h, _)| *h)
        .map(|(_, u)| u)
}
