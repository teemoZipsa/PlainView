use base64::{engine::general_purpose, Engine as _};
use image::{
    codecs::dds::DdsDecoder, DynamicImage, GenericImageView, ImageBuffer, ImageDecoder,
    ImageFormat, ImageReader,
};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{self, Cursor, Write};
use std::panic::{catch_unwind, UnwindSafe};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering as AtomicOrdering},
    Mutex,
};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
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
    DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMNCRP_ENABLED, DWMWA_BORDER_COLOR,
    DWMWA_COLOR_NONE, DWMWA_NCRENDERING_POLICY,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Controls::MARGINS;
#[cfg(windows)]
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SHObjectProperties, SHOpenWithDialog, SetWindowSubclass,
    ShellExecuteExW, OAIF_EXEC, OPENASINFO, SEE_MASK_FLAG_NO_UI, SHELLEXECUTEINFOW, SHOP_FILEPATH,
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
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
const BORDERLESS_SUBCLASS_ID: usize = 0x5056_4E43;
#[cfg(windows)]
const HRESULT_ERROR_CANCELLED: i32 = 0x8007_04C7u32 as i32;

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
fn enable_native_window_shadow(hwnd: HWND) -> Result<(), String> {
    let rendering_policy = DWMNCRP_ENABLED;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY as u32,
            std::ptr::addr_of!(rendering_policy).cast(),
            std::mem::size_of_val(&rendering_policy) as u32,
        )
    };

    if result >= 0 {
        Ok(())
    } else {
        Err(format!(
            "Could not enable native non-client rendering (HRESULT 0x{:08X})",
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
fn refresh_native_window_frame(hwnd: HWND) -> Result<(), String> {
    enable_native_window_shadow(hwnd)?;
    hide_native_window_border(hwnd)?;
    extend_shadow_frame_into_client_area(hwnd)
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
    let is_maximized = unsafe { IsZoomed(hwnd) != 0 };

    if let Some(result) = full_client_area_result(message, wparam, is_maximized) {
        return result;
    }

    if message == WM_DWMCOMPOSITIONCHANGED {
        let _ = refresh_native_window_frame(hwnd);
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
    refresh_native_window_frame(hwnd)?;

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

fn default_locale() -> String {
    "system".to_string()
}

fn default_overlay_hide_delay_ms() -> u32 {
    2000
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
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_overlay_hide_delay_ms")]
    pub overlay_hide_delay_ms: u32,
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

fn clamp_window_bounds_to_screen(bounds: WindowBounds, screen: ScreenRect) -> WindowBounds {
    let screen_left = i64::from(screen.x);
    let screen_top = i64::from(screen.y);
    let screen_right = screen_left + i64::from(screen.width);
    let screen_bottom = screen_top + i64::from(screen.height);
    let window_width = i64::from(bounds.width);
    let window_height = i64::from(bounds.height);

    let x = if window_width >= i64::from(screen.width) {
        screen_left
    } else {
        i64::from(bounds.x).clamp(screen_left, screen_right - window_width)
    };
    let y = if window_height >= i64::from(screen.height) {
        screen_top
    } else {
        i64::from(bounds.y).clamp(screen_top, screen_bottom - window_height)
    };

    WindowBounds {
        x: x as i32,
        y: y as i32,
        ..bounds
    }
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
            locale: default_locale(),
            overlay_hide_delay_ms: default_overlay_hide_delay_ms(),
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
    pub modified_time_ns: String,
    pub original_extension: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    pub file_size: u64,
    pub modified_time_ns: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FolderChangePayload {
    folder: String,
    paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardFormatStatus {
    image_available: bool,
    file_available: bool,
}

struct ActiveFolderWatcher {
    folder: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
struct FolderWatcherState {
    active: Mutex<Option<ActiveFolderWatcher>>,
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

fn folder_watch_target(file_path: &str) -> Result<PathBuf, CommandError> {
    let file = PathBuf::from(file_path);
    let parent = file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            command_error(
                "parent_folder_not_found",
                "Could not find the image folder.",
            )
        })?;

    if !parent.is_dir() {
        return Err(command_error(
            "invalid_folder",
            "The image folder does not exist.",
        ));
    }

    fs::canonicalize(parent).map_err(|error| io_error_to_command("folder_read_failed", error))
}

fn is_relevant_folder_event(event: &Event) -> bool {
    !matches!(event.kind, EventKind::Access(_))
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
fn shell_error_from_code(code: u32, fallback_message: &str) -> CommandError {
    match code {
        ERROR_FILE_NOT_FOUND => command_error("file_not_found", "File not found."),
        ERROR_PATH_NOT_FOUND => command_error("file_not_found", "File path not found."),
        ERROR_ACCESS_DENIED => command_error("access_denied", "Permission denied."),
        ERROR_NO_ASSOCIATION => command_error("no_association", "No default app is associated."),
        _ => command_error(
            "open_failed",
            format!("{} Error code: {}", fallback_message, code),
        ),
    }
}

#[cfg(windows)]
fn shell_execute_target(
    target: &std::ffi::OsStr,
    verb: Option<&str>,
    directory: Option<&Path>,
    fallback_message: &str,
) -> Result<(), CommandError> {
    let file_wide = to_wide_null(target);
    let verb_wide = verb.map(|value| to_wide_null(std::ffi::OsStr::new(value)));
    let directory_wide = directory.map(|value| to_wide_null(value.as_os_str()));

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
    Err(shell_error_from_code(code, fallback_message))
}

#[cfg(windows)]
fn shell_execute(path: &Path, verb: Option<&str>) -> Result<(), CommandError> {
    shell_execute_target(
        path.as_os_str(),
        verb,
        path.parent(),
        "Could not launch the default app.",
    )
}

#[cfg(windows)]
fn open_with_shell_execute(path: &Path) -> Result<(), CommandError> {
    shell_execute(path, None)
}

#[cfg(windows)]
fn clipboard_has_image_format() -> bool {
    let has_png = clipboard_win::register_format("PNG")
        .map(|format| clipboard_win::raw::is_format_avail(format.get()))
        .unwrap_or(false);

    has_png
        || clipboard_win::raw::is_format_avail(clipboard_win::formats::CF_DIBV5)
        || clipboard_win::raw::is_format_avail(clipboard_win::formats::CF_DIB)
        || clipboard_win::raw::is_format_avail(clipboard_win::formats::CF_BITMAP)
}

#[cfg(windows)]
fn append_file_path_to_clipboard(path: &Path) -> Result<ClipboardFormatStatus, CommandError> {
    let path_text = path_to_string(path)?;
    let _clipboard = clipboard_win::Clipboard::new_attempts(10).map_err(|error| {
        command_error(
            "file_clipboard_failed",
            format!("Could not open the Windows clipboard: {error}"),
        )
    })?;

    // Image formats are written immediately before this command. Preserve them
    // and add CF_HDROP so each paste target can choose pixels or the file object.
    clipboard_win::raw::set_file_list_with(&[path_text.as_str()], clipboard_win::options::NoClear)
        .map_err(|error| {
            command_error(
                "file_clipboard_failed",
                format!("Could not place the file on the Windows clipboard: {error}"),
            )
        })?;

    // Explorer recognizes CF_HDROP on its own. Preferred DropEffect makes the
    // intended copy operation explicit for shell consumers that inspect it.
    if let Some(format) = clipboard_win::register_format("Preferred DropEffect") {
        let copy_effect = 1u32.to_le_bytes();
        let _ = clipboard_win::raw::set_without_clear(format.get(), &copy_effect);
    }

    Ok(ClipboardFormatStatus {
        image_available: clipboard_has_image_format(),
        file_available: clipboard_win::raw::is_format_avail(clipboard_win::formats::CF_HDROP),
    })
}

#[cfg(not(windows))]
fn append_file_path_to_clipboard(_path: &Path) -> Result<ClipboardFormatStatus, CommandError> {
    Err(command_error(
        "platform_unsupported",
        "Copying a file object is only supported on Windows.",
    ))
}

#[cfg(windows)]
fn open_with_windows_dialog(hwnd: HWND, path: &Path) -> Result<(), CommandError> {
    let file_wide = to_wide_null(path.as_os_str());
    let open_as_info = OPENASINFO {
        pcszFile: file_wide.as_ptr(),
        pcszClass: std::ptr::null(),
        oaifInFlags: OAIF_EXEC,
    };
    let result = unsafe { SHOpenWithDialog(hwnd, std::ptr::addr_of!(open_as_info)) };

    if shell_dialog_result_succeeded(result) {
        Ok(())
    } else {
        Err(command_error(
            "open_with_failed",
            format!(
                "Could not open the Windows Open With dialog (HRESULT 0x{:08X}).",
                result as u32
            ),
        ))
    }
}

#[cfg(windows)]
fn shell_dialog_result_succeeded(result: i32) -> bool {
    result >= 0 || result == HRESULT_ERROR_CANCELLED
}

#[cfg(not(windows))]
fn open_with_windows_dialog(_hwnd: usize, _path: &Path) -> Result<(), CommandError> {
    Err(command_error(
        "platform_unsupported",
        "The Open With dialog is only supported on Windows.",
    ))
}

#[cfg(windows)]
fn show_windows_file_properties(hwnd: HWND, path: &Path) -> Result<(), CommandError> {
    let file_wide = to_wide_null(path.as_os_str());
    let invoked = unsafe {
        SHObjectProperties(
            hwnd,
            SHOP_FILEPATH as u32,
            file_wide.as_ptr(),
            std::ptr::null(),
        )
    };

    if invoked != 0 {
        Ok(())
    } else {
        Err(command_error(
            "properties_failed",
            "Could not open the Windows file properties dialog.",
        ))
    }
}

#[cfg(not(windows))]
fn show_windows_file_properties(_hwnd: usize, _path: &Path) -> Result<(), CommandError> {
    Err(command_error(
        "platform_unsupported",
        "The file properties dialog is only supported on Windows.",
    ))
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

fn temporary_copy_name(target_name: &std::ffi::OsStr) -> OsString {
    let sequence = TEMP_FILE_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
    let mut name = OsString::from(".");
    name.push(target_name);
    name.push(format!(
        ".plainview-{}-{}.tmp",
        std::process::id(),
        sequence
    ));
    name
}

fn remove_staged_file(path: &Path) {
    #[cfg(windows)]
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        if permissions.readonly() {
            // On Windows this only clears FILE_ATTRIBUTE_READONLY. Clippy's
            // cross-platform warning about Unix mode bits does not apply.
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(path, permissions);
        }
    }

    let _ = fs::remove_file(path);
}

/// Copy into a newly-created sibling file so the visible destination remains
/// untouched until the entire payload is present and flushed to disk.
fn stage_file_copy(source: &Path, target: &Path) -> io::Result<PathBuf> {
    let target_parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing target folder."))?;
    let target_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing target file name."))?;
    let mut input = fs::File::open(source)?;
    let source_metadata = input.metadata()?;

    for _ in 0..128 {
        let temporary = target_parent.join(temporary_copy_name(target_name));
        let mut destination = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };

        let copy_result = (|| -> io::Result<()> {
            let copied = io::copy(&mut input, &mut destination)?;
            if copied != source_metadata.len() {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Copied file size differs from the original.",
                ));
            }
            destination.sync_all()?;
            fs::set_permissions(&temporary, source_metadata.permissions())?;
            Ok(())
        })();
        drop(destination);

        if let Err(error) = copy_result {
            remove_staged_file(&temporary);
            return Err(error);
        }

        return Ok(temporary);
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Could not reserve a temporary file name.",
    ))
}

#[cfg(windows)]
fn move_file_without_overwrite(source: &Path, target: &Path) -> io::Result<()> {
    let source_wide = to_wide_null(source.as_os_str());
    let target_wide = to_wide_null(target.as_os_str());
    let success = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };

    if success != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(windows))]
fn move_file_without_overwrite(source: &Path, target: &Path) -> io::Result<()> {
    // Creating the hard link is atomic and fails when the destination exists.
    // Removing the original afterwards gives rename semantics without a
    // check-then-rename overwrite race.
    fs::hard_link(source, target)?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(())
}

fn move_to_unique_target_without_overwrite(
    source: &Path,
    target_folder: &Path,
    file_name: &std::ffi::OsStr,
) -> io::Result<PathBuf> {
    for _ in 0..128 {
        let target = unique_target_path(target_folder, file_name);
        match move_file_without_overwrite(source, &target) {
            Ok(()) => return Ok(target),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Could not reserve a destination file name.",
    ))
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

fn revision_from_metadata(metadata: &fs::Metadata) -> FileRevision {
    let modified_time_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|| "0".to_string());

    FileRevision {
        file_size: metadata.len(),
        modified_time_ns,
    }
}

fn file_revision(path: &Path) -> Result<FileRevision, CommandError> {
    let metadata = fs::metadata(path).map_err(|e| {
        command_error(
            "metadata_failed",
            format!("Could not read file info: {}", e),
        )
    })?;

    if !metadata.is_file() {
        return Err(command_error("file_not_found", "Image file not found."));
    }

    Ok(revision_from_metadata(&metadata))
}

#[tauri::command]
fn get_image_revision(path: String) -> Result<FileRevision, CommandError> {
    file_revision(Path::new(&path))
}

fn encode_png(image: DynamicImage) -> Result<DecodedImage, CommandError> {
    let (width, height) = image.dimensions();
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| command_error("decode_failed", format!("Could not encode PNG: {}", e)))?;

    let data = cursor.into_inner();
    if u64::try_from(data.len()).unwrap_or(u64::MAX) > MAX_DECODED_BYTES {
        return Err(command_error(
            "image_too_large",
            "Converted image is too large to display.",
        ));
    }

    Ok(DecodedImage {
        data,
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

    // The JPEG XL decoder streams from the file itself. Avoid reading a second
    // full copy into memory before opening the decoder.
    if ext == "jxl" {
        return decode_jxl(path);
    }

    if fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        > MAX_DECODED_BYTES
    {
        return Err(command_error(
            "image_too_large",
            "Image file is too large to convert safely.",
        ));
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
        "psd" => decode_psd(&data),
        _ => Err(unsupported_format_error(ext)),
    }
}

/// Read an image file and return render metadata.
fn read_image_sync(path: String) -> Result<ImageData, CommandError> {
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

    let revision = file_revision(&file_path)?;

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
        file_size: revision.file_size,
        modified_time_ns: revision.modified_time_ns,
        original_extension,
        width,
        height,
    })
}

#[tauri::command]
async fn read_image(path: String) -> Result<ImageData, CommandError> {
    tauri::async_runtime::spawn_blocking(move || read_image_sync(path))
        .await
        .map_err(|error| {
            command_error(
                "read_failed",
                format!("Could not finish reading the image: {error}"),
            )
        })?
}

fn natural_case_insensitive_cmp(left: &str, right: &str) -> Ordering {
    let left_folded = left.to_lowercase();
    let right_folded = right.to_lowercase();
    let left_bytes = left_folded.as_bytes();
    let right_bytes = right_folded.as_bytes();
    let mut left_index = 0;
    let mut right_index = 0;

    while left_index < left_bytes.len() && right_index < right_bytes.len() {
        let left_is_digit = left_bytes[left_index].is_ascii_digit();
        let right_is_digit = right_bytes[right_index].is_ascii_digit();

        if left_is_digit && right_is_digit {
            let left_end = left_bytes[left_index..]
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .map(|offset| left_index + offset)
                .unwrap_or(left_bytes.len());
            let right_end = right_bytes[right_index..]
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .map(|offset| right_index + offset)
                .unwrap_or(right_bytes.len());

            let left_digits = &left_bytes[left_index..left_end];
            let right_digits = &right_bytes[right_index..right_end];
            let left_trimmed = {
                let first_non_zero = left_digits
                    .iter()
                    .position(|byte| *byte != b'0')
                    .unwrap_or(left_digits.len().saturating_sub(1));
                &left_digits[first_non_zero..]
            };
            let right_trimmed = {
                let first_non_zero = right_digits
                    .iter()
                    .position(|byte| *byte != b'0')
                    .unwrap_or(right_digits.len().saturating_sub(1));
                &right_digits[first_non_zero..]
            };

            match left_trimmed.len().cmp(&right_trimmed.len()) {
                Ordering::Equal => {}
                order => return order,
            }
            match left_trimmed.cmp(right_trimmed) {
                Ordering::Equal => {}
                order => return order,
            }
            match left_digits.len().cmp(&right_digits.len()) {
                Ordering::Equal => {}
                order => return order,
            }

            left_index = left_end;
            right_index = right_end;
            continue;
        }

        if left_is_digit != right_is_digit {
            return left_bytes[left_index].cmp(&right_bytes[right_index]);
        }

        let left_end = left_bytes[left_index..]
            .iter()
            .position(|byte| byte.is_ascii_digit())
            .map(|offset| left_index + offset)
            .unwrap_or(left_bytes.len());
        let right_end = right_bytes[right_index..]
            .iter()
            .position(|byte| byte.is_ascii_digit())
            .map(|offset| right_index + offset)
            .unwrap_or(right_bytes.len());

        match left_bytes[left_index..left_end].cmp(&right_bytes[right_index..right_end]) {
            Ordering::Equal => {}
            order => return order,
        }

        left_index = left_end;
        right_index = right_end;
    }

    left_bytes
        .len()
        .cmp(&right_bytes.len())
        .then_with(|| left.cmp(right))
}

fn natural_file_path_cmp(left: &str, right: &str) -> Ordering {
    let left_name = Path::new(left)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let right_name = Path::new(right)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");

    natural_case_insensitive_cmp(left_name, right_name)
}

fn scan_folder_images_sync(folder_path: &str) -> Result<Vec<String>, CommandError> {
    let dir = PathBuf::from(folder_path);

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

    images.sort_by(|left, right| natural_file_path_cmp(left, right));

    Ok(images)
}

/// Scan a folder off the application thread so very large directories keep the UI responsive.
#[tauri::command]
async fn scan_folder_images(folder_path: String) -> Result<Vec<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || scan_folder_images_sync(&folder_path))
        .await
        .map_err(|error| {
            command_error(
                "folder_read_failed",
                format!("Could not finish scanning the folder: {error}"),
            )
        })?
}

#[tauri::command]
fn watch_image_folder(
    app: AppHandle,
    state: State<'_, FolderWatcherState>,
    file_path: String,
) -> Result<(), CommandError> {
    let folder = folder_watch_target(&file_path)?;

    {
        let active = state
            .active
            .lock()
            .map_err(|_| command_error("unknown", "The folder watcher is unavailable."))?;
        if active
            .as_ref()
            .is_some_and(|current| current.folder == folder)
        {
            return Ok(());
        }
    }

    let event_folder = path_to_string(&folder)?;
    let app_handle = app.clone();
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<Event>| match result {
            Ok(event) if is_relevant_folder_event(&event) => {
                let paths = event
                    .paths
                    .iter()
                    .filter_map(|path| path.to_str().map(str::to_owned))
                    .collect();
                let payload = FolderChangePayload {
                    folder: event_folder.clone(),
                    paths,
                };
                let _ = app_handle.emit("plainview://folder-changed", payload);
            }
            Ok(_) => {}
            Err(error) => eprintln!("PlainView folder watcher error: {error}"),
        })
        .map_err(|error| {
            command_error(
                "folder_watch_failed",
                format!("Could not create the folder watcher: {error}"),
            )
        })?;

    watcher
        .watch(&folder, RecursiveMode::NonRecursive)
        .map_err(|error| {
            command_error(
                "folder_watch_failed",
                format!("Could not watch the image folder: {error}"),
            )
        })?;

    let mut active = state
        .active
        .lock()
        .map_err(|_| command_error("unknown", "The folder watcher is unavailable."))?;
    *active = Some(ActiveFolderWatcher {
        folder,
        _watcher: watcher,
    });
    Ok(())
}

#[tauri::command]
fn clear_image_folder_watch(state: State<'_, FolderWatcherState>) -> Result<(), CommandError> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| command_error("unknown", "The folder watcher is unavailable."))?;
    *active = None;
    Ok(())
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
        if let Err(error) = refresh_native_window_frame(hwnd.0) {
            eprintln!("{error}");
        }
    }

    Ok(())
}

/// Force-close the window after the frontend has persisted its state.
/// Unlike `close`, `destroy` does not emit another close-request event, so the
/// request cannot be intercepted a second time and leave the viewer stuck.
#[tauri::command]
fn destroy_window(window: WebviewWindow) -> Result<(), CommandError> {
    window.destroy().map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not destroy window: {}", e),
        )
    })
}

/// Resize the window
#[tauri::command]
fn resize_window(window: WebviewWindow, width: f64, height: f64) -> Result<(), CommandError> {
    let target_work_area = window.current_monitor().ok().flatten().map(|monitor| {
        let area = monitor.work_area();
        ScreenRect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        }
    });
    let original_position = window.outer_position().ok();

    let size = tauri::LogicalSize::new(width, height);
    window.set_size(size).map_err(|e| {
        command_error(
            "window_operation_failed",
            format!("Could not resize window: {}", e),
        )
    })?;

    if let (Some(screen), Some(original_position), Ok(resized)) =
        (target_work_area, original_position, window.inner_size())
    {
        let bounds = WindowBounds {
            x: original_position.x,
            y: original_position.y,
            width: resized.width,
            height: resized.height,
        };
        let clamped = clamp_window_bounds_to_screen(bounds, screen);

        if clamped.x != bounds.x || clamped.y != bounds.y {
            if let Err(error) = window.set_position(PhysicalPosition::new(clamped.x, clamped.y)) {
                eprintln!("Could not keep the resized window on-screen: {error}");
            }
        }
    }

    Ok(())
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
fn open_default_apps_settings() -> Result<(), CommandError> {
    #[cfg(windows)]
    {
        shell_execute_target(
            std::ffi::OsStr::new("ms-settings:defaultapps"),
            None,
            None,
            "Could not open Windows Default Apps settings.",
        )
    }

    #[cfg(not(windows))]
    {
        Err(command_error(
            "platform_unsupported",
            "Default Apps settings are only available on Windows.",
        ))
    }
}

#[tauri::command]
fn append_file_to_clipboard(path: String) -> Result<ClipboardFormatStatus, CommandError> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(command_error("file_not_found", "Image file not found."));
    }

    append_file_path_to_clipboard(&file)
}

#[tauri::command]
fn show_open_with_dialog(window: WebviewWindow, path: String) -> Result<(), CommandError> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(command_error("file_not_found", "Image file not found."));
    }

    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| {
            command_error(
                "open_with_failed",
                format!("Could not access the viewer window: {error}"),
            )
        })?;
        open_with_windows_dialog(hwnd.0, &file)
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        open_with_windows_dialog(0, &file)
    }
}

#[tauri::command]
fn show_file_properties(window: WebviewWindow, path: String) -> Result<(), CommandError> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(command_error("file_not_found", "Image file not found."));
    }

    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| {
            command_error(
                "properties_failed",
                format!("Could not access the viewer window: {error}"),
            )
        })?;
        show_windows_file_properties(hwnd.0, &file)
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        show_windows_file_properties(0, &file)
    }
}

fn move_file_to_folder_sync(
    file_path: String,
    target_folder: String,
) -> Result<String, CommandError> {
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
    match move_to_unique_target_without_overwrite(&source, &target_dir_canonical, file_name) {
        Ok(target) => path_to_string(&target),
        Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {
            let staging_target = target_dir_canonical.join(file_name);
            let staged = stage_file_copy(&source, &staging_target)
                .map_err(|e| io_error_to_command("copy_failed", e))?;
            let target = match move_to_unique_target_without_overwrite(
                &staged,
                &target_dir_canonical,
                file_name,
            ) {
                Ok(target) => target,
                Err(error) => {
                    remove_staged_file(&staged);
                    return Err(io_error_to_command("copy_failed", error));
                }
            };

            fs::remove_file(&source)
                .map_err(|e| io_error_to_command("remove_original_failed", e))?;
            path_to_string(&target)
        }
        Err(err) => Err(io_error_to_command("unknown", err)),
    }
}

#[tauri::command]
async fn move_file_to_folder(
    file_path: String,
    target_folder: String,
) -> Result<String, CommandError> {
    tauri::async_runtime::spawn_blocking(move || move_file_to_folder_sync(file_path, target_folder))
        .await
        .map_err(|error| {
            command_error(
                "unknown",
                format!("Could not finish moving the file: {error}"),
            )
        })?
}

fn save_image_as_sync(file_path: String, target_path: String) -> Result<String, CommandError> {
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

    let staged =
        stage_file_copy(&source, &target).map_err(|e| io_error_to_command("save_failed", e))?;
    if let Err(error) = replace_file_atomically(&staged, &target) {
        remove_staged_file(&staged);
        return Err(io_error_to_command("save_failed", error));
    }

    path_to_string(&target)
}

#[tauri::command]
async fn save_image_as(file_path: String, target_path: String) -> Result<String, CommandError> {
    tauri::async_runtime::spawn_blocking(move || save_image_as_sync(file_path, target_path))
        .await
        .map_err(|error| {
            command_error(
                "save_failed",
                format!("Could not finish saving the image: {error}"),
            )
        })?
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

    let mut renames_same_file = false;
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
        renames_same_file = true;
    }

    let rename_result = if renames_same_file {
        // Windows case-only renames resolve both spellings to the same file.
        fs::rename(&source, &target)
    } else {
        move_file_without_overwrite(&source, &target)
    };

    rename_result.map_err(|error| {
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

fn move_file_to_trash_sync(file_path: String) -> Result<(), CommandError> {
    let source = PathBuf::from(&file_path);
    if !source.is_file() {
        return Err(command_error("file_not_found", "File not found."));
    }

    trash::delete(&source).map_err(trash_error_to_command)
}

#[tauri::command]
async fn move_file_to_trash(file_path: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || move_file_to_trash_sync(file_path))
        .await
        .map_err(|error| {
            command_error(
                "trash_failed",
                format!("Could not finish moving the file to the Recycle Bin: {error}"),
            )
        })?
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

/// Get CLI arguments (for file association)
#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FolderWatcherState::default())
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
            get_image_revision,
            scan_folder_images,
            watch_image_folder,
            clear_image_folder_watch,
            get_parent_folder,
            load_settings,
            save_settings,
            set_always_on_top,
            destroy_window,
            resize_window,
            get_restorable_window_bounds,
            restore_window_bounds,
            open_with_default_app,
            open_default_apps_settings,
            append_file_to_clipboard,
            show_open_with_dialog,
            show_file_properties,
            move_file_to_folder,
            save_image_as,
            rename_file,
            move_file_to_trash,
            open_with_custom_app,
            get_cli_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn natural_sort_keeps_numbered_images_in_explorer_order() {
        let mut paths = vec![
            r"C:\images\photo10.png".to_string(),
            r"C:\images\photo2.png".to_string(),
            r"C:\images\photo01.png".to_string(),
            r"C:\images\photo1.png".to_string(),
        ];

        paths.sort_by(|left, right| natural_file_path_cmp(left, right));

        assert_eq!(
            paths,
            vec![
                r"C:\images\photo1.png",
                r"C:\images\photo01.png",
                r"C:\images\photo2.png",
                r"C:\images\photo10.png",
            ]
        );
    }

    #[test]
    fn folder_scan_filters_subfolders_and_naturally_sorts_images() {
        let dir = temp_dir("folder-scan");
        fs::write(dir.join("photo10.png"), b"10").unwrap();
        fs::write(dir.join("photo2.jpg"), b"2").unwrap();
        fs::write(dir.join("notes.txt"), b"skip").unwrap();
        fs::create_dir(dir.join("photo1.png")).unwrap();

        let images = scan_folder_images_sync(&dir.to_string_lossy()).unwrap();
        let names: Vec<_> = images
            .iter()
            .filter_map(|path| Path::new(path).file_name())
            .collect();

        assert_eq!(
            names,
            vec![
                std::ffi::OsStr::new("photo2.jpg"),
                std::ffi::OsStr::new("photo10.png")
            ]
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn folder_watch_uses_the_parent_even_when_the_image_is_missing() {
        let dir = temp_dir("watch-target");
        let missing_image = dir.join("incoming.png");

        let watched = folder_watch_target(&missing_image.to_string_lossy()).unwrap();
        let expected = fs::canonicalize(&dir).unwrap();

        assert_eq!(watched, expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn folder_watch_ignores_access_only_events() {
        let access = Event::new(EventKind::Access(notify::event::AccessKind::Any));
        let modify = Event::new(EventKind::Modify(notify::event::ModifyKind::Any));

        assert!(!is_relevant_folder_event(&access));
        assert!(is_relevant_folder_event(&modify));
    }

    #[test]
    fn file_revision_changes_when_file_size_changes() {
        let dir = temp_dir("revision");
        let path = dir.join("image.png");
        fs::write(&path, b"one").unwrap();
        let before = file_revision(&path).unwrap();

        fs::write(&path, b"longer image bytes").unwrap();
        let after = file_revision(&path).unwrap();

        assert_ne!(before.file_size, after.file_size);
        assert_ne!(before, after);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn file_revision_serializes_nanosecond_time_without_javascript_number_loss() {
        let dir = temp_dir("revision-precision");
        let path = dir.join("image.png");
        fs::write(&path, b"image bytes").unwrap();

        let revision = file_revision(&path).unwrap();
        let serialized = serde_json::to_value(&revision).unwrap();

        assert!(revision.modified_time_ns.parse::<u128>().is_ok());
        assert!(serialized["modifiedTimeNs"].is_string());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn file_revision_rejects_a_directory_with_an_image_extension() {
        let dir = temp_dir("revision-directory");
        let fake_image = dir.join("folder.png");
        fs::create_dir(&fake_image).unwrap();

        let error = file_revision(&fake_image).unwrap_err();

        assert_eq!(error.kind, "file_not_found");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_settings_receive_new_viewer_defaults() {
        let settings: Settings = serde_json::from_str("{}").unwrap();

        assert_eq!(settings.locale, "system");
        assert_eq!(settings.overlay_hide_delay_ms, 2000);
        assert_eq!(settings.default_fit_mode, "auto");
        assert!(settings.loop_navigation);
        assert!(settings.remember_window_position);
    }

    #[cfg(windows)]
    #[test]
    fn native_border_subclass_expands_the_client_area_over_the_frame() {
        assert_eq!(full_client_area_result(WM_NCCALCSIZE, 1, false), Some(0));
        assert_eq!(full_client_area_result(WM_NCCALCSIZE, 0, false), None);
        assert_eq!(full_client_area_result(WM_NCCALCSIZE, 1, true), None);
        assert_eq!(full_client_area_result(WM_NCDESTROY, 1, false), None);
    }

    #[cfg(windows)]
    #[test]
    fn closing_a_shell_dialog_is_not_reported_as_a_failure() {
        assert!(shell_dialog_result_succeeded(0));
        assert!(shell_dialog_result_succeeded(HRESULT_ERROR_CANCELLED));
        assert!(!shell_dialog_result_succeeded(0x8000_4005u32 as i32));
    }

    #[cfg(windows)]
    #[test]
    fn windows_cross_volume_move_error_uses_the_portable_error_kind() {
        assert_eq!(
            io::Error::from_raw_os_error(17).kind(),
            io::ErrorKind::CrossesDevices
        );
    }

    #[test]
    fn resized_window_is_clamped_inside_its_monitor_work_area() {
        let screen = ScreenRect {
            x: 0,
            y: 0,
            width: 5120,
            height: 1392,
        };
        let bounds = WindowBounds {
            x: 3881,
            y: 283,
            width: 2049,
            height: 1281,
        };

        assert_eq!(
            clamp_window_bounds_to_screen(bounds, screen),
            WindowBounds {
                x: 3071,
                y: 111,
                ..bounds
            }
        );
    }

    #[test]
    fn resized_window_keeps_an_already_valid_position() {
        let screen = ScreenRect {
            x: -2560,
            y: 0,
            width: 2560,
            height: 1440,
        };
        let bounds = WindowBounds {
            x: -1800,
            y: 120,
            width: 800,
            height: 600,
        };

        assert_eq!(clamp_window_bounds_to_screen(bounds, screen), bounds);
    }

    #[test]
    fn oversized_window_anchors_to_the_monitor_origin() {
        let screen = ScreenRect {
            x: 5120,
            y: -200,
            width: 1920,
            height: 1080,
        };
        let bounds = WindowBounds {
            x: 6000,
            y: 400,
            width: 2400,
            height: 1200,
        };

        assert_eq!(
            clamp_window_bounds_to_screen(bounds, screen),
            WindowBounds {
                x: 5120,
                y: -200,
                ..bounds
            }
        );
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

        let data = read_image_sync(path.to_string_lossy().to_string()).unwrap();

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

        let error = read_image_sync(path.to_string_lossy().to_string()).unwrap_err();

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
        let saved_path = save_image_as_sync(path_string.clone(), path_string).unwrap();

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

        let saved_path = save_image_as_sync(
            source.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(saved_path, target.to_string_lossy());
        assert_eq!(fs::read(&target).unwrap(), bytes);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_image_as_replaces_an_existing_target_without_exposing_partial_bytes() {
        let dir = temp_dir("save-replace");
        let source = dir.join("source.png");
        let target = dir.join("target.png");
        fs::write(&source, b"new complete image bytes").unwrap();
        fs::write(&target, b"previous target bytes").unwrap();

        save_image_as_sync(
            source.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new complete image bytes");
        assert_eq!(
            fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".plainview-"))
                .count(),
            0
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_staging_leaves_an_existing_target_untouched() {
        let dir = temp_dir("save-stage-failure");
        let missing_source = dir.join("missing.png");
        let target = dir.join("target.png");
        fs::write(&target, b"keep these bytes").unwrap();

        assert!(stage_file_copy(&missing_source, &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"keep these bytes");

        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn staged_cleanup_removes_a_read_only_temporary_file() {
        let dir = temp_dir("staged-cleanup");
        let temporary = dir.join("temporary.tmp");
        fs::write(&temporary, b"temporary").unwrap();
        let mut permissions = fs::metadata(&temporary).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&temporary, permissions).unwrap();

        remove_staged_file(&temporary);

        assert!(!temporary.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn move_chooses_a_unique_name_without_overwriting_an_existing_file() {
        let dir = temp_dir("move-collision");
        let source_dir = dir.join("source");
        let target_dir = dir.join("target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();
        let source = source_dir.join("image.png");
        let existing = target_dir.join("image.png");
        fs::write(&source, b"moving image").unwrap();
        fs::write(&existing, b"existing image").unwrap();

        let moved = move_file_to_folder_sync(
            source.to_string_lossy().to_string(),
            target_dir.to_string_lossy().to_string(),
        )
        .unwrap();
        let moved = PathBuf::from(moved);

        assert_eq!(fs::read(&existing).unwrap(), b"existing image");
        assert_ne!(moved, existing);
        assert_eq!(fs::read(&moved).unwrap(), b"moving image");
        assert!(!source.exists());
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
