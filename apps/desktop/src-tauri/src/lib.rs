#[tauri::command]
fn read_text_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_text_path, write_text_path])
        .run(tauri::generate_context!())
        .expect("error while running Desktop WebGIS");
}
