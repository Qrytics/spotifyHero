//! Spotify Web API — `GET /v1/audio-features/{id}` for estimated tempo (BPM).

use crate::spotify::types::PlaybackStatePayload;
use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static TEMPO_CACHE: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, f64>> {
    TEMPO_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const MAX_CACHE_ENTRIES: usize = 128;

/// Fetches `tempo` once per track id and fills `track.bpm` when missing.
/// Cached so polling does not hammer the Audio Features endpoint.
pub async fn ensure_track_tempo(client: &Client, access_token: &str, payload: &mut PlaybackStatePayload) {
    let Some(track) = payload.track.as_mut() else {
        return;
    };
    if track.bpm.is_some() {
        return;
    }
    let id = track.id.trim();
    if id.is_empty() || id.starts_with("unknown:") {
        return;
    }

    if let Ok(guard) = cache().lock() {
        if let Some(&bpm) = guard.get(id) {
            track.bpm = Some(bpm);
            return;
        }
    }

    let url = format!("https://api.spotify.com/v1/audio-features/{id}");
    let Ok(res) = client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
    else {
        return;
    };

    if !res.status().is_success() {
        return;
    }

    let Ok(body) = res.json::<Value>().await else {
        return;
    };

    let Some(tempo) = body["tempo"].as_f64() else {
        return;
    };
    // Spotify uses -1 when unknown / not analyzed
    if tempo < 1.0 || !tempo.is_finite() {
        return;
    }

    if let Ok(mut guard) = cache().lock() {
        if guard.len() >= MAX_CACHE_ENTRIES {
            guard.clear();
        }
        guard.insert(id.to_string(), tempo);
    }

    if let Some(track) = payload.track.as_mut() {
        track.bpm = Some(tempo);
    }
}
