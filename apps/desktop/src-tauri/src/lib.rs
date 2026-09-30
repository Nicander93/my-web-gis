#[tauri::command]
fn read_text_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_binary_path(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_binary_path(path: String, content: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, content).map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpGetArgs {
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpGetResult {
    status: u16,
    content_type: Option<String>,
    body: String,
}

/// Minimal native HTTP GET for OGC Capabilities when browser CORS blocks.
/// Uses system/reqwest TLS verification — never disables certificate checks,
/// never routes through a public proxy.
#[tauri::command]
async fn http_get_text(args: HttpGetArgs) -> Result<HttpGetResult, String> {
    let timeout = std::time::Duration::from_millis(args.timeout_ms.unwrap_or(15_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?;

    let mut request = client.get(&args.url);
    if let Some(headers) = &args.headers {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(HttpGetResult {
        status,
        content_type,
        body,
    })
}

/// Windows Credential Manager / platform keychain service name (namespaced).
const SECURE_CREDENTIAL_SERVICE: &str = "desktop-webgis";

fn secure_entry(key: &str) -> Result<keyring::Entry, String> {
    if key.is_empty() || key.len() > 256 {
        return Err("invalid credential key".into());
    }
    if key.contains('\0') || key.contains(['\n', '\r']) {
        return Err("invalid credential key".into());
    }
    keyring::Entry::new(SECURE_CREDENTIAL_SERVICE, key).map_err(|error| error.to_string())
}

/// Persist a credential payload (JSON metadata+secret) under the given key.
/// Never log the payload. Public for the live probe binary / tests.
pub fn os_secure_credential_set(key: String, payload: String) -> Result<(), String> {
    if payload.is_empty() || payload.len() > 32_768 {
        return Err("invalid credential payload".into());
    }
    let entry = secure_entry(&key)?;
    entry
        .set_password(&payload)
        .map_err(|error| error.to_string())
}

/// Load a previously stored credential payload, or null when missing.
pub fn os_secure_credential_get(key: String) -> Result<Option<String>, String> {
    let entry = secure_entry(&key)?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Best-effort delete; missing entry is success.
pub fn os_secure_credential_delete(key: String) -> Result<(), String> {
    let entry = secure_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secure_credential_set(key: String, payload: String) -> Result<(), String> {
    os_secure_credential_set(key, payload)
}

#[tauri::command]
fn secure_credential_get(key: String) -> Result<Option<String>, String> {
    os_secure_credential_get(key)
}

#[tauri::command]
fn secure_credential_delete(key: String) -> Result<(), String> {
    os_secure_credential_delete(key)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_path,
            write_text_path,
            read_binary_path,
            write_binary_path,
            http_get_text,
            secure_credential_set,
            secure_credential_get,
            secure_credential_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Desktop WebGIS");
}

#[cfg(test)]
mod secure_credential_live_tests {
    /// Opt-in: set DESKTOP_WEBGIS_LIVE_KEYCHAIN=1 to hit real Windows Credential Manager.
    /// Default CI / cargo test skips (returns early) so no machine keychain side effects.
    #[test]
    fn live_os_keychain_round_trip_and_cleanup() {
        if std::env::var("DESKTOP_WEBGIS_LIVE_KEYCHAIN").as_deref() != Ok("1") {
            eprintln!("skip live keychain: set DESKTOP_WEBGIS_LIVE_KEYCHAIN=1 to run");
            return;
        }
        let key = format!("scene-i-reverify-{}-{}", std::process::id(), "rust");
        let payload = "{\"kind\":\"bearer\",\"value\":\"LIVE-REVERIFY-SECRET-DO-NOT-LOG\"}";
        super::os_secure_credential_set(key.clone(), payload.to_string()).expect("set");
        let got = super::os_secure_credential_get(key.clone()).expect("get");
        assert_eq!(got.as_deref(), Some(payload));
        super::os_secure_credential_delete(key.clone()).expect("delete");
        let after = super::os_secure_credential_get(key).expect("get after delete");
        assert!(after.is_none());
    }
}
