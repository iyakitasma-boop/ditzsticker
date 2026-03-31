/**
 * ╔══════════════════════════════════════════╗
 * ║     DitzBot - Sticker Maker Library     ║
 * ║  Pembuat  : Ditzbot                      ║
 * ║  Tanggal  : 31 Maret 2026                ║
 * ╚══════════════════════════════════════════╝
 */

'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const Jimp   = require('jimp');
const fs     = require('fs');
const path   = require('path');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');

// ─── Check ffmpeg ─────────────────────────────────────────────────────────────
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch (_) {
  ffmpegAvailable = false;
}

/**
 * Convert image buffer ke WebP sticker pakai ffmpeg
 * Fallback: jimp kalau ffmpeg tidak ada
 */
async function imageToWebP(buffer, meta = {}) {
  const { packName = 'DitzBot', authorName = 'Ditzbot', categories = ['🎭'] } = meta;

  let webpBuffer;

  if (ffmpegAvailable) {
    // Pakai ffmpeg — paling reliable, support semua format
    const tmpInput  = path.join(os.tmpdir(), `ditz_img_${Date.now()}.jpg`);
    const tmpOutput = path.join(os.tmpdir(), `ditz_img_${Date.now()}.webp`);
    try {
      fs.writeFileSync(tmpInput, buffer);
      await execAsync(
        `ffmpeg -i "${tmpInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -q:v 70 -y "${tmpOutput}"`,
        { timeout: 30000 }
      );
      if (!fs.existsSync(tmpOutput)) throw new Error('output tidak ada');
      webpBuffer = fs.readFileSync(tmpOutput);
    } finally {
      if (fs.existsSync(tmpInput))  fs.unlinkSync(tmpInput);
      if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    }
  } else {
    // Fallback: jimp (tidak butuh Node versi tertentu)
    const image = await Jimp.read(buffer);
    image.resize(512, 512, Jimp.RESIZE_CONTAIN);
    webpBuffer = await image.getBufferAsync(Jimp.MIME_PNG); // jimp tidak support webp native, kirim PNG
    // WhatsApp akan terima PNG sebagai sticker juga
  }

  return addStickerMetadata(webpBuffer, { packName, authorName, categories });
}

/**
 * Convert video buffer ke animated WebP sticker
 */
async function videoToWebP(buffer, meta = {}) {
  const { packName = 'DitzBot', authorName = 'Ditzbot', categories = ['🎭'] } = meta;

  if (!ffmpegAvailable) {
    throw new Error('ffmpeg tidak tersedia. Install dengan: sudo apt install ffmpeg');
  }

  const tmpInput  = path.join(os.tmpdir(), `ditz_vid_${Date.now()}.mp4`);
  const tmpOutput = path.join(os.tmpdir(), `ditz_vid_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tmpInput, buffer);

    await execAsync(
      `ffmpeg -i "${tmpInput}" -t 6 -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset picture -an -vsync 0 -y "${tmpOutput}"`,
      { timeout: 60000 }
    );

    if (!fs.existsSync(tmpOutput)) throw new Error('Output file tidak ditemukan');

    const webpBuffer = fs.readFileSync(tmpOutput);
    return addStickerMetadata(webpBuffer, { packName, authorName, categories });
  } finally {
    if (fs.existsSync(tmpInput))  fs.unlinkSync(tmpInput);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
}

/**
 * Inject metadata sticker WhatsApp ke buffer WebP/PNG
 */
function addStickerMetadata(imgBuffer, meta = {}) {
  const {
    packName   = 'DitzBot Sticker',
    authorName = 'Ditzbot',
    categories = ['🎭'],
    publisher  = 'Ditzbot',
    createdAt  = '31 Maret 2026'
  } = meta;

  const json = JSON.stringify({
    'sticker-pack-id'        : `com.ditzbot.sticker.${Date.now()}`,
    'sticker-pack-name'      : packName,
    'sticker-pack-publisher' : publisher,
    'android-app-store-link' : '',
    'ios-app-store-link'     : '',
    'emojis'                 : categories,
    'author'                 : authorName,
    'created-at'             : createdAt
  });

  try {
    const exif       = Buffer.from(json, 'utf8');
    const exifHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);

    const ifdEntries = 1;
    const ifdBuffer  = Buffer.alloc(2 + ifdEntries * 12 + 4);
    ifdBuffer.writeUInt16LE(ifdEntries, 0);

    const dataOffset = exifHeader.length + ifdBuffer.length;
    ifdBuffer.writeUInt16LE(0x010E, 2);
    ifdBuffer.writeUInt16LE(2, 4);
    ifdBuffer.writeUInt32LE(exif.length, 6);
    ifdBuffer.writeUInt32LE(dataOffset, 10);
    ifdBuffer.writeUInt32LE(0, 14);

    const exifFull    = Buffer.concat([exifHeader, ifdBuffer, exif]);
    const chunkHeader = Buffer.from('EXIF');
    const chunkSize   = Buffer.alloc(4);
    chunkSize.writeUInt32LE(exifFull.length, 0);
    const exifChunk   = Buffer.concat([chunkHeader, chunkSize, exifFull]);

    if (imgBuffer.toString('ascii', 0, 4) === 'RIFF' &&
        imgBuffer.toString('ascii', 8, 12) === 'WEBP') {
      const riffSize = imgBuffer.readUInt32LE(4);
      const newRiff  = Buffer.alloc(imgBuffer.length + exifChunk.length);
      imgBuffer.copy(newRiff, 0, 0, 12);
      exifChunk.copy(newRiff, 12);
      imgBuffer.copy(newRiff, 12 + exifChunk.length, 12);
      newRiff.writeUInt32LE(riffSize + exifChunk.length, 4);
      return newRiff;
    }

    return imgBuffer;
  } catch (_) {
    return imgBuffer;
  }
}

/**
 * Main: download media dari WA lalu konversi ke sticker
 */
async function makeSticker(sock, msg, mediaMsg, mediaType, meta = {}) {
  let buffer;

  const isQuoted = !!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (isQuoted) {
    const quotedMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
    buffer = await downloadMediaMessage(
      {
        key: {
          remoteJid: msg.key.remoteJid,
          id       : msg.message.extendedTextMessage.contextInfo.stanzaId,
          fromMe   : false
        },
        message: quotedMsg
      },
      'buffer',
      {},
      { logger: { trace(){}, debug(){}, info(){}, warn(){}, error(){} }, reuploadRequest: sock.updateMediaMessage }
    );
  } else {
    buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: { trace(){}, debug(){}, info(){}, warn(){}, error(){} }, reuploadRequest: sock.updateMediaMessage }
    );
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('Buffer kosong - gagal download media');
  }

  if (mediaType === 'imageMessage') {
    return await imageToWebP(buffer, meta);
  } else if (mediaType === 'videoMessage') {
    return await videoToWebP(buffer, meta);
  }

  return null;
}

module.exports = { makeSticker, imageToWebP, videoToWebP };
