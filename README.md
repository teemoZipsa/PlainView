# PlainView

A lightweight, ad-free image viewer for Windows.

> Open an image and see only the image.
> Move the mouse to reveal the minimal overlay controls.

## Supported Formats

JPG, JPEG, PNG, WebP, GIF, BMP, TIF, TIFF, ICO, AVIF, JXL, PSD, TGA, PBM, PGM, PNM, PPM, PAM, DDS

PAM support focuses on standard tuple types.
DDS support focuses on DXT1/BC1, DXT3/BC2, and DXT5/BC3 families.
BC4, BC5, BC6H, BC7, other DXGI variants, and general uncompressed DDS files are not supported.

HEIC, HEIF, RAW, CR2, NEF, and ARW extensions are recognized, but the current version shows a clear unsupported-format error when opening them.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Esc` | Close |
| `Left Arrow` / `Backspace` | Previous image |
| `Right Arrow` / `Space` | Next image |
| `+` | Zoom in |
| `-` | Zoom out |
| `0` | Original size |
| `F` | Fit to screen |
| `T` | Toggle always on top |
| `R` | Rotate 90 degrees clockwise |
| `Ctrl+C` | Copy image |
| `Ctrl+S` | Save as |
| `Ctrl+M` | Move to another folder |
| `Delete` | Move to Recycle Bin |

## Features

- **Borderless window** - a minimal UI that keeps the image as the main surface
- **Hover overlay** - translucent controls appear only when needed and auto-hide after 2 seconds
- **Folder navigation** - automatically lists images in the same folder for previous/next navigation
- **Zoom controls** - zoom with the mouse wheel, keyboard, or buttons
- **Image panning** - drag to pan while zoomed in
- **Fullscreen** - double-click to fit the image to fullscreen, then double-click again to restore the previous scale
- **Window dragging** - drag the image area in default mode, or use the top handle / Alt-drag while zoomed
- **Context menu** - show in Explorer, open with default app, save as, register/open custom apps, move to Recycle Bin, print
- **Image copy** - copy the current image to the clipboard with `Ctrl+C` or the context menu
- **Save as** - save the original image file with `Ctrl+S` or the context menu
- **Quick file move** - move the current image to another folder with the context menu or `Ctrl+M`
- **Recycle Bin support** - move the current image to the Recycle Bin with the context menu or `Delete`
- **GIF pause** - click a GIF to pause on the current frame, then click again to resume
- **Image info** - hover the bottom info bar to see path, dimensions, file size, and extension
- **Always on top** - keep the image above other windows
- **Rotation and direct zoom input** - view-only 90-degree rotation and numeric zoom entry from the bottom scale label
- **Drag and drop** - open an image by dropping it into the window
- **Settings persistence** - automatically saves window position, always-on-top state, and related settings

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
```

## Current Limitations

- File association must be configured manually after installation through Windows default app settings.
- PlainView is view-only and does not include image editing tools.
- GIF support is limited to click-to-pause and click-to-resume. Frame-by-frame navigation is not supported.
- Images are loaded as base64 with a 5-image LRU cache.

## License

MIT
