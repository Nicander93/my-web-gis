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

/// Resolve resources under a user-selected directory, including symlink containment.
#[tauri::command]
fn read_scene_resource(directory: String, path: String) -> Result<Vec<u8>, String> {
    let root = std::fs::canonicalize(directory).map_err(|error| error.to_string())?;
    let relative = std::path::Path::new(&path);
    if path.contains([':', '\\']) || relative.is_absolute() || relative.components().any(|part| !matches!(part, std::path::Component::Normal(_) | std::path::Component::CurDir)) {
        return Err("invalid scene resource path".into());
    }
    let file = std::fs::canonicalize(root.join(relative)).map_err(|error| error.to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("scene resource escapes selected directory".into());
    }
    let metadata = std::fs::metadata(&file).map_err(|error| error.to_string())?;
    if metadata.len() > 512 * 1024 * 1024 {
        return Err("scene resource exceeds byte limit".into());
    }
    std::fs::read(file).map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
struct SceneArchiveFile {
    path: String,
    content: Vec<u8>,
}

/// Writes a validated archive into a new immutable application-owned directory.
fn persist_scene_files(root: &std::path::Path, files: Vec<SceneArchiveFile>) -> Result<String, String> {
    let mut paths = std::collections::HashSet::new();
    let mut total = 0usize;
    if files.len() > 10_000 { return Err("scene archive exceeds file limit".into()); }
    for file in &files {
        let path = std::path::Path::new(&file.path);
        if file.path.is_empty() || file.path.contains([':', '\\']) || path.is_absolute()
            || path.components().any(|part| !matches!(part, std::path::Component::Normal(_)))
            || file.path.split('/').any(|part| part.is_empty() || part.ends_with(['.', ' ']))
            || !paths.insert(file.path.to_lowercase()) {
            return Err("invalid or duplicate scene archive path".into());
        }
        total = total.checked_add(file.content.len()).ok_or("scene archive byte overflow")?;
        if total > 512 * 1024 * 1024 { return Err("scene archive exceeds byte limit".into()); }
    }
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let directory = root.join(format!("{}-{}", std::process::id(), stamp));
    std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let write = || -> Result<(), String> {
        for file in files {
            let path = directory.join(file.path);
            if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            std::fs::write(path, file.content).map_err(|error| error.to_string())?;
        }
        Ok(())
    };
    if let Err(error) = write() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(error);
    }
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn persist_scene_archive(app: tauri::AppHandle, files: Vec<SceneArchiveFile>) -> Result<String, String> {
    use tauri::Manager;
    let root = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("scene-archives");
    persist_scene_files(&root, files)
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
            read_scene_resource,
            persist_scene_archive,
            http_get_text,
            secure_credential_set,
            secure_credential_get,
            secure_credential_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Desktop WebGIS");
}

#[cfg(test)]
mod scene_resource_tests {
    #[test]
    fn persists_nested_files_and_rejects_unsafe_entries_before_writing() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("webgis-archive-{}-{}", std::process::id(), stamp));
        let unsafe_files = vec![super::SceneArchiveFile { path: "../escape".into(), content: vec![1] }];
        assert!(super::persist_scene_files(&root, unsafe_files).is_err());
        assert!(!root.exists());
        let duplicate = vec![super::SceneArchiveFile { path: "Mesh.bin".into(), content: vec![1] }, super::SceneArchiveFile { path: "mesh.bin".into(), content: vec![2] }];
        assert!(super::persist_scene_files(&root, duplicate).is_err());
        assert!(!root.exists());
        let directory = super::persist_scene_files(&root, vec![super::SceneArchiveFile { path: "models/mesh.bin".into(), content: vec![1, 2] }]).unwrap();
        let directory = std::path::PathBuf::from(directory);
        assert!(directory.starts_with(&root));
        assert_eq!(std::fs::read(directory.join("models/mesh.bin")).unwrap(), vec![1, 2]);
        std::fs::remove_file(directory.join("models/mesh.bin")).unwrap();
        std::fs::remove_dir(directory.join("models")).unwrap();
        std::fs::remove_dir(directory).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn reads_only_files_under_selected_directory() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("webgis-scene-{}-{}", std::process::id(), stamp));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("buffer.bin");
        std::fs::write(&file, [1u8, 2, 3]).unwrap();
        let directory = root.to_string_lossy().into_owned();
        assert_eq!(super::read_scene_resource(directory.clone(), "buffer.bin".into()).unwrap(), vec![1, 2, 3]);
        for path in ["../outside.bin", "C:/outside.bin", "buffer.bin:stream", "folder\\buffer.bin"] {
            assert!(super::read_scene_resource(directory.clone(), path.into()).is_err());
        }
        assert!(super::read_scene_resource(directory, "missing.bin".into()).is_err());
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
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
