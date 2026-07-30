const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WORKER_WEBHOOK_URL = 'https://coatwa.emmanuel-ag92.workers.dev/webhook';
const WORKER_PENDING_URL = 'https://coatwa.emmanuel-ag92.workers.dev/api/pending-outgoing';

const processedMsgIds = new Set();

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      console.warn(`[WARN] Intento ${i + 1} falló HTTP ${response.status}. Reintentando...`);
    } catch (err) {
      console.warn(`[WARN] Intento ${i + 1} fallo de red: ${err.message}. Reintentando...`);
    }
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error(`Fallaron los ${maxRetries} intentos hacia ${url}`);
}

async function startWhatsAppGateway() {
  console.log('🚀 Iniciando Conector Oficial de WhatsApp Baileys para la Clínica...');

  const authFolder = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Clínica Médica Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 ESCANEE ESTE CÓDIGO QR CON EL WHATSAPP DE LA CLÍNICA PARA VINCULAR:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Conexión cerrada. Razón: ${statusCode}. ¿Reconectar?: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => startWhatsAppGateway(), 3000);
      } else {
        console.error('❌ Sesión cerrada por el usuario. Por favor elimine la carpeta auth_info_baileys y escanee el QR nuevamente.');
      }
    } else if (connection === 'open') {
      console.log('✅ ¡CONEXIÓN ESTABLECIDA CON ÉXITO A WHATSAPP DE LA CLÍNICA!');
      console.log('👂 Escuchando mensajes entrantes en tiempo real...');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const remitente = msg.key.remoteJid;
        if (!remitente || remitente.includes('@g.us')) continue; // Ignorar grupos

        let altRemitente = null;
        if (msg.key.remoteJidAlt) {
          altRemitente = msg.key.remoteJidAlt;
        } else if (msg.key.participant) {
          altRemitente = msg.key.participant;
        }

        const pushName = msg.pushName || null;

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
            console.log(`📸 [Desencriptando HD] Capturando foto nativa de ${remitente} (${pushName || 'sin nombre'})...`);
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
                console.warn('⚠️ No se pudo procesar con Sharp, usando buffer original:', sErr.message);
              }

              imagenBase64 = `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`;
              imagenNombre = `pedido_${Date.now()}.jpg`;
            }
          } catch (imgErr) {
            console.error('⚠️ Error al desencriptar foto:', imgErr);
          }
        }

        if (isDocument) {
          try {
            const docMsg = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
            const mime = docMsg?.mimetype || '';
            const fileName = docMsg?.fileName || 'documento.pdf';

            if (mime.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
              console.log(`📄 [Desencriptando PDF] Capturando archivo PDF "${fileName}" de ${remitente}...`);
              const pdfBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                  logger: pino({ level: 'silent' }),
                  reuploadRequest: sock.updateMediaMessage
                }
              );

              if (pdfBuffer && pdfBuffer.length > 100) {
                pdfBase64 = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
                pdfNombre = fileName;
              }
            }
          } catch (pdfErr) {
            console.error('⚠️ Error al desencriptar PDF:', pdfErr);
          }
        }

        console.log(`📩 Mensaje recibido de ${pushName || remitente} (${remitente}): "${mensajeTexto || (imagenBase64 ? '📷 [Foto]' : (pdfBase64 ? '📄 [PDF]' : ''))}"`);

        const webhookPayload = {
          remitente,
          altRemitente,
          pushName,
          mensaje: mensajeTexto,
          imagenBase64,
          imagenNombre,
          pdfBase64,
          pdfNombre
        };

        const res = await fetchWithRetry(WORKER_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload)
        });

        const data = await res.json();
        console.log(`🤖 Respuesta de Engine State: "${data.respuesta || '(Silencio en atención)'}" [Estado: ${data.estadoActual}]`);

        if (data.respuesta && data.respuesta.trim().length > 0) {
          await sock.sendMessage(remitente, { text: data.respuesta });
          console.log(`📤 Respuesta enviada por WhatsApp a ${remitente}`);
        }
      } catch (err) {
        console.error('❌ Error procesando mensaje entrante:', err);
      }
    }
  });

  // Polling continuo de respuestas pendientes salientes generadas por la secretaria
  setInterval(async () => {
    try {
      const res = await fetch(WORKER_PENDING_URL);
      if (!res.ok) return;

      const data = await res.json();
      const messages = data.messages || [];

      for (const msg of messages) {
        try {
          let primaryJid = msg.targetJid || msg.remitente;
          let altJid = msg.altRemitente;

          let phoneJid = null;
          let lidJid = null;

          if (primaryJid.includes('@lid')) {
            lidJid = primaryJid;
          } else {
            let clean = primaryJid.replace(/[^0-9]/g, '');
            if (clean.startsWith('0')) clean = clean.substring(1);
            if (clean.startsWith('15')) clean = clean.substring(2);
            if (!clean.startsWith('54')) clean = `549${clean}`;
            else if (clean.startsWith('54') && !clean.startsWith('549')) clean = `549${clean.substring(2)}`;
            phoneJid = `${clean}@s.whatsapp.net`;
          }

          if (altJid) {
            if (altJid.includes('@lid')) lidJid = altJid;
            else if (!phoneJid) {
              let clean = altJid.replace(/[^0-9]/g, '');
              if (clean.startsWith('0')) clean = clean.substring(1);
              if (clean.startsWith('15')) clean = clean.substring(2);
              if (!clean.startsWith('54')) clean = `549${clean}`;
              else if (clean.startsWith('54') && !clean.startsWith('549')) clean = `549${clean.substring(2)}`;
              phoneJid = `${clean}@s.whatsapp.net`;
            }
          }

          const targets = [];
          if (phoneJid) targets.push(phoneJid);
          if (lidJid && lidJid !== phoneJid) targets.push(lidJid);

          let sendSuccess = false;
          for (const targetJid of targets) {
            try {
              if (msg.pdfBase64 && msg.pdfNombre) {
                const base64Data = msg.pdfBase64.replace(/^data:application\/pdf;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                await sock.sendMessage(targetJid, {
                  document: buffer,
                  mimetype: 'application/pdf',
                  fileName: msg.pdfNombre,
                  caption: msg.text || undefined
                });
                console.log(`📤 Documento PDF "${msg.pdfNombre}" enviado a ${targetJid}.`);
                sendSuccess = true;
              } else if (msg.imagenBase64) {
                const base64Data = msg.imagenBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                await sock.sendMessage(targetJid, {
                  image: buffer,
                  caption: msg.text || undefined
                });
                console.log(`📤 Imagen enviada a ${targetJid}.`);
                sendSuccess = true;
              } else if (msg.text) {
                await sock.sendMessage(targetJid, { text: msg.text });
                console.log(`📤 Respuesta de secretaria enviada a ${targetJid}: "${msg.text}"`);
                sendSuccess = true;
              }
            } catch (errJid) {
              console.warn(`⚠️ Error al enviar a ${targetJid}:`, errJid?.message || errJid);
            }
          }

          if (!sendSuccess) {
            console.error(`❌ No se pudo entregar mensaje a ninguna dirección de ${msg.remitente}`);
          }
        } catch (sendErr) {
          console.error(`❌ Error procesando mensaje saliente:`, sendErr?.message || sendErr);
        }
      }
    } catch (pollErr) {
      // Ignorar errores temporales de red en el polling saliente
    }
  }, 3000);
}

startWhatsAppGateway().catch((err) => {
  console.error('❌ Error fatal en WhatsApp Gateway:', err);
});
