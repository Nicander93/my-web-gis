use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct PendingFile {
    path: PathBuf,
    committed: bool,
}

impl Drop for PendingFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Stage and flush complete bytes beside the destination, then atomically replace it.
/// A failed write/flush/rename never truncates the existing destination.
pub fn write_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    write_with(path, |file| file.write_all(content))
}

fn write_with(path: &Path, writer: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    if path.file_name().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "destination must be a file",
        ));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?
        .as_nanos();
    let mut created = None;
    for _ in 0..32 {
        let temp = parent.join(format!(
            ".webgis-save-{}-{}-{}.tmp",
            std::process::id(),
            stamp,
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => {
                created = Some((
                    file,
                    PendingFile {
                        path: temp,
                        committed: false,
                    },
                ));
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let (mut file, mut pending) = created.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "cannot reserve a temporary file",
        )
    })?;
    let written = writer(&mut file).and_then(|_| file.sync_all());
    // Windows replacement must not depend on an open temporary-file handle.
    drop(file);
    written?;
    fs::rename(&pending.path, path)?;
    // A successful move relinquishes the staging path; never delete a later file at that name.
    pending.committed = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "only executed by the abrupt-exit parent test"]
    fn abrupt_exit_child() {
        let root = PathBuf::from(std::env::var("WEBGIS_ATOMIC_TEST_ROOT").unwrap()).canonicalize().unwrap();
        let base = std::env::current_dir().unwrap().canonicalize().unwrap();
        assert_eq!(root.parent(), Some(base.as_path()));
        assert!(root.file_name().unwrap().to_string_lossy().starts_with(".atomic-write-test-"));
        write_with(&root.join("project.webgis.json"), |file| {
            file.write_all(b"partial replacement")?;
            file.sync_all()?;
            std::process::exit(71);
        }).unwrap();
    }

    #[test]
    fn abrupt_exit_during_staging_keeps_the_old_destination_intact() {
        let directory = TestDirectory::new();
        let target = directory.root.join("project.webgis.json");
        fs::write(&target, "complete previous project").unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "atomic_file::tests::abrupt_exit_child"])
            .env("WEBGIS_ATOMIC_TEST_ROOT", &directory.root).output().unwrap();
        assert_eq!(output.status.code(), Some(71), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(fs::read_to_string(target).unwrap(), "complete previous project");
        assert_eq!(fs::read_dir(&directory.root).unwrap().count(), 2);
    }

    struct TestDirectory {
        root: PathBuf,
        base: PathBuf,
    }
    impl TestDirectory {
        fn new() -> Self {
            let base = std::env::current_dir().unwrap().canonicalize().unwrap();
            let root = base.join(format!(
                ".atomic-write-test-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self { root, base }
        }
        fn destination(&self) -> PathBuf {
            self.root.join("中文项目.webgis.json")
        }
        fn entries(&self) -> usize {
            fs::read_dir(&self.root).unwrap().count()
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            // Only remove this test's verified workspace child, never a computed external path.
            if let Ok(resolved) = self.root.canonicalize() {
                if resolved.parent() == Some(self.base.as_path()) {
                    let _ = fs::remove_dir_all(&resolved);
                }
            }
        }
    }

    #[test]
    fn replaces_complete_utf8_and_binary_content() {
        let directory = TestDirectory::new();
        let path = directory.destination();
        fs::write(&path, "旧数据").unwrap();
        write_atomic(&path, "完整的新项目\n".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "完整的新项目\n");
        write_atomic(&path, &[0, 255, 2, 0]).unwrap();
        assert_eq!(fs::read(&path).unwrap(), [0, 255, 2, 0]);
        assert_eq!(directory.entries(), 1);
    }

    #[test]
    fn partial_staged_write_failure_keeps_the_old_file() {
        let directory = TestDirectory::new();
        let path = directory.destination();
        fs::write(&path, "original").unwrap();
        let failed = write_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::new(
                io::ErrorKind::Other,
                "injected write failure",
            ))
        });
        assert!(failed.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(directory.entries(), 1);
    }

    #[test]
    fn failed_new_file_and_invalid_destination_leave_no_partial_output() {
        let directory = TestDirectory::new();
        let path = directory.destination();
        assert!(write_with(&path, |_| Err(io::Error::new(
            io::ErrorKind::Other,
            "failed"
        )))
        .is_err());
        assert!(!path.exists());
        assert!(write_atomic(&directory.root, b"must not overwrite directory").is_err());
        assert!(directory.root.is_dir());
        assert_eq!(directory.entries(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_file_lock_rejects_replacement_and_keeps_the_existing_bytes() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = TestDirectory::new();
        let path = directory.destination();
        fs::write(&path, b"locked original").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(write_atomic(&path, b"new bytes").is_err());
        drop(lock);
        assert_eq!(fs::read(&path).unwrap(), b"locked original");
        assert_eq!(directory.entries(), 1);
    }
}
