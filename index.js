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

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  makeInMemoryStore,
  jidNormalizedUser,
  PHONENUMBER_MCC
} = require('@whiskeysockets/baileys');

const pino  = require('pino');
const chalk = require('chalk');
const readline = require('readline');
const path  = require('path');
const fs    = require('fs');

const { makeSticker } = require('./lib/sticker');

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─── Store ────────────────────────────────────────────────────────────────────
const store = makeInMemoryStore({ logger });

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
    browser: ['DitzBot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: true,
    syncFullHistory: false,
    getMessage: async (key) => {
      if (store) {
        const msg = await store.loadMessage(key.remoteJid, key.id);
        return msg?.message || undefined;
      }
      return { conversation: 'Ditzbot is running!' };
    }
  });

  store.bind(sock.ev);

  // ─── Pairing Code Login ─────────────────────────────────────────────────────
  if (!sock.authState.creds.registered) {
    const phoneNumber = await askPhoneNumber();

    if (!phoneNumber || phoneNumber.length < 10) {
      console.log(chalk.red('❌ Nomor tidak valid! Restart bot dan coba lagi.'));
      process.exit(1);
    }

    console.log(chalk.yellow('\n⏳ Meminta Pairing Code...'));
    await new Promise(r => setTimeout(r, 3000));

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
  if (msg.key.fromMe) return; // abaikan pesan dari bot sendiri

  const from    = msg.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const pushName = msg.pushName || 'User';

  // Ambil semua tipe pesan
  const msgType = Object.keys(msg.message)[0];

  // Deteksi caption atau text
  const bodyText =
    msg.message?.conversation ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.documentMessage?.caption ||
    '';

  const body = bodyText.toLowerCase().trim();

  // ─── Cek command .ditzsticker ────────────────────────────────────────────────
  const isSticker = body === '.ditzsticker' || body.startsWith('.ditzsticker');

  if (!isSticker) return; // abaikan jika bukan command sticker

  console.log(chalk.cyan(`\n📩 [STICKER REQUEST] dari ${pushName} (${from})`));

  // ─── Ambil media: bisa dari quoted atau langsung ───────────────────────────
  let mediaMsg = null;
  let mediaType = null;

  // Cek apakah ada pesan yang di-reply
  const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quotedMsg) {
    if (quotedMsg.imageMessage) {
      mediaMsg  = quotedMsg.imageMessage;
      mediaType = 'imageMessage';
    } else if (quotedMsg.videoMessage) {
      mediaMsg  = quotedMsg.videoMessage;
      mediaType = 'videoMessage';
    } else if (quotedMsg.stickerMessage) {
      // Kalau reply sticker, beritahu tidak bisa
      return sock.sendMessage(from, {
        text: '❌ Tidak bisa mengubah sticker menjadi sticker lagi!\n\nKirim atau reply *foto/video* dengan caption *.ditzsticker*'
      }, { quoted: msg });
    }
  }

  // Jika tidak ada quoted, cek apakah pesan langsung mengandung gambar/video
  if (!mediaMsg) {
    if (msgType === 'imageMessage') {
      mediaMsg  = msg.message.imageMessage;
      mediaType = 'imageMessage';
    } else if (msgType === 'videoMessage') {
      mediaMsg  = msg.message.videoMessage;
      mediaType = 'videoMessage';
    }
  }

  if (!mediaMsg) {
    return sock.sendMessage(from, {
      text: `❌ *Cara Pakai .ditzsticker:*\n\n` +
            `1️⃣  Kirim foto dengan caption *.ditzsticker*\n` +
            `2️⃣  Reply foto orang lain dengan *.ditzsticker*\n\n` +
            `📌 Dukung: Foto & Video (max 10 detik)\n` +
            `🤖 *DitzBot* - by Ditzbot`
    }, { quoted: msg });
  }

  // Kirim pesan tunggu
  await sock.sendMessage(from, {
    text: '⏳ Sedang membuat sticker... Tunggu sebentar ya! 🎨'
  }, { quoted: msg });

  try {
    const stickerBuffer = await makeSticker(sock, msg, mediaMsg, mediaType, {
      packName : 'DitzBot Sticker',
      authorName: 'Ditzbot',
      categories: ['🎭']
    });

    if (!stickerBuffer) {
      return sock.sendMessage(from, {
        text: '❌ Gagal membuat sticker! File mungkin terlalu besar atau format tidak didukung.'
      }, { quoted: msg });
    }

    await sock.sendMessage(from, {
      sticker: stickerBuffer
    }, { quoted: msg });

    console.log(chalk.green(`✅ Sticker berhasil dikirim ke ${pushName}`));

  } catch (err) {
    console.error(chalk.red('❌ Error membuat sticker:'), err.message);
    await sock.sendMessage(from, {
      text: '❌ Terjadi error saat membuat sticker!\n\n' +
            '🔧 Kemungkinan penyebab:\n' +
            '• File terlalu besar\n' +
            '• Format tidak didukung\n' +
            '• Koneksi bermasalah\n\n' +
            'Coba lagi dengan foto yang lebih kecil ya!'
    }, { quoted: msg });
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
startBot().catch(err => {
  console.error(chalk.red('❌ Fatal Error:'), err);
  process.exit(1);
});
