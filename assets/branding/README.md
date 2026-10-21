# WildVision application icon

The selected design is the black hand-drawn owl holding a timeline annotation board on a white background (concept v5).

- `wildvision-icon.png`: selected full-resolution image, copied unchanged from the locally archived concept v5.
- `WildVision.icns`: macOS icon with 16, 32, 128, 256 and 512 point sizes, each at 1x and 2x resolution. Created with macOS `sips` and `iconutil`.
- `WildVision.ico`: Windows icon containing 16, 32, 48, 64, 128 and 256 pixel PNG images resized mechanically from the canonical artwork.
- Concept images and generation prompts remain in the local archive and are excluded from the public source tree.

`build_desktop_app.py` passes `WildVision.icns` to PyInstaller on macOS, then synchronizes the built application to `release/WildVision.app`.

The UI's `BrandIcon` component and favicon import `wildvision-icon.png` directly from this directory. Vite bundles the shared source image into `ui/dist/assets`, so the library header, workspace header, import welcome screen, and application icon use the same artwork. The white image background is retained in both light and dark themes.

Earlier concepts are retained for reference.
