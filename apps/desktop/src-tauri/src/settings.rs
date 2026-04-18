use serde::{Deserialize, Serialize};

/// Persisted application settings (stored via tauri-plugin-store).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub always_on_top: bool,
    pub opacity: f64,
    pub difficulty: String,
    pub autoplay: bool,
    pub play_keybind: String,
    pub lane_keys: [String; 4],
    pub player_name: Option<String>,
    pub spotify_client_id: Option<String>,
    pub supabase_url: Option<String>,
    pub supabase_anon_key: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: true,
            opacity: 0.95,
            difficulty: "medium".into(),
            autoplay: true,
            play_keybind: "Space".into(),
            lane_keys: ["d".into(), "f".into(), "j".into(), "k".into()],
            player_name: None,
            spotify_client_id: None,
            supabase_url: None,
            supabase_anon_key: None,
        }
    }
}
