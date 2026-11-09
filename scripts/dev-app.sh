#!/usr/bin/env bash
# Mashahd — robust dev launcher (Pass 106)
#
# Root-cause fix for the recurring Turbopack font-cache crash:
#   `next/font/google` import-map corruption ("queries have exactly one entry")
#   hits the default Turbopack bundler after sandbox recycles. Switching to
#   webpack eliminates the failure mode entirely. The 4 GB heap guard prevents
#   the OOM kills seen on large cold compiles.
#
# Invoked by package.json `dev` / `dev:app` (which run the predev hook:
# verify-protected.sh + ensure-env.sh).
cd "$(dirname "$0")/.."

# Heap guard — default 4 GB unless caller overrides (e.g. CI may raise it).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

# Webpack mode — stable across recycles (Turbopack dev crashes on the
# next/font/google import map after .next is restored from a snapshot).
# Direct redirect (no tee/exec) so backgrounding via nohup/setsid works cleanly.
npx next dev --webpack -p 3000 > dev.log 2>&1
