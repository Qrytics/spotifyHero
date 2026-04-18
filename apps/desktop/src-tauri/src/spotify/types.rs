use serde::{Deserialize, Serialize};

/// Mirrors `@spotifyhero/shared-types` `PlaybackState` + nested track (camelCase JSON).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatePayload {
    pub is_playing: bool,
    pub position_ms: u64,
    pub track_id: Option<String>,
    pub track: Option<TrackPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPayload {
    pub id: String,
    pub name: String,
    pub artists: Vec<String>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_art: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
    #[serde(default)]
    pub refresh_token: Option<String>,
}
