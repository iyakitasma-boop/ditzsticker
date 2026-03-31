#!/bin/bash
# ============================================================
#   DitzBot — Auto Install Script
#   Pembuat : Ditzbot | Tanggal : 31 Maret 2026
# ============================================================

echo "╔══════════════════════════════════════════════╗"
echo "║     DitzBot Auto Install Script             ║"
echo "║     by Ditzbot - 31 Maret 2026              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Cek Node.js
echo "🔍 Mengecek Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js tidak ditemukan!"
    echo "👉 Install dulu: https://nodejs.org"
    exit 1
fi
echo "✅ Node.js $(node -v) terdeteksi"

# Cek npm
echo "🔍 Mengecek npm..."
if ! command -v npm &> /dev/null; then
    echo "❌ npm tidak ditemukan!"
    exit 1
fi
echo "✅ npm $(npm -v) terdeteksi"

# Install ffmpeg (untuk video sticker)
echo ""
echo "📦 Menginstall ffmpeg (untuk video sticker)..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y ffmpeg 2>/dev/null
    echo "✅ ffmpeg terinstall"
elif command -v brew &> /dev/null; then
    brew install ffmpeg
    echo "✅ ffmpeg terinstall via Homebrew"
else
    echo "⚠️  ffmpeg tidak bisa diinstall otomatis."
    echo "   Sticker foto tetap bisa, tapi video sticker tidak akan berjalan."
fi

# Install npm dependencies
echo ""
echo "📦 Menginstall npm dependencies..."
npm install --legacy-peer-deps

if [ $? -ne 0 ]; then
    echo "❌ npm install gagal!"
    exit 1
fi

echo ""
echo "✅ Semua dependencies terinstall!"
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  🎉 Instalasi Selesai!                       ║"
echo "║                                              ║"
echo "║  Jalankan bot dengan:                        ║"
echo "║     node index.js                            ║"
echo "║                                              ║"
echo "║  Kemudian masukkan nomor HP kamu             ║"
echo "║  dan link dengan Pairing Code!               ║"
echo "╚══════════════════════════════════════════════╝"
