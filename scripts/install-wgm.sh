#!/usr/bin/env bash
set -euo pipefail

REPO="${WGM_REPO:-alpian9890/wireguard-vps-tunnel}"
VERSION="${WGM_VERSION:-latest}"
ASSET_NAME="${WGM_ASSET_NAME:-wgm-linux-x64}"
INSTALL_PATH="${WGM_INSTALL_PATH:-/usr/local/bin/wgm}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: command '$1' diperlukan." >&2
    exit 1
  }
}

info() {
  echo "[wgm-installer] $*"
}

download() {
  local url="$1"
  local out="$2"

  if command -v curl >/dev/null 2>&1; then
    if [[ -t 1 ]]; then
      curl -fL --progress-bar "$url" -o "$out"
    else
      curl -fsSL "$url" -o "$out"
    fi
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    if [[ -t 1 ]]; then
      wget -O "$out" "$url"
    else
      wget -qO "$out" "$url"
    fi
    return
  fi

  echo "Error: curl atau wget harus terpasang." >&2
  exit 1
}

need_cmd chmod
need_cmd mktemp

if [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET_NAME}"
fi

info "1/4 Memulai installer"
info "2/4 Mengunduh ${ASSET_NAME}"
info "     URL: ${DOWNLOAD_URL}"
download "$DOWNLOAD_URL" "$TMP_DIR/wgm"
info "3/4 Menyiapkan binary"
chmod +x "$TMP_DIR/wgm"

if [[ -w "$(dirname "$INSTALL_PATH")" ]]; then
  mv "$TMP_DIR/wgm" "$INSTALL_PATH"
else
  need_cmd sudo
  info "     Memerlukan sudo untuk menulis ke $(dirname "$INSTALL_PATH")"
  sudo mv "$TMP_DIR/wgm" "$INSTALL_PATH"
fi

info "4/4 Install selesai: $INSTALL_PATH"
"$INSTALL_PATH" --version
