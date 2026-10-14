use std::{collections::HashMap, fs::{self, File}, io::{self, Read, Seek, SeekFrom}, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};
use tauri::http::{Request, Response};

const MAX_RESPONSE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ROOTS: usize = 256;

struct Root { path: PathBuf, active: AtomicBool }
#[derive(Clone, Default)]
pub struct LocalResources { roots: Arc<Mutex<HashMap<String, Arc<Root>>>> }

#[derive(serde::Serialize)]
pub struct Grant { pub key: String, pub url: String, pub directory: String }

fn error(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, message) }

fn random_key() -> io::Result<String> {
    let mut bytes = [0u8; 24];
    #[cfg(windows)] {
        #[link(name = "advapi32")]
        extern "system" { fn SystemFunction036(buffer: *mut std::ffi::c_void, length: u32) -> u8; }
        // RtlGenRandom receives a valid writable buffer and its exact byte count.
        if unsafe { SystemFunction036(bytes.as_mut_ptr().cast(), bytes.len() as u32) } == 0 { return Err(io::Error::last_os_error()); }
    }
    #[cfg(not(windows))] File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn decode_segment(segment: &str) -> io::Result<String> {
    let bytes = segment.as_bytes(); let mut decoded = Vec::with_capacity(bytes.len()); let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = segment.get(index + 1..index + 3).ok_or_else(|| error("invalid percent encoding"))?;
            decoded.push(u8::from_str_radix(pair, 16).map_err(|_| error("invalid percent encoding"))?); index += 3;
        } else { decoded.push(bytes[index]); index += 1; }
    }
    let decoded = String::from_utf8(decoded).map_err(|_| error("resource path must be UTF-8"))?;
    if decoded.is_empty() || decoded == "." || decoded == ".." || decoded.contains(['/', '\\', ':', '\0']) { return Err(error("invalid resource path segment")); }
    Ok(decoded)
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "json" | "geojson" => "application/json; charset=utf-8", "gltf" => "model/gltf+json", "glb" => "model/gltf-binary",
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", "gif" => "image/gif",
        "ktx" => "image/ktx", "ktx2" => "image/ktx2", "svg" => "image/svg+xml", _ => "application/octet-stream",
    }
}

/// Single byte ranges cover Cesium binary loads, including suffix and open-ended requests.
fn byte_range(value: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = value else { return Ok(None) };
    let Some((unit, value)) = value.split_once('=') else { return Ok(None) };
    if !unit.eq_ignore_ascii_case("bytes") || value.contains(',') || size == 0 { return Ok(None); }
    let (start, end) = value.split_once('-').ok_or(())?;
    let digits = |value: &str| -> Result<u64, ()> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) { return Err(()); }
        Ok(value.parse().unwrap_or(u64::MAX))
    };
    if start.is_empty() {
        let count = digits(end)?;
        if count == 0 { return Err(()); }
        return Ok(Some((size.saturating_sub(count), size - 1)));
    }
    let start = digits(start)?;
    if start >= size { return Err(()); }
    let end = if end.is_empty() { size - 1 } else { digits(end)?.min(size - 1) };
    if start > end { return Err(()); }
    Ok(Some((start, end)))
}

fn reply(status: u16, origin: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(status).header("Access-Control-Allow-Origin", origin).header("Vary", "Origin")
        .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").body(body).unwrap()
}

impl LocalResources {
    /// The host grants a selected/project directory. Requests never contain arbitrary absolute paths.
    pub fn grant(&self, directory: &Path) -> io::Result<Grant> {
        let path = fs::canonicalize(directory)?;
        if !path.is_dir() { return Err(error("resource root must be a directory")); }
        let mut roots = self.roots.lock().map_err(|_| error("resource registry unavailable"))?;
        if roots.len() >= MAX_ROOTS { return Err(error("too many active resource directories")); }
        let key = random_key()?;
        let url = if cfg!(windows) { format!("http://webgis-resource.localhost/{key}/") } else { format!("webgis-resource://localhost/{key}/") };
        roots.insert(key.clone(), Arc::new(Root { path: path.clone(), active: AtomicBool::new(true) }));
        Ok(Grant { key, url, directory: path.to_string_lossy().into_owned() })
    }
    pub fn revoke(&self, key: &str) -> io::Result<bool> {
        let mut roots = self.roots.lock().map_err(|_| error("resource registry unavailable"))?;
        if let Some(root) = roots.remove(key) { root.active.store(false, Ordering::Release); return Ok(true); }
        Ok(false)
    }
    pub fn serve(&self, request: &Request<Vec<u8>>, origin: &str) -> Response<Vec<u8>> {
        if request.headers().get("Origin").is_some_and(|value| value.to_str().ok() != Some(origin)) { return reply(403, origin, Vec::new()); }
        if request.method() == "OPTIONS" {
            let mut response = reply(204, origin, Vec::new());
            response.headers_mut().insert("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS".parse().unwrap());
            response.headers_mut().insert("Access-Control-Allow-Headers", "Range, If-Range".parse().unwrap());
            return response;
        }
        if request.method() != "GET" && request.method() != "HEAD" { return reply(405, origin, Vec::new()); }
        let mut parts = request.uri().path().trim_start_matches('/').split('/');
        let key = parts.next().unwrap_or("");
        let root = match self.roots.lock().ok().and_then(|roots| roots.get(key).cloned()) {
            Some(root) => root, None => return reply(403, origin, Vec::new()),
        };
        let mut relative = PathBuf::new();
        for segment in parts {
            match decode_segment(segment) { Ok(segment) => relative.push(segment), Err(_) => return reply(403, origin, Vec::new()) }
        }
        if relative.as_os_str().is_empty() { return reply(403, origin, Vec::new()); }
        let file = match fs::canonicalize(root.path.join(relative)) {
            Ok(file) => file, Err(reason) => return reply(if reason.kind() == io::ErrorKind::NotFound { 404 } else { 403 }, origin, Vec::new()),
        };
        if !root.active.load(Ordering::Acquire) || !file.starts_with(&root.path) || !file.is_file() { return reply(403, origin, Vec::new()); }
        let mut reader = match File::open(&file) { Ok(reader) => reader, Err(_) => return reply(403, origin, Vec::new()) };
        let size = match reader.metadata() { Ok(metadata) => metadata.len(), Err(_) => return reply(500, origin, Vec::new()) };
        // If-Range without a matching validator is a complete representation request.
        let range = if request.method() != "GET" || request.headers().contains_key("If-Range") { None } else { request.headers().get("Range") };
        let selected = match byte_range(range.and_then(|value| value.to_str().ok()), size) {
            Ok(selected) => selected,
            Err(()) => { let mut response = reply(416, origin, Vec::new()); response.headers_mut().insert("Content-Range", format!("bytes */{size}").parse().unwrap()); return response; }
        };
        let (start, length) = selected.map(|(start, end)| (start, end - start + 1)).unwrap_or((0, size));
        if length > MAX_RESPONSE_BYTES { return reply(413, origin, Vec::new()); }
        let mut body = Vec::new();
        if request.method() != "HEAD" {
            if reader.seek(SeekFrom::Start(start)).is_err() { return reply(500, origin, Vec::new()); }
            body.resize(length as usize, 0);
            for chunk in body.chunks_mut(1024 * 1024) {
                if !root.active.load(Ordering::Acquire) { return reply(403, origin, Vec::new()); }
                if reader.read_exact(chunk).is_err() { return reply(500, origin, Vec::new()); }
            }
        }
        let mut response = reply(if selected.is_some() { 206 } else { 200 }, origin, body);
        let headers = response.headers_mut();
        headers.insert("Content-Type", content_type(&file).parse().unwrap());
        headers.insert("Content-Length", length.to_string().parse().unwrap());
        headers.insert("Accept-Ranges", "bytes".parse().unwrap());
        headers.insert("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges".parse().unwrap());
        if let Some((start, end)) = selected { headers.insert("Content-Range", format!("bytes {start}-{end}/{size}").parse().unwrap()); }
        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ORIGIN: &str = "http://127.0.0.1:5173";
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let cwd = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = cwd.join(format!(".native-resources-test-{}-{stamp}", std::process::id()));
            fs::create_dir(&path).unwrap(); Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let resolved = fs::canonicalize(&self.0).unwrap();
            let cwd = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
            if resolved.parent() == Some(cwd.as_path()) { fs::remove_dir_all(resolved).unwrap(); }
        }
    }
    fn request(key: &str, path: &str, range: Option<&str>, method: &str) -> Request<Vec<u8>> {
        let mut builder = Request::builder().uri(format!("http://webgis-resource.localhost/{key}/{path}")).method(method).header("Origin", ORIGIN);
        if let Some(range) = range { builder = builder.header("Range", range); }
        builder.body(Vec::new()).unwrap()
    }
    #[test]
    fn serves_nested_dependencies_utf8_names_mime_and_revokes_only_the_selected_root() {
        let directory = Directory::new(); fs::create_dir(directory.0.join("nested")).unwrap();
        fs::write(directory.0.join("nested").join("模型.glb"), b"glTF1234").unwrap();
        fs::write(directory.0.join("tileset.json"), r#"{"root":{"content":{"uri":"nested/模型.glb"}}}"#.as_bytes()).unwrap();
        let resources = LocalResources::default(); let first = resources.grant(&directory.0).unwrap(); let second = resources.grant(&directory.0).unwrap();
        assert_ne!(first.key, second.key); assert!(first.url.ends_with('/')); assert_eq!(first.key.len(), 48);
        let response = resources.serve(&request(&first.key, "nested/%E6%A8%A1%E5%9E%8B.glb", None, "GET"), ORIGIN);
        assert_eq!(response.status(), 200); assert_eq!(response.body(), b"glTF1234"); assert_eq!(response.headers()["Content-Type"], "model/gltf-binary");
        assert_eq!(resources.serve(&request(&first.key, "tileset.json", None, "GET"), ORIGIN).headers()["Content-Type"], "application/json; charset=utf-8");
        assert!(resources.revoke(&first.key).unwrap());
        assert_eq!(resources.serve(&request(&first.key, "tileset.json", None, "GET"), ORIGIN).status(), 403);
        assert_eq!(resources.serve(&request(&second.key, "tileset.json", None, "GET"), ORIGIN).status(), 200);
    }
    #[test]
    fn supports_bounded_open_ended_suffix_and_head_ranges_without_partial_errors() {
        let directory = Directory::new(); fs::write(directory.0.join("mesh.bin"), b"0123456789").unwrap();
        let resources = LocalResources::default(); let grant = resources.grant(&directory.0).unwrap();
        for (range, expected, content_range) in [("bytes=2-4", "234", "bytes 2-4/10"), ("bytes=8-", "89", "bytes 8-9/10"), ("bytes=-3", "789", "bytes 7-9/10"), ("bytes=8-500", "89", "bytes 8-9/10"), ("BYTES=8-184467440737095516160", "89", "bytes 8-9/10")] {
            let response = resources.serve(&request(&grant.key, "mesh.bin", Some(range), "GET"), ORIGIN);
            assert_eq!(response.status(), 206); assert_eq!(response.body(), expected.as_bytes()); assert_eq!(response.headers()["Content-Range"], content_range);
        }
        for range in ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=+1-2", "bytes=18446744073709551616-"] {
            let response = resources.serve(&request(&grant.key, "mesh.bin", Some(range), "GET"), ORIGIN);
            assert_eq!(response.status(), 416); assert_eq!(response.headers()["Content-Range"], "bytes */10"); assert!(response.body().is_empty());
        }
        let response = resources.serve(&request(&grant.key, "mesh.bin", Some("bytes=2-4"), "HEAD"), ORIGIN);
        assert_eq!(response.status(), 200); assert!(response.body().is_empty()); assert_eq!(response.headers()["Content-Length"], "10");
        for range in ["bytes=0-1,3-4", "wrong", "unknown=0-2"] {
            let response = resources.serve(&request(&grant.key, "mesh.bin", Some(range), "GET"), ORIGIN);
            assert_eq!(response.status(), 200); assert_eq!(response.body(), b"0123456789");
        }
        let mut conditional = request(&grant.key, "mesh.bin", Some("bytes=2-4"), "GET");
        conditional.headers_mut().insert("If-Range", "\"old\"".parse().unwrap());
        assert_eq!(resources.serve(&conditional, ORIGIN).status(), 200);
    }
    #[test]
    fn rejects_ungranted_origins_traversal_encoded_separators_and_unknown_tokens() {
        let directory = Directory::new(); fs::write(directory.0.join("mesh.glb"), b"content").unwrap();
        let resources = LocalResources::default(); let grant = resources.grant(&directory.0).unwrap();
        for path in ["../mesh.glb", "%2e%2e/mesh.glb", "%2fmesh.glb", "C%3A/mesh.glb", "%5cmesh.glb", "%00", "%ff", "bad%", ""] {
            assert_eq!(resources.serve(&request(&grant.key, path, None, "GET"), ORIGIN).status(), 403);
        }
        assert_eq!(resources.serve(&request("unknown", "mesh.glb", None, "GET"), ORIGIN).status(), 403);
        let mut foreign = request(&grant.key, "mesh.glb", None, "GET"); foreign.headers_mut().insert("Origin", "https://untrusted.test".parse().unwrap());
        assert_eq!(resources.serve(&foreign, ORIGIN).status(), 403);
        assert_eq!(resources.serve(&request(&grant.key, "mesh.glb", None, "POST"), ORIGIN).status(), 405);
        assert_eq!(resources.serve(&request(&grant.key, "missing.glb", None, "GET"), ORIGIN).status(), 404);
    }
    #[test]
    fn serves_small_ranges_of_large_files_but_bounds_complete_responses() {
        let directory = Directory::new(); let file = directory.0.join("large.bin"); File::create(&file).unwrap().set_len(MAX_RESPONSE_BYTES + 1).unwrap();
        let resources = LocalResources::default(); let grant = resources.grant(&directory.0).unwrap();
        assert_eq!(resources.serve(&request(&grant.key, "large.bin", None, "GET"), ORIGIN).status(), 413);
        let response = resources.serve(&request(&grant.key, "large.bin", Some("bytes=1-4"), "GET"), ORIGIN);
        assert_eq!(response.status(), 206); assert_eq!(response.body(), &[0, 0, 0, 0]);
    }
    #[test]
    fn canonicalizes_links_and_refuses_files_outside_the_authorized_directory() {
        let directory = Directory::new(); let inside = directory.0.join("assets"); let outside = directory.0.join("outside");
        fs::create_dir(&inside).unwrap(); fs::create_dir(&outside).unwrap(); fs::write(outside.join("private.bin"), b"private").unwrap();
        let link = inside.join("linked");
        #[cfg(windows)] {
            assert!(link.starts_with(&directory.0) && outside.starts_with(&directory.0));
            let status = std::process::Command::new("rtk").args(["proxy", "cmd", "/c", "mklink", "/J"])
                .arg(&link).arg(&outside).output().unwrap();
            assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));
        }
        #[cfg(not(windows))] std::os::unix::fs::symlink(&outside, &link).unwrap();
        let resources = LocalResources::default(); let grant = resources.grant(&inside).unwrap();
        assert_eq!(resources.serve(&request(&grant.key, "linked/private.bin", None, "GET"), ORIGIN).status(), 403);
        assert_eq!(fs::read(outside.join("private.bin")).unwrap(), b"private");
    }
    #[test]
    fn bounds_grants_and_releases_capacity_after_revocation() {
        let directory = Directory::new(); let resources = LocalResources::default(); let mut grants = Vec::new();
        for _ in 0..MAX_ROOTS { grants.push(resources.grant(&directory.0).unwrap()); }
        assert!(resources.grant(&directory.0).is_err());
        resources.revoke(&grants[0].key).unwrap(); assert!(resources.grant(&directory.0).is_ok());
        fs::write(directory.0.join("file.bin"), b"file").unwrap();
        assert!(resources.grant(&directory.0.join("file.bin")).is_err());
    }
}
