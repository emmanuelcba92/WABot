const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Configuración del Webhook del Backend en Cloudflare Worker
const WORKER_WEBHOOK_URL = process.env.WORKER_WEBHOOK_URL || 'https://coatwa.emmanuel-ag92.workers.dev/webhook';
const WORKER_PENDING_URL = process.env.WORKER_PENDING_URL || 'https://coatwa.emmanuel-ag92.workers.dev/api/pending-outgoing';

const AUTH_FOLDER = path.join(__dirname, 'baileys_auth');

// Control de duplicados por ID de mensaje
const processedMsgIds = new Set();

async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function startWhatsAppGateway() {
  console.log('🚀 Iniciando Gateway de WhatsApp Web (Baileys v6.7+)...');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`ℹ️ Usando WhatsApp Web v${version.join('.')}, ¿Es la última versión?: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Clínica Médica Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n==================================================');
      console.log('📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP EN TU CELULAR:');
      console.log('==================================================\n');
      QRCode.generate(qr, { small: true });
      console.log('\n==================================================\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Conexión cerrada. Razón/Status: ${statusCode}. Reconectando: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsAppGateway, 3000);
      } else {
        console.log('❌ Sesión cerrada por el usuario. Eliminando auth y reiniciando...');
        if (fs.existsSync(AUTH_FOLDER)) {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        }
        setTimeout(startWhatsAppGateway, 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ CONEXIÓN ESTABLECIDA EXITOSAMENTE CON WHATSAPP WEB.');
      console.log('🟢 Bot receptor listo para procesar mensajes e imágenes HD entrantes.');
    }
  });

  // Reorganizar recepción de mensajes entrantes
  sock.ev.on('messages.upsert', async (m) => {
    const { messages, type } = m;
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

        const msgId = msg.key.id;
        if (msgId) {
          if (processedMsgIds.has(msgId)) continue;
          processedMsgIds.add(msgId);
          if (processedMsgIds.size > 2000) processedMsgIds.clear();
        }

        // Extraer texto del mensaje
        const mensajeTexto = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.documentMessage?.caption ||
          '';

        let imagenBase64 = null;
        let imagenNombre = null;
        let pdfBase64 = null;
        let pdfNombre = null;

        // Detectar si el paciente envió una foto
        const isImage = !!msg.message.imageMessage;
        // Detectar si el paciente envió un documento PDF
        const isDocument = !!msg.message.documentMessage || !!msg.message.documentWithCaptionMessage;

        if (isImage) {
          try {
            console.log(`📸 [Desencriptando HD] Capturando foto nativa de ${remoteJid}...`);
            const rawBuffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              {
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
              }
            );

            if (rawBuffer && rawBuffer.length > 2000) {
              let optimizedBuffer = rawBuffer;
              try {
                optimizedBuffer = await sharp(rawBuffer)
                  .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                  .jpeg({ quality: 82 })
                  .toBuffer();
              } catch (sErr) {
                optimizedBuffer = rawBuffer;
              }

              const mimetype = 'image/jpeg';
              imagenBase64 = `data:${mimetype};base64,${optimizedBuffer.toString('base64')}`;
              imagenNombre = `foto_${Date.now()}.jpg`;
              console.log(`📸 [HD ÉXITO CRISTALINO] Foto procesada en nitidez máxima 1200px (${rawBuffer.length}b -> ${optimizedBuffer.length}b)`);
            }
          } catch (imgErr) {
            console.error('❌ Error al desencriptar foto HD nativa:', imgErr?.message || imgErr);
          }
        } else if (isDocument) {
          try {
            const docMsg = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
            const mimetype = docMsg?.mimetype || 'application/pdf';
            const fileName = docMsg?.fileName || `documento_${Date.now()}.pdf`;

            console.log(`📄 [Descargando Documento] Recibiendo PDF/Documento (${fileName}) de ${remoteJid}...`);
            const docBuffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              {
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
              }
            );

            if (docBuffer && docBuffer.length > 100) {
              pdfBase64 = `data:${mimetype};base64,${docBuffer.toString('base64')}`;
              pdfNombre = fileName;
              console.log(`📄 [PDF RECIBIDO EXITOSAMENTE] ${fileName} (${docBuffer.length} bytes)`);
            }
          } catch (docErr) {
            console.error('❌ Error al procesar documento PDF entrante:', docErr?.message || docErr);
          }
        }

        console.log(`📩 Mensaje recibido de ${remoteJid}: "${mensajeTexto || (imagenBase64 ? '📷 (Foto)' : (pdfBase64 ? '📄 (PDF)' : ''))}"`);

        // Enviar payload al Webhook de Cloudflare Worker
        const res = await fetchWithRetry(WORKER_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            remitente: remoteJid,
            mensaje: mensajeTexto,
            imagenBase64,
            imagenNombre,
            pdfBase64,
            pdfNombre
          })
        });

        const data = await res.json();

        // Si el bot generó respuesta automática inmediata, enviarla por WhatsApp
        if (data.respuesta) {
          console.log(`🤖 Enviando respuesta automática del bot a ${remoteJid}...`);
          await sock.sendMessage(remoteJid, { text: data.respuesta });
        }
      } catch (err) {
        console.error('❌ Error procesando mensaje de WhatsApp:', err?.message || err);
      }
    }
  });

  // Polling para enviar respuestas escritas por las secretarias desde el Panel Web (admin.html)
  setInterval(async () => {
    try {
      const res = await fetch(WORKER_PENDING_URL);
      if (!res.ok) return;

      const data = await res.json();
      const messages = data.messages || [];

      for (const item of messages) {
        if (item.remitente) {
          console.log(`👩‍⚕️ [SECRETARÍA -> WA] Enviando mensaje manual a ${item.remitente}...`);

          // Si la secretaria adjuntó un archivo PDF personalizado o de plantilla
          if (item.pdfBase64) {
            const buffer = Buffer.from(item.pdfBase64.split(',')[1] || item.pdfBase64, 'base64');
            await sock.sendMessage(item.remitente, {
              document: buffer,
              mimetype: 'application/pdf',
              fileName: item.pdfNombre || 'Indicaciones_Medicas.pdf',
              caption: item.text
            });
          } else {
            await sock.sendMessage(item.remitente, { text: item.text });
          }

          console.log(`✅ Mensaje de Secretaría enviado exitosamente a ${item.remitente}`);
        }
      }
    } catch (e) {}
  }, 4000);
}

startWhatsAppGateway().catch((err) => console.error('❌ Error fatal en Gateway:', err));
