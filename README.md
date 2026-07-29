# PlainView

A lightweight, ad-free image viewer for Windows.

[한국어 문서](README.ko.md)

> Open an image and see only the image.
> Move the pointer to an edge to reveal only the controls needed there.

## Language Support

PlainView supports Korean and English UI text. It uses Korean for Korean system/browser locales and English otherwise. For development checks, append `?lang=ko` or `?lang=en` to the local dev URL, or set `localStorage.plainview.locale` to `ko` or `en`.

## Supported Formats

JPG, JPEG, PNG, WebP, GIF, BMP, TIF, TIFF, ICO, AVIF, JXL, PSD, TGA, PBM, PGM, PNM, PPM, PAM, DDS

JPG, JPEG, PNG, WebP, GIF, BMP, and AVIF are rendered through the WebView asset protocol instead of being copied into large base64 strings.
If the installed WebView runtime cannot display AVIF, PlainView shows a clear AVIF-specific error.

PAM support focuses on standard tuple types.
DDS support focuses on DXT1/BC1, DXT3/BC2, and DXT5/BC3 families.
BC4, BC5, BC6H, BC7, other DXGI variants, and general uncompressed DDS files are not supported.

HEIC, HEIF, RAW, CR2, NEF, and ARW extensions are recognized, but the current version shows a clear unsupported-format error when opening them.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Esc` | Close |
| `Ctrl+O` | Open an image |
| `Left Arrow` / `Backspace` | Previous image |
| `Right Arrow` / `Space` | Next image |
| `Home` / `End` | First image / last image |
| `+` | Zoom in |
| `-` | Zoom out |
| `0` | Original size |
| `F` | Fit to screen |
| `T` | Toggle always on top |
| `R` | Rotate 90 degrees clockwise |
| `Ctrl+C` | Copy image contents |
| `Ctrl+Shift+C` | Copy the file object |
| `Ctrl+S` | Save as |
| `Ctrl+M` | Move to another folder |
| `Ctrl+P` | Print |
| `F2` | Rename |
| `Alt+Enter` | File properties |
| `Delete` | Move to Recycle Bin |
| `F5` | Refresh the current folder and image |

## Features

- **Borderless window** - a minimal UI that keeps the image as the main surface
- **Quick image opening** - open from the empty-state button, double-click, `Ctrl+O`, or drag and drop
- **Contextual HUD** - the idle view shows only the image; navigation, window, and view controls appear only at the relevant edge
- **Dynamic action feedback** - image and zoom changes surface briefly, then hide after the configured duration
- **Natural folder navigation** - lists same-folder images in human-friendly `1, 2, 10` order for previous/next navigation
- **Live external changes** - watches the current folder for added, deleted, or replaced files, with focus refresh and `F5` as fallbacks
- **Large-folder responsiveness** - scans and sorts folders in the background and stops obsolete image preloads
- **Zoom controls** - zoom with the mouse wheel, keyboard, or buttons
- **Image panning** - drag to pan while zoomed in
- **Fullscreen** - double-click to fit the image to fullscreen, then double-click again to restore the previous scale
- **Window dragging** - drag the image area in default mode, or use the top handle / Alt-drag while zoomed
- **Context menu** - copy image contents, the file object, or its path; show it in Explorer; open it with the default, Windows-selected, or registered app; save, move, rename, inspect properties, move to Recycle Bin, or print with PlainView's built-in print dialog; supports arrow-key, Tab, and Escape navigation
- **Image content copy** - copy the current image pixels with `Ctrl+C` or the context menu
- **File copy** - copy the current image as a file object with `Ctrl+Shift+C` or the context menu so it can be pasted into File Explorer, mail, and other compatible apps
- **File path copy** - copy the current image's full path from the context menu
- **Save as** - save the original image file with `Ctrl+S` or the context menu
- **Rename** - rename the current image while preserving its file extension
- **Quick file move** - move the current image to another folder with the context menu or `Ctrl+M`
- **Recycle Bin support** - move the current image to the Recycle Bin with the context menu or `Delete`
- **GIF pause** - click a GIF to pause on the current frame, then click again to resume
- **Image info** - hover the bottom info bar to see path, dimensions, file size, and extension
- **Always on top** - keep the image above other windows
- **Rotation and direct zoom input** - view-only 90-degree rotation and numeric zoom entry from the bottom scale label
- **Drag and drop** - open an image by dropping it into the window
- **Recoverable error view** - continue with Retry, Next image, or Show in folder actions
- **Compact settings panel** - configure language, default view, looping, remembered position, and action feedback duration
- **Settings persistence** - automatically saves window position, always-on-top state, and viewing preferences
- **Default Apps helper** - open Windows Default Apps settings directly and explain per-file-type selection
- **Update check** - compare the current version with the latest public GitHub release and open its download page

## Tech Stack

- [Tauri v2](https://tauri.app/) - lightweight desktop app framework
- [React 19](https://react.dev/) + TypeScript
- [Vite](https://vite.dev/) - frontend build tooling

## Development Environment

```text
Rust 1.94+, Node.js 20+, npm 10+
```

## Running Locally

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build

# Build Windows release artifacts: setup, MSI, and portable EXE
npm run release:windows
```

## Current Limitations

- Windows requires users to confirm default-app choices; PlainView can open the relevant Windows settings page directly.
- Update checks contact GitHub only when requested; installation remains a user-initiated download.
- PlainView is view-only and does not include image editing tools.
- GIF support is limited to click-to-pause and click-to-resume. Frame-by-frame navigation is not supported.
- Formats the WebView cannot render directly are converted to PNG and loaded as base64 data, with a 5-image LRU cache for converted results.

## License

MIT
