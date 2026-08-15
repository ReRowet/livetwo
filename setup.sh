#!/usr/bin/env bash

# ==============================================================================
#  RE Stream — Linux Setup & PM2 Deployment Installer
# ==============================================================================
#  Automated installer for Ubuntu, Debian, CentOS, Rocky, AlmaLinux, etc.
# ==============================================================================

set -e

# ANSI Color Codes
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper Functions
print_step() {
  echo -e "\n${CYAN}${BOLD}▶ $1${NC}"
}

print_success() {
  echo -e "${GREEN}${BOLD}✔ $1${NC}"
}

print_warn() {
  echo -e "${YELLOW}${BOLD}⚠ $1${NC}"
}

print_error() {
  echo -e "${RED}${BOLD}✖ $1${NC}"
}

# Determine script root directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════════════════════╗"
echo "  ║             RE Stream — Live Streaming Server                    ║"
echo "  ║             Linux & PM2 Auto-Installation Script                 ║"
echo "  ╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ------------------------------------------------------------------------------
# 1. Root & Sudo Verification
# ------------------------------------------------------------------------------
print_step "1/7 Memeriksa Hak Akses Sistem..."
SUDO_CMD=""
if [ "$EUID" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO_CMD="sudo"
    print_success "Menggunakan sudo untuk instalasi paket sistem"
  else
    print_error "Script membutuhkan hak akses root atau sudo. Silakan jalankan sebagai root atau install sudo."
    exit 1
  fi
else
  print_success "Berjalan sebagai root"
fi

# ------------------------------------------------------------------------------
# 2. Package Manager & Dependencies Installation
# ------------------------------------------------------------------------------
print_step "2/7 Memeriksa & Menginstall Paket Sistem (FFmpeg, Curl, Git, Build Tools)..."

if command -v apt-get >/dev/null 2>&1; then
  echo "Mendeteksi sistem berbasis Debian/Ubuntu..."
  $SUDO_CMD apt-get update -y
  $SUDO_CMD apt-get install -y curl wget git ffmpeg build-essential procps
elif command -v dnf >/dev/null 2>&1; then
  echo "Mendeteksi sistem berbasis RHEL/CentOS/Rocky/AlmaLinux (DNF)..."
  $SUDO_CMD dnf install -y epel-release || true
  $SUDO_CMD dnf install -y curl wget git ffmpeg ffmpeg-free gcc gcc-c++ make procps-ng || true
elif command -v yum >/dev/null 2>&1; then
  echo "Mendeteksi sistem berbasis CentOS/RHEL (YUM)..."
  $SUDO_CMD yum install -y epel-release || true
  $SUDO_CMD yum install -y curl wget git ffmpeg gcc gcc-c++ make procps || true
elif command -v pacman >/dev/null 2>&1; then
  echo "Mendeteksi sistem berbasis Arch Linux..."
  $SUDO_CMD pacman -Sy --noconfirm curl wget git ffmpeg base-devel procps-ng
else
  print_warn "Package manager tidak dikenali. Pastikan FFmpeg, curl, dan git sudah terpasang manual."
fi

# Verify FFmpeg
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_VER=$(ffmpeg -version | head -n 1)
  print_success "FFmpeg terpasang: $FFMPEG_VER"
else
  print_error "FFmpeg tidak ditemukan! Pastikan FFmpeg terinstall di sistem Linux Anda."
  exit 1
fi

# ------------------------------------------------------------------------------
# 3. Node.js & NPM Verification / Installation (LTS v20)
# ------------------------------------------------------------------------------
print_step "3/7 Memeriksa Node.js & NPM..."

NODE_INSTALLED=false
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    NODE_INSTALLED=true
    print_success "Node.js $(node -v) sudah terpasang dan kompatibel (>= 18)."
  else
    print_warn "Node.js versi $(node -v) terdeteksi terlalu lama (< 18). Mengupdate ke Node.js 20 LTS..."
  fi
fi

if [ "$NODE_INSTALLED" = false ]; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "Menginstall Node.js 20.x LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO_CMD -E bash -
    $SUDO_CMD apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    echo "Menginstall Node.js 20.x LTS via NodeSource..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO_CMD bash -
    $SUDO_CMD dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    echo "Menginstall Node.js 20.x LTS via NodeSource..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO_CMD bash -
    $SUDO_CMD yum install -y nodejs
  else
    print_error "Gagal menginstall Node.js otomatis. Silakan install Node.js >= 18 manual."
    exit 1
  fi
  print_success "Node.js $(node -v) & NPM $(npm -v) berhasil diinstall"
fi

# ------------------------------------------------------------------------------
# 4. PM2 Global Installation
# ------------------------------------------------------------------------------
print_step "4/7 Memeriksa & Menginstall PM2 Process Manager..."
if command -v pm2 >/dev/null 2>&1; then
  print_success "PM2 sudah terpasang: $(pm2 -v)"
else
  echo "Menginstall PM2 secara global via NPM..."
  $SUDO_CMD npm install -g pm2
  print_success "PM2 berhasil diinstall: $(pm2 -v)"
fi

# ------------------------------------------------------------------------------
# 5. Project Directory & Environment Setup
# ------------------------------------------------------------------------------
print_step "5/7 Menyiapkan Struktur Folder & File Konfigurasi..."

mkdir -p "$PROJECT_DIR/data"
mkdir -p "$PROJECT_DIR/logs"
mkdir -p "$PROJECT_DIR/playlists"
mkdir -p "$PROJECT_DIR/uploads/videos"
mkdir -p "$PROJECT_DIR/uploads/audios"
mkdir -p "$PROJECT_DIR/uploads/thumbnails"
mkdir -p "$PROJECT_DIR/bin"
mkdir -p "$PROJECT_DIR/public"

chmod -R 755 "$PROJECT_DIR/data" "$PROJECT_DIR/logs" "$PROJECT_DIR/playlists" "$PROJECT_DIR/uploads" || true

if [ ! -f "$PROJECT_DIR/.env" ]; then
  if [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    print_success "Membuat .env dari .env.example"
  else
    cat << 'EOF' > "$PROJECT_DIR/.env"
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123
JWT_SECRET=re_stream_jwt_secret_token_2026_super_secure
JWT_REFRESH_SECRET=re_stream_jwt_refresh_secret_2026_super_secure
PORT=3002
EOF
    print_success "Membuat file .env baru dengan konfigurasi default"
  fi
else
  print_success "File .env sudah ada"
fi

# ------------------------------------------------------------------------------
# 6. NPM Dependencies Installation
# ------------------------------------------------------------------------------
print_step "6/7 Menginstall Dependensi Proyek (npm install)..."
npm install --no-audit --fund=false
print_success "Dependensi Node.js berhasil diinstall"

# ------------------------------------------------------------------------------
# 7. Start & Enable PM2 Service
# ------------------------------------------------------------------------------
print_step "7/7 Menjalankan Server dengan PM2..."

# Stop previous instance if running
pm2 delete re-stream-web >/dev/null 2>&1 || true

# Start with ecosystem config
pm2 start ecosystem.config.js

# Save state
pm2 save

echo -e "\n${YELLOW}${BOLD}Mengatur Startup Otomatis saat Server Reboot:${NC}"
pm2 startup | tail -n 1 > /tmp/pm2_startup_cmd.sh || true
if [ -s /tmp/pm2_startup_cmd.sh ]; then
  STARTUP_CMD=$(cat /tmp/pm2_startup_cmd.sh)
  if [[ "$STARTUP_CMD" =~ ^sudo.* ]]; then
    echo "Menjalankan perintah startup hook..."
    eval "$STARTUP_CMD" || true
  fi
fi
rm -f /tmp/pm2_startup_cmd.sh || true

# Get Server IPs
SERVER_PORT=3002
if [ -f "$PROJECT_DIR/.env" ]; then
  PORT_CONFIG=$(grep "^PORT=" "$PROJECT_DIR/.env" | cut -d '=' -f 2 | tr -d ' \r\n')
  if [ -n "$PORT_CONFIG" ]; then
    SERVER_PORT="$PORT_CONFIG"
  fi
fi

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo -e "\n${GREEN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✔ SETUP & DEPLOYMENT BERHASIL!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "  Aplikasi aktif dan berjalan di background menggunakan PM2."
echo ""
echo -e "  ${BOLD}URL Akses Web UI:${NC}"
echo -e "  ▶ Localhost:     ${CYAN}http://localhost:${SERVER_PORT}${NC}"
echo -e "  ▶ Network/VPS:   ${CYAN}http://${LOCAL_IP}:${SERVER_PORT}${NC}"
echo ""
echo -e "  ${BOLD}Default Login Credentials (.env):${NC}"
echo -e "  - Username:      ${YELLOW}admin${NC}"
echo -e "  - Password:      ${YELLOW}admin123${NC}"
echo ""
echo -e "  ${BOLD}Perintah Manajemen PM2:${NC}"
echo -e "  ▶ Cek Status:     ${CYAN}pm2 status${NC}           (atau ${CYAN}npm run pm2:status${NC})"
echo -e "  ▶ Realtime Log:   ${CYAN}pm2 logs re-stream-web${NC} (atau ${CYAN}npm run pm2:logs${NC})"
echo -e "  ▶ Restart Server: ${CYAN}pm2 restart re-stream-web${NC}"
echo -e "  ▶ Stop Server:    ${CYAN}pm2 stop re-stream-web${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${NC}\n"
