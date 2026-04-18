//! PKCE OAuth — browser + `http://127.0.0.1:8888/callback`.

use crate::spotify::config::spotify_client_id;
use crate::spotify::tokens::{load_store, save_tokens};
use crate::spotify::types::TokenResponse;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tokio::sync::oneshot;

pub const REDIRECT_URI: &str = "http://127.0.0.1:8888/callback";
const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const SCOPES: &str = "user-read-playback-state user-read-currently-playing user-modify-playback-state user-read-email user-follow-read";

#[derive(Clone)]
struct OAuthWait {
    expected_state: String,
    sender: Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
}

async fn callback_handler(
    axum::extract::State(wait): axum::extract::State<Arc<OAuthWait>>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> &'static str {
    if let Some(err) = params.get("error") {
        let msg = params
            .get("error_description")
            .cloned()
            .unwrap_or_else(|| err.clone());
        if let Some(tx) = wait.sender.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(Err(format!("Spotify authorization denied: {}", msg)));
        }
        return "You can close this window.";
    }

    let state_ok = params.get("state").map(|s| s.as_str()) == Some(wait.expected_state.as_str());
    if !state_ok {
        if let Some(tx) = wait.sender.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(Err("OAuth state mismatch (try again).".into()));
        }
        return "State mismatch — close this window.";
    }

    let code = params.get("code").cloned().unwrap_or_default();
    if code.is_empty() {
        if let Some(tx) = wait.sender.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(Err("No authorization code returned.".into()));
        }
        return "Missing code.";
    }

    if let Some(tx) = wait.sender.lock().ok().and_then(|mut g| g.take()) {
        let _ = tx.send(Ok(code));
    }

    "spotifyHero connected — you can close this window."
}

fn pkce_verifier() -> String {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

fn random_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

async fn exchange_code(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];

    let res = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed ({}): {}", status, txt));
    }

    res.json::<TokenResponse>().await.map_err(|e| e.to_string())
}

pub async fn run_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let client_id = spotify_client_id();

    let verifier = pkce_verifier();
    let challenge = pkce_challenge(&verifier);
    let state = random_state();

    let auth_url = format!(
        "{}?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}&code_challenge_method=S256&code_challenge={}",
        AUTH_URL,
        urlencoding::encode(client_id.as_str()),
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(SCOPES),
        urlencoding::encode(state.as_str()),
        urlencoding::encode(challenge.as_str()),
    );

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let wait = Arc::new(OAuthWait {
        expected_state: state,
        sender: Arc::new(Mutex::new(Some(tx))),
    });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8888").await.map_err(|e| {
        format!(
            "Could not bind 127.0.0.1:8888 — {}. Free the port or match redirect URI in Spotify dashboard.",
            e
        )
    })?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let app_router = axum::Router::new()
        .route("/callback", axum::routing::get(callback_handler))
        .with_state(wait);

    let serve = tokio::spawn(async move {
        let _ = axum::serve(listener, app_router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    webbrowser::open(&auth_url).map_err(|e| format!("Could not open browser: {}", e))?;

    let code_result = tokio::time::timeout(Duration::from_secs(300), rx)
        .await
        .map_err(|_| "Timed out waiting for Spotify login (5 min).".to_string())?;

    let _ = shutdown_tx.send(());

    tokio::time::sleep(Duration::from_millis(150)).await;
    let _ = serve.await;

    let code_result = code_result.map_err(|_| "Login cancelled.".to_string())?;
    let code = code_result?;

    let http = Client::new();
    let tokens = exchange_code(&http, &client_id, &code, &verifier).await?;

    let store = load_store(&app)?;
    save_tokens(store.as_ref(), &tokens, None)?;

    Ok(())
}
