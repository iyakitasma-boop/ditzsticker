/**
 * ╔══════════════════════════════════════════╗
 * ║     DitzBot - Sticker Maker Library     ║
 * ║  Pembuat  : Ditzbot                      ║
 * ║  Tanggal  : 31 Maret 2026                ║
 * ╚══════════════════════════════════════════╝
 */

'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');
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
 * Convert image buffer ke WebP sticker
 * @param {Buffer} buffer - Image buffer (jpg/png/gif/webp)
 * @param {Object} meta - Metadata sticker
 * @returns {Promise<Buffer>} WebP sticker buffer
 */
async function imageToWebP(buffer, meta = {}) {
  const { packName = 'DitzBot', authorName = 'Ditzbot', categories = ['🎭'] } = meta;

  // Konversi ke WebP 512x512 dengan sharp
  const webpBuffer = await sharp(buffer)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality: 80 })
    .toBuffer();

  // Tambahkan metadata EXIF sticker WhatsApp
  return addStickerMetadata(webpBuffer, { packName, authorName, categories });
}

/**
 * Convert video buffer ke animated WebP sticker
 * @param {Buffer} buffer - Video buffer
 * @param {Object} meta - Metadata sticker
 * @returns {Promise<Buffer>} Animated WebP sticker buffer
 */
async function videoToWebP(buffer, meta = {}) {
  const { packName = 'DitzBot', authorName = 'Ditzbot', categories = ['🎭'] } = meta;

  if (!ffmpegAvailable) {
    throw new Error('ffmpeg tidak tersedia. Install dengan: apt-get install ffmpeg');
  }

  const tmpInput  = path.join(os.tmpdir(), `ditzbot_in_${Date.now()}.mp4`);
  const tmpOutput = path.join(os.tmpdir(), `ditzbot_out_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tmpInput, buffer);

    // Convert video ke animated webp (max 6 detik, 512x512)
    await execAsync(
      `ffmpeg -i "${tmpInput}" -t 6 -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset picture -an -vsync 0 -y "${tmpOutput}"`,
      { timeout: 60000 }
    );

    if (!fs.existsSync(tmpOutput)) {
      throw new Error('Output file tidak ditemukan');
    }

    const webpBuffer = fs.readFileSync(tmpOutput);
    return addStickerMetadata(webpBuffer, { packName, authorName, categories });
  } finally {
    if (fs.existsSync(tmpInput))  fs.unlinkSync(tmpInput);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
}

/**
 * Tambahkan metadata sticker WhatsApp ke WebP
 * Format: JSON di dalam chunk EXIF WebP
 * @param {Buffer} webpBuffer 
 * @param {Object} meta 
 * @returns {Buffer}
 */
function addStickerMetadata(webpBuffer, meta = {}) {
  const {
    packName   = 'DitzBot Sticker',
    authorName = 'Ditzbot',
    categories = ['🎭'],
    publisher  = 'Ditzbot',
    createdAt  = '31 Maret 2026'
  } = meta;

  const json = JSON.stringify({
    'sticker-pack-id'          : `com.ditzbot.sticker.${Date.now()}`,
    'sticker-pack-name'        : packName,
    'sticker-pack-publisher'   : publisher,
    'android-app-store-link'   : '',
    'ios-app-store-link'       : '',
    'emojis'                   : categories,
    'author'                   : authorName,
    'created-at'               : createdAt
  });

  // Encode JSON sebagai EXIF dalam WebP
  try {
    const exif  = Buffer.from(json, 'utf8');
    const exifHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
    
    // Build EXIF IFD
    const ifdEntries = 1;
    const ifdBuffer  = Buffer.alloc(2 + ifdEntries * 12 + 4);
    ifdBuffer.writeUInt16LE(ifdEntries, 0);
    
    // Tag 0x010E = ImageDescription — kita pakai untuk embed JSON
    const dataOffset = exifHeader.length + ifdBuffer.length;
    ifdBuffer.writeUInt16LE(0x010E, 2);
    ifdBuffer.writeUInt16LE(2, 4);        // ASCII type
    ifdBuffer.writeUInt32LE(exif.length, 6);
    ifdBuffer.writeUInt32LE(dataOffset, 10);
    ifdBuffer.writeUInt32LE(0, 14);       // Next IFD = 0
    
    const exifFull = Buffer.concat([exifHeader, ifdBuffer, exif]);
    
    // WebP EXIF chunk
    const chunkHeader  = Buffer.from('EXIF');
    const chunkSize    = Buffer.alloc(4);
    chunkSize.writeUInt32LE(exifFull.length, 0);
    const exifChunk    = Buffer.concat([chunkHeader, chunkSize, exifFull]);
    
    // Inject ke WebP RIFF
    if (webpBuffer.toString('ascii', 0, 4) === 'RIFF' &&
        webpBuffer.toString('ascii', 8, 12) === 'WEBP') {
      const riffSize = webpBuffer.readUInt32LE(4);
      const newRiff  = Buffer.alloc(webpBuffer.length + exifChunk.length);
      webpBuffer.copy(newRiff, 0, 0, 12);
      exifChunk.copy(newRiff, 12);
      webpBuffer.copy(newRiff, 12 + exifChunk.length, 12);
      newRiff.writeUInt32LE(riffSize + exifChunk.length, 4);
      return newRiff;
    }
    
    return webpBuffer;
  } catch (_) {
    // Kalau gagal inject metadata, kembalikan WebP asli
    return webpBuffer;
  }
}

/**
 * Main function: Buat sticker dari pesan WhatsApp
 * @param {Object} sock - Baileys socket
 * @param {Object} msg  - Full message object
 * @param {Object} mediaMsg  - Media message object
 * @param {string} mediaType - 'imageMessage' | 'videoMessage'
 * @param {Object} meta - Sticker metadata
 * @returns {Promise<Buffer|null>}
 */
async function makeSticker(sock, msg, mediaMsg, mediaType, meta = {}) {
  // Download media
  let buffer;
  
  // Cek apakah media dari quoted message atau langsung
  const isQuoted = !!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  
  if (isQuoted) {
    // Download dari quoted message
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
    // Download langsung dari pesan
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

  // Proses berdasarkan tipe
  if (mediaType === 'imageMessage') {
    return await imageToWebP(buffer, meta);
  } else if (mediaType === 'videoMessage') {
    return await videoToWebP(buffer, meta);
  }

  return null;
}

module.exports = { makeSticker, imageToWebP, videoToWebP };
