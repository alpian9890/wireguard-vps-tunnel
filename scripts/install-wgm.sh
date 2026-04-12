#!/usr/bin/env bash
set -euo pipefail

REPO="${WGM_REPO:-alpian9890/wireguard-vps-tunnel}"
VERSION="${WGM_VERSION:-latest}"
ASSET_NAME="${WGM_ASSET_NAME:-}"
INSTALL_PATH="${WGM_INSTALL_PATH:-/usr/bin/wgm}"
LEGACY_PATH="/usr/local/bin/wgm"
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
    wget --show-progress --progress=bar:force:noscroll -O "$out" "$url"
    return
  fi

  echo "Error: curl atau wget harus terpasang." >&2
  exit 1
}

need_cmd chmod
need_cmd mktemp

detect_asset_name() {
  if [[ -n "$ASSET_NAME" ]]; then
    info "Arsitektur override via WGM_ASSET_NAME=${ASSET_NAME}"
    return
  fi

  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m | tr '[:upper:]' '[:lower:]')"

  if [[ "$os" != "linux" ]]; then
    echo "Error: OS '$os' belum didukung installer binary ini." >&2
    exit 1
  fi

  case "$arch" in
    x86_64|amd64)
      ASSET_NAME="wgm-linux-x64"
      ;;
    aarch64|arm64)
      ASSET_NAME="wgm-linux-arm64"
      ;;
    *)
      echo "Error: Arsitektur '$arch' belum didukung." >&2
      echo "Set manual asset dengan WGM_ASSET_NAME jika Anda punya build custom." >&2
      exit 1
      ;;
  esac

  info "Deteksi arsitektur: os=${os}, arch=${arch}, asset=${ASSET_NAME}"
}

detect_asset_name

if [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET_NAME}"
fi

info "1/5 Memulai installer"
info "2/5 Menentukan binary target"
info "     Asset: ${ASSET_NAME}"
info "3/5 Mengunduh ${ASSET_NAME}"
info "     URL: ${DOWNLOAD_URL}"
download "$DOWNLOAD_URL" "$TMP_DIR/wgm"
info "4/5 Menyiapkan binary"
chmod +x "$TMP_DIR/wgm"

if [[ -w "$(dirname "$INSTALL_PATH")" ]]; then
  mv "$TMP_DIR/wgm" "$INSTALL_PATH"
else
  need_cmd sudo
  info "     Memerlukan sudo untuk menulis ke $(dirname "$INSTALL_PATH")"
  sudo mv "$TMP_DIR/wgm" "$INSTALL_PATH"
fi

if [[ "$INSTALL_PATH" != "$LEGACY_PATH" && -d "$(dirname "$LEGACY_PATH")" ]]; then
  if [[ -w "$(dirname "$LEGACY_PATH")" ]]; then
    ln -sfn "$INSTALL_PATH" "$LEGACY_PATH"
  else
    need_cmd sudo
    sudo ln -sfn "$INSTALL_PATH" "$LEGACY_PATH"
  fi
  info "     Sinkronkan path lama: $LEGACY_PATH -> $INSTALL_PATH"
fi

info "5/5 Install selesai: $INSTALL_PATH"
"$INSTALL_PATH" --version
