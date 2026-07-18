use base64::{engine::general_purpose, Engine as _};
use image::{
    codecs::dds::DdsDecoder, DynamicImage, GenericImageView, ImageBuffer, ImageDecoder,
    ImageFormat, ImageReader,
};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::io::{Cursor, Write};
use std::panic::{catch_unwind, UnwindSafe};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, E_INVALIDARG,
    HWND, LPARAM, LRESULT, WPARAM,
};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Dwm::{
    DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Controls::MARGINS;
#[cfg(windows)]
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass, ShellExecuteExW, SEE_MASK_FLAG_NO_UI,
    SHELLEXECUTEINFOW,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    IsZoomed, SW_SHOWNORMAL, WM_DWMCOMPOSITIONCHANGED, WM_NCCALCSIZE, WM_NCDESTROY,
};

/// Supported image extensions
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "ico", "avif", "heic", "heif",
    "jxl", "psd", "tga", "dds", "pbm", "pgm", "pnm", "ppm", "pam", "raw", "cr2", "nef", "arw",
];

const UNSUPPORTED_HEIC_EXTENSIONS: &[&str] = &["heic", "heif"];
const UNSUPPORTED_RAW_EXTENSIONS: &[&str] = &["raw", "cr2", "nef", "arw"];
const MAX_DECODED_BYTES: u64 = 512 * 1024 * 1024;
const ERROR_NO_ASSOCIATION: u32 = 1155;
const ERROR_NOT_SAME_DEVICE: i32 = 17;
#[cfg(windows)]
const BORDERLESS_SUBCLASS_ID: usize = 0x5056_4E43;

#[cfg(windows)]
fn hide_native_window_border(hwnd: HWND) -> Result<(), String> {
    let border_color = DWMWA_COLOR_NONE;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR as u32,
            std::ptr::addr_of!(border_color).cast(),
            std::mem::size_of_val(&border_color) as u32,
        )
    };

    if result >= 0 || result == E_INVALIDARG {
        Ok(())
    } else {
        Err(format!(
            "Could not hide the native window border (HRESULT 0x{:08X})",
            result as u32
        ))
    }
}

#[cfg(windows)]
fn extend_shadow_frame_into_client_area(hwnd: HWND) -> Result<(), String> {
    let margins = MARGINS {
        cxLeftWidth: 1,
        cxRightWidth: 1,
        cyTopHeight: 1,
        cyBottomHeight: 1,
    };
    let result = unsafe { DwmExtendFrameIntoClientArea(hwnd, std::ptr::addr_of!(margins)) };

    if result >= 0 {
        Ok(())
    } else {
        Err(format!(
            "Could not enable the native window shadow (HRESULT 0x{:08X})",
            result as u32
        ))
    }
}

#[cfg(windows)]
fn full_client_area_result(message: u32, wparam: WPARAM, is_maximized: bool) -> Option<LRESULT> {
    (message == WM_NCCALCSIZE && wparam != 0 && !is_maximized).then_some(0)
}

#[cfg(windows)]
unsafe extern "system" fn borderless_window_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    if let Some(result) = full_client_area_result(message, wparam, unsafe { IsZoomed(hwnd) != 0 }) {
        return result;
    }

    if message == WM_DWMCOMPOSITIONCHANGED {
        let _ = hide_native_window_border(hwnd);
        let _ = extend_shadow_frame_into_client_area(hwnd);
    }

    if message == WM_NCDESTROY {
        unsafe {
            RemoveWindowSubclass(hwnd, Some(borderless_window_subclass), subclass_id);
        }
    }

    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(windows)]
fn install_native_border_suppression(hwnd: HWND) -> Result<(), String> {
    hide_native_window_border(hwnd)?;
    extend_shadow_frame_into_client_area(hwnd)?;

    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(borderless_window_subclass),
            BORDERLESS_SUBCLASS_ID,
            0,
        )
    };
    if installed == 0 {
        Err(format!(
            "Could not install native border suppression (Windows error {})",
            unsafe { GetLastError() }
        ))
    } else {
        Ok(())
    }
}

fn default_background_mode() -> String {
    "dark".to_string()
}

fn default_fit_mode() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

/// Settings structure
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_true")]
    pub remember_window_position: bool,
    #[serde(default)]
    pub always_on_top_default: bool,
    #[serde(default = "default_true")]
    pub loop_navigation: bool,
    #[serde(default = "default_background_mode")]
    pub background_mode: String,
    #[serde(default = "default_fit_mode")]
    pub default_fit_mode: String,
    #[serde(default)]
    pub last_window_bounds: Option<WindowBounds>,
    #[serde(default)]
    pub custom_open_apps: Vec<CustomOpenApp>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

const MIN_VISIBLE_WINDOW_EDGE: i64 = 48;

fn window_bounds_are_visible(bounds: WindowBounds, screens: &[ScreenRect]) -> bool {
    if bounds.width == 0 || bounds.height == 0 {
        return false;
    }

    let window_left = i64::from(bounds.x);
    let window_top = i64::from(bounds.y);
    let window_right = window_left + i64::from(bounds.width);
    let window_bottom = window_top + i64::from(bounds.height);

    screens.iter().any(|screen| {
        let screen_left = i64::from(screen.x);
        let screen_top = i64::from(screen.y);
        let screen_right = screen_left + i64::from(screen.width);
        let screen_bottom = screen_top + i64::from(screen.height);

        let visible_width = window_right.min(screen_right) - window_left.max(screen_left);
        let visible_height = window_bottom.min(screen_bottom) - window_top.max(screen_top);

        visible_width >= MIN_VISIBLE_WINDOW_EDGE && visible_height >= MIN_VISIBLE_WINDOW_EDGE
    })
}

fn monitor_work_areas(window: &WebviewWindow) -> Result<Vec<ScreenRect>, CommandError> {
    window
        .available_monitors()
        .map(|monitors| {
            monitors
                .into_iter()
                .map(|monitor| {
                    let area = monitor.work_area();
                    ScreenRect {
                        x: area.position.x,
                        y: area.position.y,
                        width: area.size.width,
                        height: area.size.height,
                    }
                })
                .collect()
        })
        .map_err(|e| {
            command_error(
                "window_operation_failed",
                format!("Could not inspect available monitors: {}", e),
            )
        })
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
            background_mode: default_background_mode(),
            default_fit_mode: default_fit_mode(),
            last_window_bounds: None,
            custom_open_apps: Vec::new(),
        }
    }
}

/// Image info returned to frontend
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub source_kind: String,
    pub base64: Option<String>,
    pub mime_type: String,
    pub file_name: String,
    pub file_path: String,
    pub file_size: u64,
    pub original_extension: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: String,
    pub message: String,
}

struct DecodedImage {
    data: Vec<u8>,
    mime_type: &'static str,
    width: Option<u32>,
    height: Option<u32>,
}

fn command_error(kind: &str, message: impl Into<String>) -> CommandError {
    CommandError {
        kind: kind.to_string(),
        message: message.into(),
    }
}

fn path_to_string(path: &Path) -> Result<String, CommandError> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| command_error("unknown", "Could not convert the path to a string."))
}

#[cfg(windows)]
fn to_wide_null(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn shell_error_from_code(code: u32) -> CommandError {
    match code {
        ERROR_FILE_NOT_FOUND => command_error("file_not_found", "File not found."),
        ERROR_PATH_NOT_FOUND => command_error("file_not_found", "File path not found."),
        ERROR_ACCESS_DENIED => command_error("access_denied", "Permission denied."),
        ERROR_NO_ASSOCIATION => command_error("no_association", "No default app is associated."),
        _ => command_error(
            "open_failed",
            format!("Could not launch the default app. Error code: {}", code),
        ),
    }
}

#[cfg(windows)]
fn shell_execute(path: &Path, verb: Option<&str>) -> Result<(), CommandError> {
    let file_wide = to_wide_null(path.as_os_str());
    let verb_wide = verb.map(|value| to_wide_null(std::ffi::OsStr::new(value)));
    let directory_wide = path.parent().map(|parent| to_wide_null(parent.as_os_str()));

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_FLAG_NO_UI,
        hwnd: std::ptr::null_mut(),
        lpVerb: verb_wide
            .as_ref()
            .map(|value| value.as_ptr())
            .unwrap_or(std::ptr::null()),
        lpFile: file_wide.as_ptr(),
        lpParameters: std::ptr::null(),
        lpDirectory: directory_wide
            .as_ref()
            .map(|value| value.as_ptr())
            .unwrap_or(std::ptr::null()),
        nShow: SW_SHOWNORMAL,
        hInstApp: std::ptr::null_mut(),
        lpIDList: std::ptr::null_mut(),
        lpClass: std::ptr::null(),
        hkeyClass: std::ptr::null_mut(),
        dwHotKey: 0,
        Anonymous: Default::default(),
        hProcess: std::ptr::null_mut(),
    };

    let success = unsafe { ShellExecuteExW(&mut info) };
    if success != 0 {
        return Ok(());
    }

    let code = unsafe { GetLastError() };
    Err(shell_error_from_code(code))
}

#[cfg(windows)]
fn open_with_shell_execute(path: &Path) -> Result<(), CommandError> {
    shell_execute(path, None)
}

#[cfg(windows)]
fn print_with_shell_execute(path: &Path) -> Result<(), CommandError> {
    shell_execute(path, Some("print")).map_err(|error| match error.kind.as_str() {
        "file_not_found" | "access_denied" => error,
        _ => command_error("print_failed", error.message),
    })
}

#[cfg(not(windows))]
fn open_with_shell_execute(_path: &Path) -> Result<(), CommandError> {
    Err(command_error(
        "open_failed",
        "Default app fallback is not supported on this platform.",
    ))
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

#[cfg(windows)]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    let source_wide = to_wide_null(source.as_os_str());
    let target_wide = to_wide_null(target.as_os_str());
    let success = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if success != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
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
        "tga" => "image/x-targa",
        "dds" => "image/vnd-ms.dds",
        "pbm" | "pgm" | "pnm" | "ppm" | "pam" => "image/x-portable-anymap",
        _ => "application/octet-stream",
    }
}

fn unsupported_format_error(ext: &str) -> CommandError {
    if UNSUPPORTED_HEIC_EXTENSIONS.contains(&ext) {
        return command_error("unsupported_heic", "HEIC/HEIF files are not supported.");
    }

    if UNSUPPORTED_RAW_EXTENSIONS.contains(&ext) {
        return command_error("unsupported_raw", "RAW camera files are not supported.");
    }

    command_error("unsupported_format", "Unsupported file format.")
}

/// Check if a file has a supported image extension
fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn uses_original_file_source(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
    )
}

fn encode_png(image: DynamicImage) -> Result<DecodedImage, CommandError> {
    let (width, height) = image.dimensions();
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| command_error("decode_failed", format!("Could not encode PNG: {}", e)))?;

    Ok(DecodedImage {
        data: cursor.into_inner(),
        mime_type: "image/png",
        width: Some(width),
        height: Some(height),
    })
}

fn catch_decode<F>(format_name: &str, decode: F) -> Result<DecodedImage, CommandError>
where
    F: FnOnce() -> Result<DecodedImage, CommandError> + UnwindSafe,
{
    match catch_unwind(decode) {
        Ok(result) => result,
        Err(_) => Err(command_error(
            "decode_failed",
            format!("Internal error while decoding {}.", format_name),
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
) -> Result<DecodedImage, CommandError> {
    catch_decode(format_name, || {
        let mut reader = ImageReader::with_format(Cursor::new(data), format);
        reader.limits(image_limits());

        let image = reader.decode().map_err(|e| {
            command_error(
                "decode_failed",
                format!("Could not decode {}: {}", format_name, e),
            )
        })?;

        encode_png(image)
    })
}

fn decode_jxl(path: &Path) -> Result<DecodedImage, CommandError> {
    catch_decode("JPEG XL", || {
        let file = fs::File::open(path)
            .map_err(|e| command_error("read_failed", format!("Could not open JXL: {}", e)))?;
        let mut decoder = jxl_oxide::integration::JxlDecoder::new(file)
            .map_err(|e| command_error("decode_failed", format!("Could not decode JXL: {}", e)))?;
        decoder.set_limits(image_limits()).map_err(|e| {
            command_error("decode_failed", format!("Could not set JXL limits: {}", e))
        })?;

        let image = DynamicImage::from_decoder(decoder)
            .map_err(|e| command_error("decode_failed", format!("Could not decode JXL: {}", e)))?;

        encode_png(image)
    })
}

fn decode_psd(data: &[u8]) -> Result<DecodedImage, CommandError> {
    catch_decode("PSD", || {
        let psd = psd::Psd::from_bytes(data)
            .map_err(|e| command_error("decode_failed", format!("Could not decode PSD: {}", e)))?;
        let width = psd.width();
        let height = psd.height();
        let decoded_bytes = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| command_error("image_too_large", "PSD image is too large."))?;

        if decoded_bytes > MAX_DECODED_BYTES {
            return Err(command_error(
                "image_too_large",
                "PSD image is too large to display.",
            ));
        }

        let rgba = psd.rgba();
        let image = ImageBuffer::from_raw(width, height, rgba)
            .map(DynamicImage::ImageRgba8)
            .ok_or_else(|| command_error("decode_failed", "Could not convert PSD pixels."))?;

        encode_png(image)
    })
}

fn decode_dds(data: &[u8]) -> Result<DecodedImage, CommandError> {
    catch_decode("DDS", || {
        let decoder = DdsDecoder::new(Cursor::new(data))
            .map_err(|e| command_error("decode_failed", format!("Could not decode DDS: {}", e)))?;

        if decoder.total_bytes() > MAX_DECODED_BYTES {
            return Err(command_error(
                "image_too_large",
                "DDS image is too large to display.",
            ));
        }

        let image = DynamicImage::from_decoder(decoder)
            .map_err(|e| command_error("decode_failed", format!("Could not decode DDS: {}", e)))?;

        encode_png(image)
    })
}

fn decode_image(path: &Path, ext: &str) -> Result<DecodedImage, CommandError> {
    if UNSUPPORTED_HEIC_EXTENSIONS.contains(&ext) || UNSUPPORTED_RAW_EXTENSIONS.contains(&ext) {
        return Err(unsupported_format_error(ext));
    }

    let data = fs::read(path)
        .map_err(|e| command_error("read_failed", format!("Could not read the file: {}", e)))?;

    match ext {
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "avif" => Ok(DecodedImage {
            data,
            mime_type: get_mime_type(ext),
            width: None,
            height: None,
        }),
        "tif" | "tiff" => decode_with_image_crate(&data, ImageFormat::Tiff, "TIFF"),
        "ico" => decode_with_image_crate(&data, ImageFormat::Ico, "ICO"),
        "tga" => decode_with_image_crate(&data, ImageFormat::Tga, "TGA"),
        "pbm" | "pgm" | "pnm" | "ppm" | "pam" => {
            decode_with_image_crate(&data, ImageFormat::Pnm, "PNM")
        }
        "dds" => decode_dds(&data),
        "jxl" => decode_jxl(path),
        "psd" => decode_psd(&data),
        _ => Err(unsupported_format_error(ext)),
    }
}

/// Read an image file and return render metadata.
#[tauri::command]
fn read_image(path: String) -> Result<ImageData, CommandError> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(command_error("file_not_found", "File not found."));
    }

    if !is_supported_image(&file_path) {
        return Err(command_error(
            "unsupported_format",
            "Unsupported file format.",
        ));
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
    let original_extension = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let file_size = fs::metadata(&file_path)
        .map_err(|e| {
            command_error(
                "metadata_failed",
                format!("Could not read file info: {}", e),
            )
        })?
        .len();

    let (source_kind, base64, mime_type, width, height) = if uses_original_file_source(&ext) {
        (
            "file".to_string(),
            None,
            get_mime_type(&ext).to_string(),
            None,
            None,
        )
    } else {
        let decoded = decode_image(&file_path, &ext)?;
        (
            "data".to_string(),
            Some(general_purpose::STANDARD.encode(&decoded.data)),
            decoded.mime_type.to_string(),
            decoded.width,
            decoded.height,
        )
    };

    Ok(ImageData {
        source_kind,
        base64,
        mime_type,
        file_name,
        file_path: file_path.to_string_lossy().to_string(),
        file_size,
        original_extension,
        width,
        height,
    })
}

/// Scan a folder for supported image files, sorted by filename ascending
#[tauri::command]
fn scan_folder_images(folder_path: String) -> Result<Vec<String>, CommandError> {
    let dir = PathBuf::from(&folder_path);

    if !dir.is_dir() {
        return Err(command_error(
            "invalid_folder",
            "This is not a valid folder.",
        ));
    }

    let mut images: Vec<String> = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| {
        command_error(
            "folder_read_failed",
            format!("Could not read folder: {}", e),
        )
    })?;

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
fn get_parent_folder(file_path: String) -> Result<String, CommandError> {
    let path = PathBuf::from(&file_path);
    path.parent()
        .and_then(|p| p.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| command_error("parent_folder_not_found", "Could not find parent folder."))
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
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), CommandError> {
    let path = get_settings_path(&app);
    let json = serde_json::to_string_pretty(&settings).map_err(|e| {
        command_error(
            "settings_save_failed",
            format!("Could not serialize settings: {}", e),
        )
    })?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("settings.json");
    let temp_path = path.with_file_name(format!("{}.{}.tmp", file_name, std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        drop(file);
        replace_file_atomically(&temp_path, &path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    write_result.map_err(|e| {
        command_error(
            "settings_save_failed",
            format!("Could not save settings: {}", e),
        )
    })?;
    Ok(())
}

/// Set always-on-top state
#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on_top: bool) -> Result<(), CommandError> {
    window.set_always_on_top(on_top).map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not set always-on-top: {}", e),
        )
    })?;

    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        if let Err(error) = hide_native_window_border(hwnd.0) {
            eprintln!("{error}");
        }
    }

    Ok(())
}

/// Resize the window
#[tauri::command]
fn resize_window(window: WebviewWindow, width: f64, height: f64) -> Result<(), CommandError> {
    let size = tauri::LogicalSize::new(width, height);
    window.set_size(size).map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not resize window: {}", e),
        )
    })
}

/// Return physical-pixel bounds only while the window is in a normal, visible state.
/// Windows reports sentinel coordinates for minimized windows, so those values must
/// never replace the last usable placement.
#[tauri::command]
fn get_restorable_window_bounds(
    window: WebviewWindow,
) -> Result<Option<WindowBounds>, CommandError> {
    let is_minimized = window.is_minimized().map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not inspect minimized state: {}", e),
        )
    })?;
    let is_maximized = window.is_maximized().map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not inspect maximized state: {}", e),
        )
    })?;
    let is_fullscreen = window.is_fullscreen().map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not inspect fullscreen state: {}", e),
        )
    })?;

    if is_minimized || is_maximized || is_fullscreen {
        return Ok(None);
    }

    let position = window.outer_position().map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not read window position: {}", e),
        )
    })?;
    let size = window.inner_size().map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not read window size: {}", e),
        )
    })?;
    let bounds = WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let screens = monitor_work_areas(&window)?;

    if window_bounds_are_visible(bounds, &screens) {
        Ok(Some(bounds))
    } else {
        Ok(None)
    }
}

/// Restore saved physical-pixel bounds only if they still overlap an attached
/// monitor. This also rejects legacy minimized coordinates such as -32768.
#[tauri::command]
fn restore_window_bounds(
    window: WebviewWindow,
    bounds: WindowBounds,
) -> Result<bool, CommandError> {
    let screens = monitor_work_areas(&window)?;
    if !window_bounds_are_visible(bounds, &screens) {
        return Ok(false);
    }

    // Position first so Windows selects the destination monitor's DPI, then
    // restore the exact physical client size captured on that monitor.
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| {
            command_error(
                "window_operation_failed",
                format!("Could not restore window position: {}", e),
            )
        })?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| {
            command_error(
                "window_operation_failed",
                format!("Could not restore window size: {}", e),
            )
        })?;

    Ok(true)
}

fn io_error_to_command(kind: &str, err: std::io::Error) -> CommandError {
    if err.kind() == std::io::ErrorKind::NotFound {
        return command_error("file_not_found", "File not found.");
    }

    if err.kind() == std::io::ErrorKind::PermissionDenied {
        return command_error("access_denied", "Permission denied.");
    }

    command_error(kind, err.to_string())
}

#[cfg(windows)]
fn normalize_windows_error_code(code: i32) -> u32 {
    let code = code as u32;
    if code & 0xFFFF_0000 == 0x8007_0000 {
        code & 0xFFFF
    } else {
        code
    }
}

fn trash_os_error_is_not_found(code: i32) -> bool {
    #[cfg(windows)]
    {
        let code = normalize_windows_error_code(code);
        code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND
    }

    #[cfg(not(windows))]
    {
        let _ = code;
        false
    }
}

fn trash_os_error_is_access_denied(code: i32) -> bool {
    #[cfg(windows)]
    {
        normalize_windows_error_code(code) == ERROR_ACCESS_DENIED
    }

    #[cfg(not(windows))]
    {
        let _ = code;
        false
    }
}

fn trash_error_to_command(err: trash::Error) -> CommandError {
    match &err {
        trash::Error::Os { code, .. } if trash_os_error_is_not_found(*code) => {
            command_error("file_not_found", "File not found.")
        }
        trash::Error::Os { code, .. } if trash_os_error_is_access_denied(*code) => {
            command_error("access_denied", "Permission denied.")
        }
        trash::Error::CouldNotAccess { .. } => command_error("access_denied", "Permission denied."),
        #[cfg(all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        ))]
        trash::Error::FileSystem { source, .. }
            if source.kind() == std::io::ErrorKind::NotFound =>
        {
            command_error("file_not_found", "File not found.")
        }
        #[cfg(all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        ))]
        trash::Error::FileSystem { source, .. }
            if source.kind() == std::io::ErrorKind::PermissionDenied =>
        {
            command_error("access_denied", "Permission denied.")
        }
        _ => command_error(
            "trash_failed",
            format!("Could not move file to trash: {}", err),
        ),
    }
}

fn unique_target_path(target_folder: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let initial = target_folder.join(file_name);
    if !initial.exists() {
        return initial;
    }

    let source_name = Path::new(file_name);
    let stem = source_name
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = source_name.extension().and_then(|value| value.to_str());

    for index in 1.. {
        let candidate_name = match extension {
            Some(ext) if !ext.is_empty() => format!("{} ({}).{}", stem, index, ext),
            _ => format!("{} ({})", stem, index),
        };
        let candidate = target_folder.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unbounded filename generation should always return");
}

#[tauri::command]
fn open_with_default_app(app: AppHandle, path: String) -> Result<(), CommandError> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(command_error("file_not_found", "File not found."));
    }

    let path_string = path_to_string(&file)?;
    if app.opener().open_path(path_string, None::<&str>).is_ok() {
        return Ok(());
    }

    open_with_shell_execute(&file)
}

#[tauri::command]
fn move_file_to_folder(file_path: String, target_folder: String) -> Result<String, CommandError> {
    let source = PathBuf::from(&file_path);
    if !source.is_file() {
        return Err(command_error("file_not_found", "File not found."));
    }

    let target_dir = PathBuf::from(&target_folder);
    if !target_dir.is_dir() {
        return Err(command_error(
            "target_not_folder",
            "Could not find the target folder.",
        ));
    }

    let source_parent = source
        .parent()
        .ok_or_else(|| command_error("parent_folder_not_found", "Could not find parent folder."))?;
    let source_parent_canonical =
        fs::canonicalize(source_parent).map_err(|e| io_error_to_command("unknown", e))?;
    let target_dir_canonical =
        fs::canonicalize(&target_dir).map_err(|e| io_error_to_command("target_not_folder", e))?;

    if source_parent_canonical == target_dir_canonical {
        return Err(command_error(
            "same_folder",
            "The file is already in that folder.",
        ));
    }

    let file_name = source
        .file_name()
        .ok_or_else(|| command_error("file_not_found", "Could not read file name."))?;
    let target = unique_target_path(&target_dir_canonical, file_name);

    match fs::rename(&source, &target) {
        Ok(()) => path_to_string(&target),
        Err(err) if err.raw_os_error() == Some(ERROR_NOT_SAME_DEVICE) => {
            let copied =
                fs::copy(&source, &target).map_err(|e| io_error_to_command("copy_failed", e))?;
            let source_len = fs::metadata(&source)
                .map_err(|e| io_error_to_command("copy_failed", e))?
                .len();

            if copied != source_len {
                let _ = fs::remove_file(&target);
                return Err(command_error(
                    "copy_failed",
                    "Copied file size differs from the original.",
                ));
            }

            fs::remove_file(&source)
                .map_err(|e| io_error_to_command("remove_original_failed", e))?;
            path_to_string(&target)
        }
        Err(err) => Err(io_error_to_command("unknown", err)),
    }
}

#[tauri::command]
fn save_image_as(file_path: String, target_path: String) -> Result<String, CommandError> {
    let source = PathBuf::from(&file_path);
    if !source.is_file() {
        return Err(command_error("file_not_found", "File not found."));
    }

    let target = PathBuf::from(&target_path);
    let target_parent = target
        .parent()
        .ok_or_else(|| command_error("target_not_folder", "Could not find the save folder."))?;
    if !target_parent.is_dir() {
        return Err(command_error(
            "target_not_folder",
            "Could not find the save folder.",
        ));
    }

    // Guard against copying a file onto itself, which would truncate it to 0 bytes.
    let source_canonical =
        fs::canonicalize(&source).map_err(|e| io_error_to_command("unknown", e))?;
    if target.exists() {
        let target_canonical =
            fs::canonicalize(&target).map_err(|e| io_error_to_command("unknown", e))?;
        if source_canonical == target_canonical {
            return path_to_string(&target);
        }
    }

    let copied = fs::copy(&source, &target).map_err(|e| io_error_to_command("save_failed", e))?;
    let source_len = fs::metadata(&source)
        .map_err(|e| io_error_to_command("save_failed", e))?
        .len();

    if copied != source_len {
        let _ = fs::remove_file(&target);
        return Err(command_error(
            "save_failed",
            "Saved file size differs from the original.",
        ));
    }

    path_to_string(&target)
}

fn validate_rename_stem(value: &str) -> Result<&str, CommandError> {
    let trimmed = value.trim();
    let has_invalid_character = trimmed.chars().any(|character| {
        character < '\u{20}'
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    });

    if trimmed.is_empty()
        || trimmed != value
        || trimmed == "."
        || trimmed == ".."
        || trimmed.ends_with('.')
        || has_invalid_character
    {
        return Err(command_error(
            "invalid_file_name",
            "The file name contains invalid characters.",
        ));
    }

    let device_name = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let is_reserved_device = matches!(device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device_name.len() == 4
            && (device_name.starts_with("COM") || device_name.starts_with("LPT"))
            && matches!(device_name.as_bytes()[3], b'1'..=b'9'));

    if is_reserved_device {
        return Err(command_error(
            "invalid_file_name",
            "The file name is reserved by Windows.",
        ));
    }

    Ok(trimmed)
}

#[tauri::command]
fn rename_file(file_path: String, new_name: String) -> Result<String, CommandError> {
    let source = PathBuf::from(&file_path);
    if !source.is_file() {
        return Err(command_error("file_not_found", "File not found."));
    }

    let new_stem = validate_rename_stem(&new_name)?;
    let parent = source
        .parent()
        .ok_or_else(|| command_error("parent_folder_not_found", "Could not find parent folder."))?;

    let mut target_name = OsString::from(new_stem);
    if let Some(extension) = source.extension() {
        target_name.push(".");
        target_name.push(extension);
    }
    let target = parent.join(target_name);

    if target == source {
        return path_to_string(&source);
    }

    if target.exists() {
        let source_canonical = fs::canonicalize(&source)
            .map_err(|error| io_error_to_command("rename_failed", error))?;
        let target_canonical = fs::canonicalize(&target)
            .map_err(|error| io_error_to_command("rename_failed", error))?;

        // A case-only rename points to the same file on Windows and is safe to attempt.
        if source_canonical != target_canonical {
            return Err(command_error(
                "file_already_exists",
                "A file with that name already exists.",
            ));
        }
    }

    fs::rename(&source, &target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            command_error(
                "file_already_exists",
                "A file with that name already exists.",
            )
        } else {
            io_error_to_command("rename_failed", error)
        }
    })?;

    path_to_string(&target)
}

#[tauri::command]
fn move_file_to_trash(file_path: String) -> Result<(), CommandError> {
    let source = PathBuf::from(&file_path);
    if !source.is_file() {
        return Err(command_error("file_not_found", "File not found."));
    }

    trash::delete(&source).map_err(trash_error_to_command)
}

#[tauri::command]
fn open_with_custom_app(file_path: String, executable_path: String) -> Result<(), CommandError> {
    let file = PathBuf::from(&file_path);
    if !file.is_file() {
        return Err(command_error("file_not_found", "Image file not found."));
    }

    let executable = PathBuf::from(&executable_path);
    if !executable.is_file() {
        return Err(command_error(
            "custom_app_not_found",
            "Registered app not found.",
        ));
    }

    Command::new(&executable)
        .arg(&file)
        .spawn()
        .map_err(|e| command_error("open_failed", format!("Could not launch the app: {}", e)))?;

    Ok(())
}

#[tauri::command]
fn print_file(path: String) -> Result<(), CommandError> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(command_error("file_not_found", "File to print not found."));
    }

    #[cfg(windows)]
    {
        print_with_shell_execute(&file)
    }

    #[cfg(not(windows))]
    {
        Err(command_error(
            "print_unsupported",
            "Printing is not supported on this platform.",
        ))
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(hwnd) = window.hwnd() {
                    if let Err(error) = install_native_border_suppression(hwnd.0) {
                        eprintln!("{error}");
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_image,
            scan_folder_images,
            get_parent_folder,
            load_settings,
            save_settings,
            set_always_on_top,
            resize_window,
            get_restorable_window_bounds,
            restore_window_bounds,
            open_with_default_app,
            move_file_to_folder,
            save_image_as,
            rename_file,
            move_file_to_trash,
            open_with_custom_app,
            print_file,
            get_cli_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    #[test]
    fn native_border_subclass_expands_the_client_area_over_the_frame() {
        assert_eq!(full_client_area_result(WM_NCCALCSIZE, 1, false), Some(0));
        assert_eq!(full_client_area_result(WM_NCCALCSIZE, 0, false), None);
        assert_eq!(full_client_area_result(WM_NCCALCSIZE, 1, true), None);
        assert_eq!(full_client_area_result(WM_NCDESTROY, 1, false), None);
    }

    #[test]
    fn minimized_sentinel_bounds_are_not_visible() {
        let screens = [ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];
        let bounds = WindowBounds {
            x: -32768,
            y: -32768,
            width: 800,
            height: 600,
        };

        assert!(!window_bounds_are_visible(bounds, &screens));
    }

    #[test]
    fn window_spanning_adjacent_monitors_is_visible() {
        let screens = [
            ScreenRect {
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
            },
            ScreenRect {
                x: 2560,
                y: 0,
                width: 1920,
                height: 1080,
            },
        ];
        let bounds = WindowBounds {
            x: 2500,
            y: 200,
            width: 500,
            height: 500,
        };

        assert!(window_bounds_are_visible(bounds, &screens));
    }

    #[test]
    fn tiny_offscreen_sliver_is_not_restorable() {
        let screens = [ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];
        let bounds = WindowBounds {
            x: 1900,
            y: 1060,
            width: 800,
            height: 600,
        };

        assert!(!window_bounds_are_visible(bounds, &screens));
    }

    fn temp_dir(test_name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "plainview-{}-{}-{}",
            test_name,
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn native_image_returns_file_source_without_base64() {
        let dir = temp_dir("native-source");
        let path = dir.join("sample.JPG");
        fs::write(&path, b"not decoded in this path").unwrap();

        let data = read_image(path.to_string_lossy().to_string()).unwrap();

        assert_eq!(data.source_kind, "file");
        assert!(data.base64.is_none());
        assert_eq!(data.mime_type, "image/jpeg");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn recognized_unsupported_image_returns_specific_error() {
        let dir = temp_dir("unsupported");
        let path = dir.join("sample.heic");
        fs::write(&path, b"unsupported").unwrap();

        let error = read_image(path.to_string_lossy().to_string()).unwrap_err();

        assert_eq!(error.kind, "unsupported_heic");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_image_as_same_path_preserves_original_file() {
        let dir = temp_dir("save-self");
        let path = dir.join("sample.png");
        let bytes = b"original bytes";
        fs::write(&path, bytes).unwrap();

        let path_string = path.to_string_lossy().to_string();
        let saved_path = save_image_as(path_string.clone(), path_string).unwrap();

        assert_eq!(saved_path, path.to_string_lossy());
        assert_eq!(fs::read(&path).unwrap(), bytes);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_image_as_copies_original_bytes() {
        let dir = temp_dir("save-copy");
        let source = dir.join("source.png");
        let target = dir.join("target.png");
        let bytes = b"source bytes";
        fs::write(&source, bytes).unwrap();

        let saved_path = save_image_as(
            source.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(saved_path, target.to_string_lossy());
        assert_eq!(fs::read(&target).unwrap(), bytes);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_preserves_extension_and_contents() {
        let dir = temp_dir("rename");
        let source = dir.join("source.PNG");
        let bytes = b"source bytes";
        fs::write(&source, bytes).unwrap();

        let renamed_path =
            rename_file(source.to_string_lossy().to_string(), "renamed".into()).unwrap();
        let target = dir.join("renamed.PNG");

        assert_eq!(renamed_path, target.to_string_lossy());
        assert!(!source.exists());
        assert_eq!(fs::read(&target).unwrap(), bytes);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_rejects_existing_target_without_overwriting() {
        let dir = temp_dir("rename-collision");
        let source = dir.join("source.png");
        let target = dir.join("existing.png");
        fs::write(&source, b"source").unwrap();
        fs::write(&target, b"existing").unwrap();

        let error =
            rename_file(source.to_string_lossy().to_string(), "existing".into()).unwrap_err();

        assert_eq!(error.kind, "file_already_exists");
        assert_eq!(fs::read(&source).unwrap(), b"source");
        assert_eq!(fs::read(&target).unwrap(), b"existing");

        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn rename_file_allows_case_only_name_changes() {
        let dir = temp_dir("rename-case");
        let source = dir.join("sample.png");
        fs::write(&source, b"source").unwrap();

        let renamed_path =
            rename_file(source.to_string_lossy().to_string(), "Sample".into()).unwrap();
        let target = dir.join("Sample.png");

        assert_eq!(renamed_path, target.to_string_lossy());
        assert!(target.is_file());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_file_rejects_invalid_or_reserved_names() {
        for name in ["", "bad/name", "trailing.", "CON", "LPT1.notes"] {
            let error = validate_rename_stem(name).unwrap_err();
            assert_eq!(error.kind, "invalid_file_name", "name: {name}");
        }
    }
}
