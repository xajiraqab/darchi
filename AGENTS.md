# AGENTS.md

## Project overview

- **Darchi** is a Windows desktop utility for archiving the user's Desktop contents and restoring files or folders from saved archives.
- It is built with Go and Wails v2. The frontend is plain JavaScript, HTML, and CSS with Vite; do not introduce a frontend framework without a clear project need.
- Go/Wails application setup lives in `main.go`; desktop operations, archive management, settings, and Wails bindings live in `app.go`.
- The frontend UI and interactions live in `frontend/src/main.js`, with visual styles in `frontend/src/style.css` and `frontend/src/app.css`.
- User settings are stored under the user's Windows application data directories. Preserve existing archive and settings compatibility when changing storage behavior.
- Wails project configuration and author metadata live in `wails.json`; Windows installer and executable metadata are under `build/windows/`.

## Design language

- Keep the interface compact, practical, and familiar as a native desktop utility.
- Use the existing dark theme as the default and preserve the selectable light and system themes.
- Reuse the CSS custom properties in `frontend/src/style.css` for backgrounds, surfaces, text, borders, accent, muted text, and shadows. The accent is Windows-style blue (`#0078d4`).
- Prefer restrained surfaces, thin borders, modest corner radii, and clear spacing. Use the blue accent for primary actions and keep secondary actions visually quieter.
- Keep controls and labels concise and readable. Preserve keyboard-friendly inputs, clear confirmation for destructive or consequential actions, and consistent modal/context-menu behavior.
- Avoid adding decorative gradients, unrelated colors, or visual patterns that conflict with the existing understated desktop UI.

## Build and packaging

- The normal development command is `wails dev`; the production build command is `wails build`.
- On Windows, Wails runs the `windows/*` post-build hook configured in `wails.json`. It invokes `scripts/pack-windows.ps1` to compress the produced executable with the repository's `upx-5.2.1-win64/upx.exe` using UPX level 9.
- The hook receives the actual output executable path from Wails as `${bin}`. Keep the hook and script aligned if the output layout or UPX directory changes. A missing UPX executable or failed compression should fail the build rather than silently shipping an unpacked binary.
- UPX packaging applies to Windows builds. Keep non-Windows builds independent of the Windows-only UPX binary.
