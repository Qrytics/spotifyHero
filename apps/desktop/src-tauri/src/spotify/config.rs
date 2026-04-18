//! Spotify OAuth app registration. The client ID is public (PKCE); it is safe to ship in-repo.

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
