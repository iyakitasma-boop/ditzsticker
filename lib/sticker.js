/**
 * ╔══════════════════════════════════════════╗
 * ║     DitzBot - Sticker Maker Library     ║
 * ║  Pembuat  : Ditzbot                      ║
 * ║  Tanggal  : 31 Maret 2026                ║
 * ╚══════════════════════════════════════════╝
 */

'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const Jimp      = require('jimp');
const fs        = require('fs');
const path      = require('path');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os        = require('os');

// ─── Check ffmpeg ─────────────────────────────────────────────────────────────
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
  console.log('[DitzBot] ffmpeg tersedia ✅');
} catch (_) {
  console.log('[DitzBot] ffmpeg tidak ada, pakai jimp fallback');
}

// ─── Generate unique tmp filename ─────────────────────────────────────────────
function tmpFile(ext) {
  return path.join(os.tmpdir(), `ditzbot_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

// ─── Convert image buffer → WebP 512x512 ──────────────────────────────────────
async function imageToWebP(buffer, meta = {}) {
  const id = Date.now();

  if (ffmpegAvailable) {
    const inp = tmpFile('jpg');
    const out = tmpFile('webp');
    try {
      fs.writeFileSync(inp, buffer);
      await execAsync(
        `ffmpeg -y -i "${inp}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0" -vcodec libwebp -lossless 0 -q:v 70 "${out}"`,
        { timeout: 30000 }
      );
      if (!fs.existsSync(out)) throw new Error('ffmpeg output tidak ada');
      const buf = fs.readFileSync(out);
      return addStickerMeta(buf, meta);
    } finally {
      try { if (fs.existsSync(inp)) fs.unlinkSync(inp); } catch(_) {}
      try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch(_) {}
    }
  }

  // Fallback jimp
  const img = await Jimp.read(buffer);
  // Jimp v0.22: resize dengan mode string
  img.contain(512, 512);
  const buf = await img.getBufferAsync('image/png');
  return addStickerMeta(buf, meta);
}

// ─── Convert video buffer → animated WebP ─────────────────────────────────────
async function videoToWebP(buffer, meta = {}) {
  if (!ffmpegAvailable) {
    throw new Error('ffmpeg tidak tersedia. Jalankan: sudo apt install ffmpeg');
  }

  const inp = tmpFile('mp4');
  const out = tmpFile('webp');
  try {
    fs.writeFileSync(inp, buffer);
    await execAsync(
      `ffmpeg -y -i "${inp}" -t 6 -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset picture -an -vsync 0 "${out}"`,
      { timeout: 60000 }
    );
    if (!fs.existsSync(out)) throw new Error('ffmpeg video output tidak ada');
    const buf = fs.readFileSync(out);
    return addStickerMeta(buf, meta);
  } finally {
    try { if (fs.existsSync(inp)) fs.unlinkSync(inp); } catch(_) {}
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch(_) {}
  }
}

// ─── Inject metadata sticker WA ke WebP RIFF ──────────────────────────────────
function addStickerMeta(imgBuf, meta = {}) {
  const {
    packName   = 'DitzBot Sticker',
    authorName = 'Ditzbot',
    categories = ['🎭'],
  } = meta;

  const json = JSON.stringify({
    'sticker-pack-id'        : `com.ditzbot.${Date.now()}`,
    'sticker-pack-name'      : packName,
    'sticker-pack-publisher' : authorName,
    'emojis'                 : categories,
    'android-app-store-link' : '',
    'ios-app-store-link'     : '',
  });

  try {
    const jsonBuf    = Buffer.from(json, 'utf8');
    // EXIF header (little-endian TIFF magic)
    const tiffHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
    // 1 IFD entry: tag 0x010E (ImageDescription) = ASCII, value offset after IFD
    const ifd        = Buffer.alloc(2 + 12 + 4);
    const valOffset  = tiffHeader.length + ifd.length;
    ifd.writeUInt16LE(1, 0);           // 1 entry
    ifd.writeUInt16LE(0x010E, 2);      // tag
    ifd.writeUInt16LE(2, 4);           // type ASCII
    ifd.writeUInt32LE(jsonBuf.length, 6); // count
    ifd.writeUInt32LE(valOffset, 10);  // value offset
    ifd.writeUInt32LE(0, 14);          // next IFD = none

    const exifData   = Buffer.concat([tiffHeader, ifd, jsonBuf]);
    const chunkFourCC = Buffer.from('EXIF');
    const chunkLen   = Buffer.alloc(4);
    chunkLen.writeUInt32LE(exifData.length, 0);
    const exifChunk  = Buffer.concat([chunkFourCC, chunkLen, exifData]);
    // Pad to even length if needed
    const padded     = exifData.length % 2 !== 0
      ? Buffer.concat([exifChunk, Buffer.from([0x00])])
      : exifChunk;

    // Only inject if valid RIFF/WEBP
    if (
      imgBuf.length > 12 &&
      imgBuf.slice(0, 4).toString('ascii') === 'RIFF' &&
      imgBuf.slice(8, 12).toString('ascii') === 'WEBP'
    ) {
      const oldSize = imgBuf.readUInt32LE(4);
      const out     = Buffer.alloc(imgBuf.length + padded.length);
      imgBuf.copy(out, 0, 0, 12);           // RIFF header
      padded.copy(out, 12);                 // inject EXIF chunk after RIFF header
      imgBuf.copy(out, 12 + padded.length, 12); // rest of original
      out.writeUInt32LE(oldSize + padded.length, 4);
      return out;
    }
  } catch (e) {
    console.error('[DitzBot] addStickerMeta error (non-fatal):', e.message);
  }

  return imgBuf; // return as-is kalau bukan WebP atau gagal inject
}

// ─── MAIN: download media dari WA & konversi ke sticker ───────────────────────
async function makeSticker(sock, msg, msgContent, mediaType, meta = {}) {
  let buffer;

  const isQuoted = !!(
    msgContent?.extendedTextMessage?.contextInfo?.quotedMessage
  );

  if (isQuoted) {
    const ctx       = msgContent.extendedTextMessage.contextInfo;
    const quotedMsg = ctx.quotedMessage;

    const fakeMsg = {
      key: {
        remoteJid : msg.key.remoteJid,
        id        : ctx.stanzaId,
        fromMe    : false,
        participant: ctx.participant,
      },
      message: quotedMsg,
    };

    buffer = await downloadMediaMessage(
      fakeMsg,
      'buffer',
      {},
      { logger: makeSilentLogger(), reuploadRequest: sock.updateMediaMessage }
    );
  } else {
    buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: makeSilentLogger(), reuploadRequest: sock.updateMediaMessage }
    );
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('Download media gagal — buffer kosong');
  }

  console.log(`[DitzBot] Media downloaded: ${buffer.length} bytes, type: ${mediaType}`);

  if (mediaType === 'imageMessage') return imageToWebP(buffer, meta);
  if (mediaType === 'videoMessage') return videoToWebP(buffer, meta);

  throw new Error(`Tipe media tidak dikenali: ${mediaType}`);
}

function makeSilentLogger() {
  const noop = () => {};
  return { trace: noop, debug: noop, info: noop, warn: noop, error: noop, child: () => makeSilentLogger() };
}

module.exports = { makeSticker, imageToWebP, videoToWebP };
