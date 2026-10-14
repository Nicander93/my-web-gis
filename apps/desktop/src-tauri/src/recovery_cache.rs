use std::{fs, io, path::{Path, PathBuf}, sync::Mutex};

const ENTRY_BYTES: u64 = 32 * 1024 * 1024;
const TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PROJECTS: usize = 20;
static CACHE_LOCK: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize)]
pub struct Entry {
    key: String,
    text: Option<String>,
    error: Option<String>,
    stamp: String,
}

fn file_stamp(metadata: &fs::Metadata) -> String {
    let nanos = |time: io::Result<std::time::SystemTime>| time.ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_nanos()).unwrap_or(0);
    format!("{}-{}-{}", metadata.len(), nanos(metadata.modified()), nanos(metadata.created()))
}

fn invalid(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, message) }

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 256 && key.len() % 2 == 0 && key.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(windows)]
fn process_lock(root: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    let path = root.join(".cache.lock");
    if path.exists() && fs::symlink_metadata(&path)?.file_type().is_symlink() { return Err(invalid("recovery lock cannot be a symlink")); }
    // The OS releases the handle even after an abrupt exit. Keep the file itself
    // so opening a replacement pathname cannot bypass an existing handle lock.
    fs::OpenOptions::new().read(true).write(true).create(true).share_mode(0).open(path)
}
#[cfg(not(windows))]
fn process_lock(_root: &Path) -> io::Result<()> { Ok(()) }

fn prepare_root(root: &Path) -> io::Result<PathBuf> {
    if root.exists() && fs::symlink_metadata(root)?.file_type().is_symlink() { return Err(invalid("recovery directory cannot be a symlink")); }
    fs::create_dir_all(root)?;
    let root = fs::canonicalize(root)?;
    // Abrupt exits can leave staging files. Remove only this writer's filenames
    // after a day; fresh files may belong to an in-flight write in another process.
    for item in fs::read_dir(&root)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        let Some(middle) = name.strip_prefix(".webgis-save-").and_then(|name| name.strip_suffix(".tmp")) else { continue };
        let parts: Vec<_> = middle.split('-').collect();
        if parts.len() != 3 || parts.iter().any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit())) { continue }
        let metadata = fs::symlink_metadata(item.path())?;
        if metadata.is_file() && !metadata.file_type().is_symlink() && metadata.modified()?.elapsed().unwrap_or_default().as_secs() > 24 * 60 * 60 {
            fs::remove_file(item.path())?;
        }
    }
    Ok(root)
}

fn cache_files(root: &Path) -> io::Result<Vec<(String, PathBuf, u64)>> {
    let mut files = Vec::new();
    for item in fs::read_dir(root)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        let Some(key) = name.strip_suffix(".json") else { continue };
        if !valid_key(key) { continue }
        let metadata = fs::symlink_metadata(item.path())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() { continue }
        files.push((key.to_owned(), item.path(), metadata.len()));
    }
    Ok(files)
}

pub fn list(root: &Path) -> io::Result<Vec<Entry>> {
    let _guard = CACHE_LOCK.lock().map_err(|_| invalid("recovery cache lock failed"))?;
    let root = prepare_root(root)?;
    let _process_guard = process_lock(&root)?;
    Ok(cache_files(&root)?.into_iter().map(|(key, path, bytes)| {
        let stamp = fs::metadata(&path).map(|metadata| file_stamp(&metadata)).unwrap_or_default();
        let read = if bytes > ENTRY_BYTES { Err(invalid("recovery entry exceeds 32 MiB")) } else { fs::read_to_string(path) };
        match read {
            Ok(text) => Entry { key, text: Some(text), error: None, stamp },
            Err(error) => Entry { key, text: None, error: Some(error.to_string()), stamp },
        }
    }).collect())
}

/// This API receives a cache key, never a user-selected project path.
pub fn write(root: &Path, key: &str, content: &str, expected: Option<&str>) -> io::Result<()> {
    if !valid_key(key) { return Err(invalid("invalid recovery key")); }
    if content.len() as u64 > ENTRY_BYTES { return Err(invalid("recovery entry exceeds 32 MiB")); }
    let _guard = CACHE_LOCK.lock().map_err(|_| invalid("recovery cache lock failed"))?;
    let root = prepare_root(root)?;
    let _process_guard = process_lock(&root)?;
    let path = root.join(format!("{key}.json"));
    if path.exists() && fs::symlink_metadata(&path)?.file_type().is_symlink() { return Err(invalid("recovery entry cannot be a symlink")); }
    if path.exists() && fs::metadata(&path)?.len() > ENTRY_BYTES { return Err(invalid("previous recovery entry exceeds size limit; explicit discard required")); }
    let previous = if path.exists() { Some(fs::read_to_string(&path)?) } else { None };
    if previous.as_deref() != expected { return Err(invalid("recovery entry changed; previous draft retained")); }
    let files = cache_files(&root)?;
    let others: Vec<_> = files.iter().filter(|(other, _, _)| other != key).collect();
    let bytes: u64 = others.iter().map(|(_, _, size)| size).sum();
    if others.len() >= MAX_PROJECTS || bytes + content.len() as u64 > TOTAL_BYTES { return Err(invalid("recovery cache capacity exceeded; existing drafts retained")); }
    crate::atomic_file::write_atomic(&path, content.as_bytes())
}

/// Compare under the same lock as writes so stale UI actions preserve newer drafts.
pub fn remove(root: &Path, key: &str, expected: Option<&str>, expected_stamp: Option<&str>) -> io::Result<bool> {
    if !valid_key(key) { return Err(invalid("invalid recovery key")); }
    let _guard = CACHE_LOCK.lock().map_err(|_| invalid("recovery cache lock failed"))?;
    let root = prepare_root(root)?;
    let _process_guard = process_lock(&root)?;
    let path = root.join(format!("{key}.json"));
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err(invalid("invalid recovery entry")); }
    if expected_stamp.is_some_and(|stamp| stamp != file_stamp(&metadata)) || (expected.is_none() && expected_stamp.is_none()) { return Ok(false); }
    let current = if metadata.len() > ENTRY_BYTES { None } else { fs::read_to_string(&path).ok() };
    if current.as_deref() != expected { return Ok(false); }
    fs::remove_file(path)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let base = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            Self(base.join(format!("recovery-test-{}-{stamp}", std::process::id())))
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            if let Ok(path) = fs::canonicalize(&self.0) {
                let base = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
                if path.parent() == Some(base.as_path()) { fs::remove_dir_all(path).unwrap(); }
            }
        }
    }
    #[test]
    #[ignore = "only executed by the abrupt-exit parent test"]
    fn abrupt_exit_child() {
        let root = PathBuf::from(std::env::var("WEBGIS_RECOVERY_TEST_ROOT").unwrap()).canonicalize().unwrap();
        let base = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        assert_eq!(root.parent(), Some(base.as_path()));
        assert!(root.file_name().unwrap().to_string_lossy().starts_with("recovery-test-"));
        write(&root, "61", "complete recovered draft", Some("previous draft")).unwrap();
        std::process::exit(72);
    }
    #[test]
    fn reads_the_committed_draft_after_a_writer_exits_without_unwinding() {
        let directory = Directory::new();
        write(&directory.0, "61", "previous draft", None).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "recovery_cache::tests::abrupt_exit_child"])
            .env("WEBGIS_RECOVERY_TEST_ROOT", &directory.0).output().unwrap();
        assert_eq!(output.status.code(), Some(72), "{}", String::from_utf8_lossy(&output.stderr));
        let entries = list(&directory.0).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text.as_deref(), Some("complete recovered draft"));
        assert_eq!(cache_files(&directory.0).unwrap().len(), 1);
    }
    #[test]
    fn isolates_projects_replaces_atomically_and_preserves_newer_revision() {
        let directory = Directory::new(); let root = &directory.0;
        write(root, "61", "二维草稿", None).unwrap(); write(root, "62", "三维草稿", None).unwrap();
        write(root, "61", "最新二维", Some("二维草稿")).unwrap();
        assert!(write(root, "61", "迟到版本", Some("二维草稿")).is_err());
        assert!(!remove(root, "61", Some("二维草稿"), None).unwrap());
        assert_eq!(list(root).unwrap().len(), 2);
        assert_eq!(fs::read_to_string(root.join("61.json")).unwrap(), "最新二维");
        assert!(remove(root, "61", Some("最新二维"), None).unwrap());
        assert_eq!(fs::read_to_string(root.join("62.json")).unwrap(), "三维草稿");
        assert_eq!(cache_files(root).unwrap().len(), 1);
    }
    #[test]
    fn rejects_paths_and_capacity_without_damaging_existing_cache() {
        let directory = Directory::new(); let root = &directory.0;
        for key in ["../61", "C:/61", "61.json", "a", "FF", ""] { assert!(write(root, key, "x", None).is_err()); }
        assert!(!root.exists());
        for index in 0..MAX_PROJECTS { write(root, &format!("{index:02x}"), "old", None).unwrap(); }
        assert!(write(root, "ffff", "new", None).is_err());
        write(root, "00", "updated", Some("old")).unwrap();
        let large = "x".repeat(ENTRY_BYTES as usize + 1);
        assert!(write(root, "00", &large, Some("updated")).is_err());
        assert_eq!(fs::read_to_string(root.join("00.json")).unwrap(), "updated");
    }
    #[test]
    fn reports_unreadable_entries_and_only_removes_explicitly_selected_cache_files() {
        let directory = Directory::new(); let root = &directory.0;
        write(root, "61", "valid", None).unwrap();
        fs::write(root.join("62.json"), [0xff]).unwrap();
        fs::write(root.join("formal.webgis.json"), "formal").unwrap();
        let entries = list(root).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().find(|entry| entry.key == "62").unwrap().error.is_some());
        assert!(remove(root, "62", None, Some(&entries.iter().find(|entry| entry.key == "62").unwrap().stamp)).unwrap());
        assert!(remove(root, "../formal.webgis", None, None).is_err());
        assert_eq!(fs::read_to_string(root.join("formal.webgis.json")).unwrap(), "formal");
    }
    #[test]
    fn rejects_total_capacity_and_reports_oversized_files_without_reading_them() {
        let directory = Directory::new(); let root = prepare_root(&directory.0).unwrap();
        for index in 0..4 {
            fs::File::create(root.join(format!("{index:02x}.json"))).unwrap().set_len(ENTRY_BYTES).unwrap();
        }
        assert!(write(&root, "ff", "one more byte", None).is_err());
        let large = root.join("00.json"); fs::OpenOptions::new().write(true).open(&large).unwrap().set_len(ENTRY_BYTES + 1).unwrap();
        assert!(write(&root, "00", "replacement", None).is_err());
        let entries = list(&root).unwrap();
        assert!(entries.iter().find(|entry| entry.key == "00").unwrap().text.is_none());
        assert!(remove(&root, "00", None, Some(&entries.iter().find(|entry| entry.key == "00").unwrap().stamp)).unwrap());
        assert_eq!(cache_files(&root).unwrap().len(), 3);
    }
    #[test]
    #[cfg(windows)]
    fn windows_process_lock_preserves_old_content_and_releases_on_handle_close() {
        let directory = Directory::new(); let root = &directory.0;
        write(root, "61", "old", None).unwrap();
        let lock = process_lock(root).unwrap();
        assert!(write(root, "61", "new", Some("old")).is_err());
        assert_eq!(fs::read_to_string(root.join("61.json")).unwrap(), "old");
        drop(lock);
        write(root, "61", "new", Some("old")).unwrap();
        assert_eq!(fs::read_to_string(root.join("61.json")).unwrap(), "new");
    }
    #[test]
    fn stale_discard_of_unreadable_bytes_preserves_a_changed_file() {
        let directory = Directory::new(); let root = prepare_root(&directory.0).unwrap();
        let path = root.join("61.json"); fs::write(&path, [0xff]).unwrap();
        let previous = list(&root).unwrap().remove(0);
        fs::write(&path, [0xfe]).unwrap();
        fs::OpenOptions::new().write(true).open(&path).unwrap().set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(1)).unwrap();
        assert!(!remove(&root, "61", None, Some(&previous.stamp)).unwrap());
        assert_eq!(fs::read(&path).unwrap(), vec![0xfe]);
        let current = list(&root).unwrap().remove(0);
        assert!(remove(&root, "61", None, Some(&current.stamp)).unwrap());
    }
}
