# Licensing and third-party distribution record

WildVision original project code is licensed under **GPL-3.0-only**, as selected by the project owner on 2026-10-21. See the unmodified official GNU GPL version 3 text in LICENSE. This choice does not relicense third-party libraries, fonts, artwork or datasets. Original copyright notices remain applicable.

Source code and build instructions corresponding to each distributed WildVision binary must accompany the release through the published source revision/archive. WildVision application source is published at https://github.com/AImiHoYo/WildVision and its source releases at https://github.com/AImiHoYo/WildVision/releases. This application source does not include the corresponding source of the bundled FFmpeg executable and its linked libraries.

## Included components to inventory in each build

- Python and its runtime libraries: retain their original license material from the exact build environment.
- pywebview and its native bridge dependencies: retain the licenses of the installed versions, including platform-specific components.
- Microsoft Edge WebView2 (Windows only): the offline installer remains under Microsoft's terms, not the WildVision GPL. The build preparation script checks its Microsoft Authenticode signature and records the downloaded version and SHA-256. Redistribution terms and the actual Windows installation flow still require release review. [Official deployment instructions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).
- PyInstaller and its bootloader: retain its license and applicable bootloader exception; it is a packaging tool, not the license for application code.
- React, React DOM, lucide-react, clsx and tailwind-merge: retain notices from the locked frontend packages. Build-time dependencies must also be represented in the source build manifest.
- Inter and JetBrains Mono: original font licenses are kept in `ui/public/fonts/` and are copied by Vite into the application resources.
- imageio-ffmpeg 0.6.0: BSD-2-Clause for the Python wrapper. Its platform wheel also contains an independently licensed FFmpeg executable; the wrapper license does not cover that executable or its linked libraries. [Upstream project](https://github.com/imageio/imageio-ffmpeg).
- The bundled FFmpeg build, its enabled codecs/libraries, exact version, configuration and notices must be inventoried per platform. The macOS arm64 wheel inspected locally contains FFmpeg 7.1 configured with `--enable-gpl`. A different platform wheel must be checked independently.

## Current release gate

This document is an inventory and work record, **not a claim that third-party distribution preparation is complete**. Before public binary distribution, collect the exact shipped licenses/notices and corresponding source/build materials required for that FFmpeg binary and its linked components, as well as the other bundled dependencies. A generic upstream URL or the wrapper's source archive alone is not a substitute for those materials. This remains a release blocker until verified.

The sample video included by `build_desktop_app.py` is generated at build time using FFmpeg testsrc2 and a synthetic tone; the build does not copy the unreviewed local `public/sample_ak.mp4` or real Animal Kingdom videos. Demonstration labels and cached AI results are examples, not model measurements on that synthetic video. Final artwork provenance and third-party/data rights must still be reviewed before publication.
