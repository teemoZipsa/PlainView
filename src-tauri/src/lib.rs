use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};

/// Supported image extensions
const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];

/// Settings structure
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub remember_window_position: bool,
    pub always_on_top_default: bool,
    pub loop_navigation: bool,
    pub background_mode: String,
    pub default_fit_mode: String,
    pub last_window_bounds: Option<WindowBounds>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            remember_window_position: true,
            always_on_top_default: false,
            loop_navigation: true,
            background_mode: "dark".to_string(),
            default_fit_mode: "auto".to_string(),
            last_window_bounds: None,
        }
    }
}

/// Image info returned to frontend
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub base64: String,
    pub mime_type: String,
    pub file_name: String,
    pub file_size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Get settings file path
fn get_settings_path(app: &AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    app_dir.join("settings.json")
}

/// Get mime type from extension
fn get_mime_type(ext: &str) -> &str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

/// Check if a file has a supported image extension
fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Read an image file and return base64 encoded data
#[tauri::command]
fn read_image(path: String) -> Result<ImageData, String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err("파일을 찾을 수 없습니다.".to_string());
    }

    if !is_supported_image(&file_path) {
        return Err("지원하지 않는 파일 형식입니다.".to_string());
    }

    let data = fs::read(&file_path).map_err(|e| format!("파일을 읽을 수 없습니다: {}", e))?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let mime_type = get_mime_type(ext).to_string();

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_size = data.len() as u64;
    let base64_str = general_purpose::STANDARD.encode(&data);

    Ok(ImageData {
        base64: base64_str,
        mime_type,
        file_name,
        file_size,
        width: None,
        height: None,
    })
}

/// Scan a folder for supported image files, sorted by filename ascending
#[tauri::command]
fn scan_folder_images(folder_path: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&folder_path);

    if !dir.is_dir() {
        return Err("유효한 폴더가 아닙니다.".to_string());
    }

    let mut images: Vec<String> = Vec::new();

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("폴더를 읽을 수 없습니다: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_supported_image(&path) {
            if let Some(path_str) = path.to_str() {
                images.push(path_str.to_string());
            }
        }
    }

    // Sort by filename ascending (case-insensitive)
    images.sort_by(|a, b| {
        let name_a = Path::new(a)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        let name_b = Path::new(b)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        name_a.cmp(&name_b)
    });

    Ok(images)
}

/// Get the parent folder of a file path
#[tauri::command]
fn get_parent_folder(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    path.parent()
        .and_then(|p| p.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "상위 폴더를 찾을 수 없습니다.".to_string())
}

/// Load settings from JSON file
#[tauri::command]
fn load_settings(app: AppHandle) -> Settings {
    let path = get_settings_path(&app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<Settings>(&content) {
                return settings;
            }
        }
    }
    Settings::default()
}

/// Save settings to JSON file
#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = get_settings_path(&app);
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("설정 직렬화 오류: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("설정 저장 오류: {}", e))?;
    Ok(())
}

/// Set always-on-top state
#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on_top: bool) -> Result<(), String> {
    window
        .set_always_on_top(on_top)
        .map_err(|e| format!("항상 위 고정 설정 오류: {}", e))
}

/// Resize the window
#[tauri::command]
fn resize_window(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let size = tauri::LogicalSize::new(width, height);
    window
        .set_size(size)
        .map_err(|e| format!("창 크기 변경 오류: {}", e))
}

/// Get CLI arguments (for file association)
#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_image,
            scan_folder_images,
            get_parent_folder,
            load_settings,
            save_settings,
            set_always_on_top,
            resize_window,
            get_cli_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
