/// Spotify integration module.
///
/// Responsibilities:
///   - PKCE OAuth 2.0 authorization flow (opens system browser, captures
///     redirect on localhost loopback).
///   - Access token refresh.
///   - Polling the /me/player/currently-playing endpoint.
///   - Emitting playback state events to the frontend.
///
/// This module is a stub. Wire up the real implementation once your
/// Spotify Developer application credentials are configured.

#[allow(dead_code)]
pub struct SpotifyClient {
    pub client_id: String,
    pub access_token: Option<String>,
}

#[allow(dead_code)]
impl SpotifyClient {
    pub fn new(client_id: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            access_token: None,
        }
    }

    /// Start the PKCE auth flow.  Opens the system browser and starts a
    /// local HTTP server to capture the auth code redirect.
    pub async fn authorize(&mut self) -> anyhow::Result<()> {
        todo!("Implement PKCE OAuth flow")
    }

    /// Refresh the stored access token.
    pub async fn refresh(&mut self) -> anyhow::Result<()> {
        todo!("Implement token refresh")
    }

    /// Fetch the current playback state from the Spotify Web API.
    pub async fn fetch_playback(&self) -> anyhow::Result<Option<serde_json::Value>> {
        let token = self.access_token.as_deref().ok_or_else(|| {
            anyhow::anyhow!("No access token – call authorize() first")
        })?;

        let client = reqwest::Client::new();
        let res = client
            .get("https://api.spotify.com/v1/me/player/currently-playing")
            .bearer_auth(token)
            .send()
            .await?;

        if res.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }

        let body: serde_json::Value = res.json().await?;
        Ok(Some(body))
    }
}
