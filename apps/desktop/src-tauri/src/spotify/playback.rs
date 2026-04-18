//! Spotify Web API — currently playing.

use crate::spotify::types::{PlaybackStatePayload, TrackPayload};
use reqwest::Client;
use serde::Deserialize;

const CURRENTLY_PLAYING: &str = "https://api.spotify.com/v1/me/player/currently-playing";

#[derive(Debug, Deserialize)]
struct CurrentlyPlayingBody {
    is_playing: bool,
    #[serde(default)]
    progress_ms: Option<u64>,
    item: Option<TrackItem>,
}

#[derive(Debug, Deserialize)]
struct TrackItem {
    id: String,
    name: String,
    artists: Vec<ArtistName>,
    duration_ms: u64,
    album: AlbumImages,
}

#[derive(Debug, Deserialize)]
struct ArtistName {
    name: String,
}

#[derive(Debug, Deserialize)]
struct AlbumImages {
    #[serde(default)]
    images: Vec<ImageUrl>,
}

#[derive(Debug, Deserialize)]
struct ImageUrl {
    url: String,
    #[serde(default)]
    height: Option<u32>,
}

pub fn idle_playback() -> PlaybackStatePayload {
    PlaybackStatePayload {
        is_playing: false,
        position_ms: 0,
        track_id: None,
        track: None,
    }
}

pub async fn fetch_current_playback(
    client: &Client,
    access_token: &str,
) -> Result<PlaybackStatePayload, String> {
    let res = client
        .get(CURRENTLY_PLAYING)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    match res.status().as_u16() {
        204 => return Ok(idle_playback()),
        401 => return Err("unauthorized".into()),
        429 => {
            let msg = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .map(|s| format!("Spotify rate limited — retry after {} s.", s))
                .unwrap_or_else(|| "Spotify rate limited.".into());
            return Err(msg);
        }
        s if !(200..300).contains(&s) => {
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Spotify API error {}: {}", s, body));
        }
        _ => {}
    }

    let body: CurrentlyPlayingBody = res.json().await.map_err(|e| e.to_string())?;

    let Some(item) = body.item else {
        return Ok(idle_playback());
    };

    let album_art = item
        .album
        .images
        .iter()
        .max_by_key(|i| i.height.unwrap_or(0))
        .map(|i| i.url.clone());

    let artists: Vec<String> = item.artists.into_iter().map(|a| a.name).collect();

    let track_id = item.id.clone();
    let track = TrackPayload {
        id: item.id,
        name: item.name,
        artists,
        duration_ms: item.duration_ms,
        bpm: None,
        album_art,
    };

    Ok(PlaybackStatePayload {
        is_playing: body.is_playing,
        position_ms: body.progress_ms.unwrap_or(0),
        track_id: Some(track_id),
        track: Some(track),
    })
}
