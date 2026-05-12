use base64::{engine::general_purpose, Engine as _};
use image::{DynamicImage, GenericImageView, ImageBuffer, ImageDecoder, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::panic::{catch_unwind, UnwindSafe};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, WebviewWindow};

/// Supported image extensions
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "ico", "avif", "heic", "heif",
    "jxl", "psd", "raw", "cr2", "nef", "arw",
];

const UNSUPPORTED_HEIC_EXTENSIONS: &[&str] = &["heic", "heif"];
const UNSUPPORTED_RAW_EXTENSIONS: &[&str] = &["raw", "cr2", "nef", "arw"];
const MAX_DECODED_BYTES: u64 = 512 * 1024 * 1024;

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
    #[serde(default)]
    pub custom_open_apps: Vec<CustomOpenApp>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomOpenApp {
    pub id: String,
    pub name: String,
    pub executable_path: String,
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
            custom_open_apps: Vec::new(),
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

struct DecodedImage {
    data: Vec<u8>,
    mime_type: &'static str,
    width: Option<u32>,
    height: Option<u32>,
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
fn get_mime_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "tif" | "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "jxl" => "image/jxl",
        "psd" => "image/vnd.adobe.photoshop",
        _ => "application/octet-stream",
    }
}

fn unsupported_format_message(ext: &str) -> String {
    if UNSUPPORTED_HEIC_EXTENSIONS.contains(&ext) {
        return "HEIC/HEIF 형식은 현재 버전에서는 지원하지 않습니다.".to_string();
    }

    if UNSUPPORTED_RAW_EXTENSIONS.contains(&ext) {
        return "RAW 카메라 형식은 현재 버전에서는 지원하지 않습니다.".to_string();
    }

    "지원하지 않는 파일 형식입니다.".to_string()
}

/// Check if a file has a supported image extension
fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn encode_png(image: DynamicImage) -> Result<DecodedImage, String> {
    let (width, height) = image.dimensions();
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| format!("이미지를 PNG로 변환할 수 없습니다: {}", e))?;

    Ok(DecodedImage {
        data: cursor.into_inner(),
        mime_type: "image/png",
        width: Some(width),
        height: Some(height),
    })
}

fn catch_decode<F>(format_name: &str, decode: F) -> Result<DecodedImage, String>
where
    F: FnOnce() -> Result<DecodedImage, String> + UnwindSafe,
{
    match catch_unwind(decode) {
        Ok(result) => result,
        Err(_) => Err(format!(
            "{} 디코딩 중 내부 오류가 발생했습니다.",
            format_name
        )),
    }
}

fn image_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    limits
}

fn decode_with_image_crate(
    data: &[u8],
    format: ImageFormat,
    format_name: &str,
) -> Result<DecodedImage, String> {
    catch_decode(format_name, || {
        let mut reader = ImageReader::with_format(Cursor::new(data), format);
        reader.limits(image_limits());

        let image = reader
            .decode()
            .map_err(|e| format!("{} 파일을 디코딩할 수 없습니다: {}", format_name, e))?;

        encode_png(image)
    })
}

fn decode_jxl(path: &Path) -> Result<DecodedImage, String> {
    catch_decode("JPEG XL", || {
        let file = fs::File::open(path).map_err(|e| format!("JXL 파일을 열 수 없습니다: {}", e))?;
        let mut decoder = jxl_oxide::integration::JxlDecoder::new(file)
            .map_err(|e| format!("JXL 파일을 디코딩할 수 없습니다: {}", e))?;
        decoder
            .set_limits(image_limits())
            .map_err(|e| format!("JXL 디코딩 제한을 설정할 수 없습니다: {}", e))?;

        let image = DynamicImage::from_decoder(decoder)
            .map_err(|e| format!("JXL 파일을 디코딩할 수 없습니다: {}", e))?;

        encode_png(image)
    })
}

fn decode_psd(data: &[u8]) -> Result<DecodedImage, String> {
    catch_decode("PSD", || {
        let psd = psd::Psd::from_bytes(data)
            .map_err(|e| format!("PSD 파일을 디코딩할 수 없습니다: {}", e))?;
        let width = psd.width();
        let height = psd.height();
        let decoded_bytes = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "PSD 이미지 크기가 너무 큽니다.".to_string())?;

        if decoded_bytes > MAX_DECODED_BYTES {
            return Err("PSD 이미지가 너무 커서 표시할 수 없습니다.".to_string());
        }

        let rgba = psd.rgba();
        let image = ImageBuffer::from_raw(width, height, rgba)
            .map(DynamicImage::ImageRgba8)
            .ok_or_else(|| "PSD 픽셀 데이터를 이미지로 변환할 수 없습니다.".to_string())?;

        encode_png(image)
    })
}

fn decode_image(path: &Path, ext: &str) -> Result<DecodedImage, String> {
    if UNSUPPORTED_HEIC_EXTENSIONS.contains(&ext) || UNSUPPORTED_RAW_EXTENSIONS.contains(&ext) {
        return Err(unsupported_format_message(ext));
    }

    let data = fs::read(path).map_err(|e| format!("파일을 읽을 수 없습니다: {}", e))?;

    match ext {
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "avif" => Ok(DecodedImage {
            data,
            mime_type: get_mime_type(ext),
            width: None,
            height: None,
        }),
        "tif" | "tiff" => decode_with_image_crate(&data, ImageFormat::Tiff, "TIFF"),
        "ico" => decode_with_image_crate(&data, ImageFormat::Ico, "ICO"),
        "jxl" => decode_jxl(path),
        "psd" => decode_psd(&data),
        _ => Err(unsupported_format_message(ext)),
    }
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

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_else(|| "png".to_string());

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_size = fs::metadata(&file_path)
        .map_err(|e| format!("파일 정보를 읽을 수 없습니다: {}", e))?
        .len();
    let decoded = decode_image(&file_path, &ext)?;
    let base64_str = general_purpose::STANDARD.encode(&decoded.data);

    Ok(ImageData {
        base64: base64_str,
        mime_type: decoded.mime_type.to_string(),
        file_name,
        file_size,
        width: decoded.width,
        height: decoded.height,
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

    let entries = fs::read_dir(&dir).map_err(|e| format!("폴더를 읽을 수 없습니다: {}", e))?;

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
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("설정 직렬화 오류: {}", e))?;
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

#[tauri::command]
fn open_with_custom_app(file_path: String, executable_path: String) -> Result<(), String> {
    let file = PathBuf::from(&file_path);
    if !file.is_file() {
        return Err("이미지 파일을 찾을 수 없습니다.".to_string());
    }

    let executable = PathBuf::from(&executable_path);
    if !executable.is_file() {
        return Err("등록된 앱을 찾을 수 없습니다.".to_string());
    }

    Command::new(&executable)
        .arg(&file)
        .spawn()
        .map_err(|e| format!("앱을 실행할 수 없습니다: {}", e))?;

    Ok(())
}

#[tauri::command]
fn print_file(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err("인쇄할 파일을 찾을 수 없습니다.".to_string());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$ErrorActionPreference='Stop'; Start-Process -FilePath $args[0] -Verb Print",
            ])
            .arg(&file)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("인쇄를 시작할 수 없습니다: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                "인쇄를 시작할 수 없습니다.".to_string()
            } else {
                format!("인쇄를 시작할 수 없습니다: {}", stderr)
            })
        }
    }

    #[cfg(not(windows))]
    {
        Err("이 플랫폼에서는 인쇄를 지원하지 않습니다.".to_string())
    }
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_image,
            scan_folder_images,
            get_parent_folder,
            load_settings,
            save_settings,
            set_always_on_top,
            resize_window,
            open_with_custom_app,
            print_file,
            get_cli_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
