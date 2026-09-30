//! CLI probe for live OS keychain round-trips (same service name as Tauri commands).
//! Usage: secure-credential-probe <set|get|delete> <key> [payload]
//! Never logs payload values; `get` writes raw payload bytes to stdout only.

fn main() {
    let mut args = std::env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| {
        eprintln!("usage: secure-credential-probe <set|get|delete> <key> [payload]");
        std::process::exit(1);
    });
    let key = args.next().unwrap_or_else(|| {
        eprintln!("missing key");
        std::process::exit(1);
    });

    match cmd.as_str() {
        "set" => {
            let payload = args.next().unwrap_or_else(|| {
                eprintln!("missing payload");
                std::process::exit(1);
            });
            if let Err(err) = desktop_webgis_lib::os_secure_credential_set(key, payload) {
                eprintln!("set failed: {err}");
                std::process::exit(1);
            }
            print!("OK");
        }
        "get" => match desktop_webgis_lib::os_secure_credential_get(key) {
            Ok(Some(payload)) => {
                print!("{payload}");
            }
            Ok(None) => std::process::exit(2),
            Err(err) => {
                eprintln!("get failed: {err}");
                std::process::exit(1);
            }
        },
        "delete" => {
            if let Err(err) = desktop_webgis_lib::os_secure_credential_delete(key) {
                eprintln!("delete failed: {err}");
                std::process::exit(1);
            }
            print!("OK");
        }
        other => {
            eprintln!("unknown command: {other}");
            std::process::exit(1);
        }
    }
}