/**
 * ╔══════════════════════════════════════════════╗
 * ║           D I T Z B O T  v1.0.0             ║
 * ║        WhatsApp Sticker Bot                  ║
 * ║  Pembuat  : Ditzbot                          ║
 * ║  Tanggal  : 31 Maret 2026                    ║
 * ║  Fitur    : Sticker Maker dari Foto/Video    ║
 * ╚══════════════════════════════════════════════╝
 */

'use strict';

// Fix untuk Node v16 — crypto harus di-define manual
const crypto = require('crypto');
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto.webcrypto || crypto;
}

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const pino  = require('pino');
const chalk = require('chalk');
const readline = require('readline');
const path  = require('path');
const fs    = require('fs');

const { makeSticker } = require('./lib/sticker');

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─── Print Banner ─────────────────────────────────────────────────────────────
function printBanner() {
  console.log(chalk.cyan(`
╔══════════════════════════════════════════════╗
║           D I T Z B O T  v1.0.0             ║
║        WhatsApp Sticker Bot                  ║
╠══════════════════════════════════════════════╣
║  👤 Pembuat   : Ditzbot                      ║
║  📅 Tanggal   : 31 Maret 2026                ║
║  ✨ Fitur     : Sticker Maker                ║
║  🔗 Connect   : Pairing Code                 ║
╠══════════════════════════════════════════════╣
║  Cara Pakai:                                 ║
║  .ditzsticker + reply/kirim foto             ║
║  (tambahkan caption .ditzsticker)            ║
╚══════════════════════════════════════════════╝
`));
}

// ─── Ask Phone Number ─────────────────────────────────────────────────────────
async function askPhoneNumber() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.yellow('\n📱 Masukkan Nomor WhatsApp kamu (format: 628xxxxxxxxxx): '), (answer) => {
      rl.close();
      resolve(answer.replace(/[^0-9]/g, ''));
    });
  });
}

// ─── Main Function ────────────────────────────────────────────────────────────
async function startBot() {
  printBanner();

  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(chalk.green(`✅ Baileys version: ${version.join('.')} | Latest: ${isLatest}`));

  const authDir = path.join(__dirname, 'auth_info');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: true,
    syncFullHistory: false,
    getMessage: async () => {
      return { conversation: 'Ditzbot is running!' };
    }
  });

  // ─── Pairing Code Login ─────────────────────────────────────────────────────
  if (!sock.authState.creds.registered) {
    const phoneNumber = await askPhoneNumber();

    if (!phoneNumber || phoneNumber.length < 10) {
      console.log(chalk.red('❌ Nomor tidak valid! Restart bot dan coba lagi.'));
      process.exit(1);
    }

    console.log(chalk.yellow('\n⏳ Meminta Pairing Code...'));
    await new Promise(r => setTimeout(r, 1500));

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log(chalk.bgGreen.black(`\n🔑 PAIRING CODE: ${formatted}\n`));
      console.log(chalk.yellow('👆 Masukkan kode ini di WhatsApp:'));
      console.log(chalk.white('   Linked Devices → Link a Device → Link with phone number\n'));
    } catch (err) {
      console.log(chalk.red('❌ Gagal mendapatkan Pairing Code:', err.message));
    }
  }

  // ─── Connection Update ───────────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(chalk.red(`\n⚠️  Koneksi putus (kode: ${code}). Reconnect: ${shouldReconnect}`));
      if (shouldReconnect) {
        console.log(chalk.yellow('♻️  Mencoba reconnect dalam 5 detik...'));
        setTimeout(startBot, 5000);
      } else {
        console.log(chalk.red('🚫 Logged out. Hapus folder auth_info dan restart.'));
        fs.rmSync(authDir, { recursive: true, force: true });
        process.exit(0);
      }
    } else if (connection === 'open') {
      console.log(chalk.green('\n✅ DitzBot BERHASIL TERHUBUNG! Bot siap digunakan. 🎉\n'));
    } else if (connection === 'connecting') {
      console.log(chalk.yellow('🔄 Menghubungkan ke WhatsApp...'));
    }
  });

  // ─── Save Credentials ────────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ─── Message Handler ──────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error(chalk.red('❌ Error handle message:'), err.message);
      }
    }
  });
}

// ─── Message Handler Logic ────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
  if (!msg.message) return;
  if (msg.key.fromMe) return;

  const from     = msg.key.remoteJid;
  const pushName = msg.pushName || 'User';

  // Unwrap pesan yang dibungkus ephemeral/viewOnce
  const msgContent =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message;

  const msgType = Object.keys(msgContent)[0];

  // Ambil body teks dari semua kemungkinan tipe
  const bodyText =
    msgContent?.conversation ||
    msgContent?.imageMessage?.caption ||
    msgContent?.videoMessage?.caption ||
    msgContent?.extendedTextMessage?.text ||
    msgContent?.documentMessage?.caption ||
    '';

  const body = bodyText.trim().toLowerCase();

  // Log setiap pesan masuk untuk debug
  console.log(chalk.gray(`[MSG] ${pushName} | type: ${msgType} | body: "${body.slice(0,50)}"`));

  // Cek command
  if (body !== '.ditzsticker' && !body.startsWith('.ditzsticker')) return;

  console.log(chalk.cyan(`\n📩 [STICKER REQUEST] dari ${pushName}`));

  // ─── Tentukan sumber media ────────────────────────────────────────────────
  let mediaType = null;
  let isQuoted  = false;

  // CARA 1: Pesan langsung berisi foto/video dengan caption .ditzsticker
  if (msgType === 'imageMessage') {
    mediaType = 'imageMessage';
    isQuoted  = false;
    console.log(chalk.blue('📸 Mode: foto langsung'));
  } else if (msgType === 'videoMessage') {
    mediaType = 'videoMessage';
    isQuoted  = false;
    console.log(chalk.blue('🎥 Mode: video langsung'));
  }
  // CARA 2: Reply teks ".ditzsticker" ke foto/video orang lain
  else if (msgType === 'extendedTextMessage') {
    const quoted = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted?.imageMessage) {
      mediaType = 'imageMessage';
      isQuoted  = true;
      console.log(chalk.blue('📸 Mode: reply foto'));
    } else if (quoted?.videoMessage) {
      mediaType = 'videoMessage';
      isQuoted  = true;
      console.log(chalk.blue('🎥 Mode: reply video'));
    } else if (quoted?.stickerMessage) {
      return sock.sendMessage(from, {
        text: '❌ Tidak bisa mengubah sticker jadi sticker!\nKirim atau reply *foto/video* dengan *.ditzsticker*'
      }, { quoted: msg });
    } else {
      console.log(chalk.yellow('⚠️  Reply bukan ke foto/video, quoted type:'), quoted ? Object.keys(quoted)[0] : 'null');
    }
  }

  if (!mediaType) {
    return sock.sendMessage(from, {
      text: `❌ *Cara Pakai .ditzsticker:*\n\n` +
            `1️⃣  Kirim *foto* + caption *.ditzsticker*\n` +
            `2️⃣  *Reply* foto orang lain ketik *.ditzsticker*\n\n` +
            `🤖 *DitzBot* by Ditzbot`
    }, { quoted: msg });
  }

  // Kirim notif tunggu
  await sock.sendMessage(from, {
    text: '⏳ Sedang bikin sticker... 🎨'
  }, { quoted: msg });

  try {
    const stickerBuffer = await makeSticker(sock, msg, msgContent, mediaType, {
      packName  : 'DitzBot Sticker',
      authorName: 'Ditzbot',
      categories: ['🎭']
    });

    if (!stickerBuffer || stickerBuffer.length === 0) {
      throw new Error('Buffer sticker kosong');
    }

    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
    console.log(chalk.green(`✅ Sticker terkirim ke ${pushName} (${stickerBuffer.length} bytes)`));

  } catch (err) {
    console.error(chalk.red('❌ Gagal buat sticker:'), err.message);
    await sock.sendMessage(from, {
      text: `❌ Gagal buat sticker!\nError: ${err.message}`
    }, { quoted: msg });
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
startBot().catch(err => {
  console.error(chalk.red('❌ Fatal Error:'), err);
  process.exit(1);
});
