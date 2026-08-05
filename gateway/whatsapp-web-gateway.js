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

const WORKER_WEBHOOK_URL = 'https://app.cpcoat.workers.dev/webhook';
const WORKER_PENDING_URL = 'https://app.cpcoat.workers.dev/api/pending-outgoing';
const WORKER_HEARTBEAT_URL = 'https://app.cpcoat.workers.dev/api/heartbeat';
const WORKER_SSE_URL = 'https://app.cpcoat.workers.dev/sse';
const WORKER_SSE_ACK_URL = 'https://app.cpcoat.workers.dev/api/sse-ack';

// Identificador único de esta PC gateway
const GATEWAY_ID = require('os').hostname() || `gateway_${Date.now()}`;

const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

const clinicPdfDir = 'C:\\Archivos_Clinica\\Plantillas_PDF';
const fallbackPdfDir = path.join(__dirname, 'pdf_templates');
try {
  if (!fs.existsSync(clinicPdfDir)) fs.mkdirSync(clinicPdfDir, { recursive: true });
} catch (e) {
  if (!fs.existsSync(fallbackPdfDir)) fs.mkdirSync(fallbackPdfDir, { recursive: true });
}

const processedMsgIds = new Set();
const sentHistoryFile = path.join(__dirname, 'sent_history.json');
const sentKeysFile = path.join(__dirname, 'sent_keys.json');

let persistentSentIds = new Set();
let sentKeysMap = new Map();

try {
  if (fs.existsSync(sentHistoryFile)) {
    const raw = fs.readFileSync(sentHistoryFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) persistentSentIds = new Set(parsed);
  }
} catch (e) {}

try {
  if (fs.existsSync(sentKeysFile)) {
    const raw = fs.readFileSync(sentKeysFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.keys(parsed).forEach(k => sentKeysMap.set(k, parsed[k]));
    }
  }
} catch (e) {}

function markMsgAsSent(msgId) {
  if (!msgId) return;
  persistentSentIds.add(msgId);
  try {
    const arr = Array.from(persistentSentIds).slice(-3000);
    fs.writeFileSync(sentHistoryFile, JSON.stringify(arr), 'utf8');
  } catch (e) {}
}

function registerSentKey(internalId, key) {
  if (!key) return;
  if (internalId) sentKeysMap.set(internalId, key);
  if (key.id) sentKeysMap.set(key.id, key);
  try {
    const obj = {};
    Array.from(sentKeysMap.entries()).slice(-2000).forEach(([k, v]) => { obj[k] = v; });
    fs.writeFileSync(sentKeysFile, JSON.stringify(obj), 'utf8');
  } catch (e) {}
}

// 1. LATIDO (HEARTBEAT) CADA 15 SEGUNDOS AL SERVIDOR
async function sendHeartbeatPing() {
  try {
    const res = await fetch(WORKER_HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'online', timestamp: Date.now() })
    });
    if (res.ok) {
      console.log('💚 [SEÑAL EN LÍNEA] Ping enviado a la Web App');
    }
  } catch (err) {
    // Silencioso si hay corte temporal de red
  }
}
setInterval(sendHeartbeatPing, 60000); // Reducido de 15s a 60s para optimizar requests


// 3. SSE: CONEXIÓN SERVER-SENT EVENTS PARA NOTIFICACIONES INSTANTÁNEAS
let sseConnection = null;
let sseReconnectTimeout = null;
let pendingSseMessages = []; // Cola de mensajes SSE pendientes de procesar
let sseLastDataTime = 0; // Timestamp del último dato recibido por SSE
let sseKeepaliveCheck = null; // Interval para verificar conexión

function connectSSE() {
  const https = require('https');
  const url = new URL(WORKER_SSE_URL);
  url.searchParams.set('gateway', GATEWAY_ID);

  console.log(`🔌 [SSE] Conectando a ${url.toString()}...`);

  const req = https.get(url.toString(), {
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`❌ [SSE] Error HTTP ${res.statusCode}`);
      scheduleReconnect();
      return;
    }

    console.log('✅ [SSE] Conexión establecida');
    sseConnection = req;
    sseLastDataTime = Date.now();

    // Keepalive check: si no se recibe ningún dato en 20s, forzar reconexión
    if (sseKeepaliveCheck) clearInterval(sseKeepaliveCheck);
    sseKeepaliveCheck = setInterval(() => {
      if (sseConnection && Date.now() - sseLastDataTime > 20000) {
        console.warn('⚠️ [SSE] Keepalive timeout (20s sin datos), forzando reconexión...');
        sseConnection = null;
        if (sseKeepaliveCheck) { clearInterval(sseKeepaliveCheck); sseKeepaliveCheck = null; }
        scheduleReconnect();
        // Recoger mensajes pendientes inmediatamente
        fetchPendingMessagesOnce();
      }
    }, 10000);

    let buffer = '';

    res.on('data', (chunk) => {
      sseLastDataTime = Date.now(); // Actualizar timestamp de último dato
      buffer += chunk.toString();

      // Procesar eventos completos (separados por doble newline)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Guardar línea incompleta

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            handleSSEMessage(data);
          } catch (e) {
            // Ignorar líneas que no son JSON válido
          }
        }
        // Líneas que empiezan con ':' son keepalive, ignorar
      }
    });

    res.on('end', () => {
      console.log('⚠️ [SSE] Conexión cerrada, reconectando...');
      sseConnection = null;
      if (sseKeepaliveCheck) { clearInterval(sseKeepaliveCheck); sseKeepaliveCheck = null; }
      scheduleReconnect();
    });

    res.on('error', (err) => {
      console.error('❌ [SSE] Error de conexión:', err.message);
      sseConnection = null;
      if (sseKeepaliveCheck) { clearInterval(sseKeepaliveCheck); sseKeepaliveCheck = null; }
      scheduleReconnect();
    });
  });

  req.on('error', (err) => {
    console.error('❌ [SSE] Error al conectar:', err.message);
    sseConnection = null;
    if (sseKeepaliveCheck) { clearInterval(sseKeepaliveCheck); sseKeepaliveCheck = null; }
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (sseReconnectTimeout) return;
  console.log('🔄 [SSE] Reconectando en 5 segundos...');
  sseReconnectTimeout = setTimeout(() => {
    sseReconnectTimeout = null;
    connectSSE();
  }, 5000);
}

// Referencia global a la función de procesamiento (se asigna dentro de startWhatsAppGateway)
let _processSsePendingMessage = null;

function handleSSEMessage(data) {
  if (data.type === 'connected') {
    console.log(`🔌 [SSE] Conectado al Worker como ${data.gatewayId}`);
    // Al reconectar, pedir mensajes pendientes una vez
    fetchPendingMessagesOnce();
    return;
  }

  if (data.type === 'pending_outgoing') {
    console.log(`📩 [SSE] Notificación de mensaje pendiente: ${data.message?.id}`);
    if (_processSsePendingMessage) {
      _processSsePendingMessage(data.message);
    }
    return;
  }
}

async function fetchPendingMessagesOnce() {
  if (!_processSsePendingMessage) return;
  try {
    const res = await fetch(WORKER_PENDING_URL);
    if (!res.ok) return;
    const data = await res.json();
    const messages = data.messages || [];
    if (messages.length > 0) {
      console.log(`📩 [SSE] Procesando ${messages.length} mensajes pendientes post-reconexión`);
      for (const msg of messages) {
        await _processSsePendingMessage(msg);
      }
    }
  } catch (e) {}
}


// 2. MANTENIMIENTO NOCTURNO A LAS 3:30 AM (ELIMINA ARCHIVOS > 60 DÍAS)
setInterval(() => {
  try {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() >= 30 && now.getMinutes() <= 35) {
      if (fs.existsSync(mediaDir)) {
        const files = fs.readdirSync(mediaDir);
        const limitMs = 60 * 24 * 60 * 60 * 1000; // 60 días exactos
        const nowMs = Date.now();
        let deletedCount = 0;

        files.forEach(file => {
          const filePath = path.join(mediaDir, file);
          const stat = fs.statSync(filePath);
          if (nowMs - stat.mtimeMs > limitMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        });
        if (deletedCount > 0) {
          console.log(`🧹 [Limpieza Nocturna 3:30 AM] Se eliminaron ${deletedCount} archivos multimedia antiguos de más de 60 días.`);
        }
      }
    }
  } catch (cleanErr) {
    console.error('⚠️ Error en mantenimiento nocturno:', cleanErr);
  }
}, 300000); // Revisar cada 5 minutos

function resolveRealPhone(jidStr) {
  if (!jidStr) return null;
  const cleanId = jidStr.replace('@lid', '').replace('@s.whatsapp.net', '').trim();

  // 1. Buscar en archivo reverse de Baileys
  const revPath = path.join(__dirname, 'auth_info_baileys', `lid-mapping-${cleanId}_reverse.json`);
  if (fs.existsSync(revPath)) {
    try {
      const content = fs.readFileSync(revPath, 'utf8').trim().replace(/"/g, '');
      if (content && /^\d+$/.test(content)) {
        return content;
      }
    } catch (e) {}
  }

  // 2. Si no es @lid y tiene solo digitos (10 a 15 digitos)
  if (!jidStr.includes('@lid') && /^\d{10,15}$/.test(cleanId)) {
    return cleanId;
  }

  return null;
}

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

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['WA Bot Clínica', 'Chrome', '1.0.0']
  });

const logFilePath = path.join(__dirname, 'bot_errors.log');

function logErrorToFile(msg) {
  try {
    const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
    fs.appendFileSync(logFilePath, `${line}\n`);
  } catch(e) {}
}

process.on('uncaughtException', (err) => {
  const errText = `[${new Date().toISOString()}] 💥 EXCEPCIÓN NO CAPTURADA: ${err?.stack || err}`;
  console.error(errText);
  logErrorToFile(errText);
});

process.on('unhandledRejection', (reason, promise) => {
  const errText = `[${new Date().toISOString()}] 💥 PROCESO RECHAZADO: ${reason?.stack || reason}`;
  console.error(errText);
  logErrorToFile(errText);
});

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n⚡ ESCANEA EL SIGUIENTE CÓDIGO QR CON EL WHATSAPP DE LA CLÍNICA:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const timeStr = new Date().toLocaleTimeString('es-AR');

      console.log(`⚠️ [${timeStr}] Conexión cerrada (Código: ${statusCode || 'red/desconocido'}). Reintentando en 3 segundos...`);
      logErrorToFile(`[${new Date().toISOString()}] Conexión cerrada. Código: ${statusCode || 'desconocido'}`);

      if (!isLoggedOut) {
        setTimeout(() => {
          startWhatsAppGateway().catch(err => {
            console.error('❌ Error al reconectar:', err);
            logErrorToFile(`[${new Date().toISOString()}] Error en reconexión: ${err?.stack || err}`);
          });
        }, 3000);
      } else {
        console.log('🔒 Sesión de WhatsApp cerrada desde el teléfono. Borrá la carpeta auth_info_baileys para volver a vincular.');
      }
    } else if (connection === 'open') {
      console.log('✅ ¡CONEXIÓN ESTABLECIDA CON ÉXITO A WHATSAPP DE LA CLÍNICA!');
      console.log('📡 Escuchando mensajes entrantes en tiempo real y sintonizando mensajes offline...');
      console.log(`🔌 Gateway ID: ${GATEWAY_ID}`);
      sendHeartbeatPing();
      connectSSE(); // Conectar SSE para notificaciones instantáneas
    }
  });

  const sentMsgKeys = new Map();

  sock.ev.on('message-receipt.update', async (events) => {
    for (const receipt of events) {
      const jid = receipt.key.remoteJid;
      const msgId = receipt.key.id;
      const receiptType = (receipt.receipt && (receipt.receipt.userJid || receipt.receipt.readTimestamp)) ? 'read' : 'delivered';

      try {
        await fetch('https://app.cpcoat.workers.dev/api/message-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remitente: jid, msgId, status: receiptType })
        });
      } catch (e) {}
    }
  });

const lastIncomingKeysMap = new Map();

  sock.ev.on('messages.upsert', async (m) => {
    // Procesar mensajes en tiempo real ('notify') y mensajes offline sincronizados al reconectar ('append')
    if (m.type !== 'notify' && m.type !== 'append') return;

    for (const msg of m.messages) {
      if (!msg.message) continue; // Ignorar mensajes vacíos

      try {
        const remitente = msg.key.remoteJid;
        if (!remitente || remitente.includes('@g.us')) continue; // Ignorar grupos

        // ─── MENSAJES SALIENTES (fromMe) ───
        // Capturar respuestas enviadas desde WhatsApp Web por otras secretarias
        if (msg.key.fromMe) {
          const msgId = msg.key.id;
          if (msgId && processedMsgIds.has(msgId)) continue;
          if (msgId) {
            processedMsgIds.add(msgId);
            if (processedMsgIds.size > 2000) processedMsgIds.clear();
          }

          // Extraer texto del mensaje saliente
          const textoSaliente = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.documentMessage?.caption ||
            '';

          if (!textoSaliente && !msg.message.imageMessage && !msg.message.documentMessage) continue;

          // Enviar al Worker para que guarde en el historial
          try {
            await fetch(WORKER_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'outgoing_whatsapp_web',
                remitente: remitente,
                mensaje: textoSaliente,
                msgId: msgId,
                timestamp: new Date().toISOString()
              })
            });
            console.log(`📤 [WhatsApp Web] Mensaje saliente capturado para ${remitente}: "${textoSaliente.substring(0, 50)}..."`);
          } catch (fetchErr) {
            console.error('❌ Error enviando mensaje saliente al Worker:', fetchErr.message);
          }
          continue; // No procesar más este mensaje
        }

        // ─── MENSAJES ENTRANTES (originales) ───
        lastIncomingKeysMap.set(remitente, msg.key);

        let altRemitente = null;
        if (msg.key.remoteJidAlt) {
          altRemitente = msg.key.remoteJidAlt;
        } else if (msg.key.participant) {
          altRemitente = msg.key.participant;
        }

        if (altRemitente) {
          lastIncomingKeysMap.set(altRemitente, msg.key);
        }

        const realPhone = resolveRealPhone(remitente) || resolveRealPhone(altRemitente);
        if (realPhone) {
          altRemitente = `${realPhone}@s.whatsapp.net`;
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

  // ─── FUNCIÓN REUTILIZABLE PARA ENVIAR MENSAJES SALIENTES ───
  async function sendOutgoingMessage(msg) {
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
        if (msg.action === 'delete') {
          const targetKey = msg.targetMsgKey || sentKeysMap.get(msg.targetMsgId) || sentKeysMap.get(msg.id) || (msg.targetMsgId ? { remoteJid: targetJid, fromMe: true, id: msg.targetMsgId } : null);
          if (targetKey && targetKey.id) {
            const sendJid = targetKey.remoteJid || targetJid;
            await sock.sendMessage(sendJid, { delete: targetKey });
            console.log(`🗑️ Mensaje (${targetKey.id}) eliminado en WhatsApp para ${sendJid}.`);
            sendSuccess = true;
            break;
          }
        } else if (msg.action === 'mark_read') {
          try {
            const keyToRead = lastIncomingKeysMap.get(targetJid) || lastIncomingKeysMap.get(msg.remitente) || { remoteJid: targetJid, fromMe: false, id: msg.targetMsgId || msg.id };
            if (typeof sock.readMessages === 'function') {
              await sock.readMessages([keyToRead]);
            }
            if (typeof sock.chatModify === 'function') {
              await sock.chatModify({ markRead: true, lastMessages: [keyToRead] }, targetJid).catch(() => {});
            }
            console.log(`✅ Chat (${targetJid}) marcado como leído en WhatsApp.`);
            sendSuccess = true;
            break;
          } catch (errRead) {
            console.warn(`⚠️ Error al marcar como leído ${targetJid}:`, errRead?.message || errRead);
          }
        } else if (msg.action === 'edit') {
          const targetKey = msg.targetMsgKey || sentKeysMap.get(msg.targetMsgId) || sentKeysMap.get(msg.id) || (msg.targetMsgId ? { remoteJid: targetJid, fromMe: true, id: msg.targetMsgId } : null);
          if (targetKey && targetKey.id) {
            const sendJid = targetKey.remoteJid || targetJid;
            await sock.sendMessage(sendJid, { edit: targetKey, text: msg.text });
            console.log(`✏️ Mensaje (${targetKey.id}) editado en WhatsApp para ${sendJid}.`);
            sendSuccess = true;
            break;
          }
        } else if (msg.pdfBase64 && msg.pdfNombre) {
          const base64Data = msg.pdfBase64.replace(/^data:application\/pdf;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const sentRes = await sock.sendMessage(targetJid, {
            document: buffer,
            mimetype: 'application/pdf',
            fileName: msg.pdfNombre,
            caption: msg.text || undefined
          });
          if (sentRes && sentRes.key) {
            registerSentKey(msg.id, sentRes.key);
            if (msg.targetMsgId) registerSentKey(msg.targetMsgId, sentRes.key);
            fetch('https://app.cpcoat.workers.dev/api/message-sent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ remitente: msg.remitente, msgId: msg.id, internalMsgId: msg.internalMsgId, key: sentRes.key })
            }).catch(() => {});
          }
          console.log(`📤 Documento PDF "${msg.pdfNombre}" enviado a ${targetJid}.`);
          sendSuccess = true;
          break;
        } else if (msg.imagenBase64) {
          const base64Data = msg.imagenBase64.replace(/^data:image\/[a-z]+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const sentRes = await sock.sendMessage(targetJid, {
            image: buffer,
            caption: msg.text || undefined
          });
          if (sentRes && sentRes.key) {
            registerSentKey(msg.id, sentRes.key);
            if (msg.targetMsgId) registerSentKey(msg.targetMsgId, sentRes.key);
            fetch('https://app.cpcoat.workers.dev/api/message-sent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ remitente: msg.remitente, msgId: msg.id, internalMsgId: msg.internalMsgId, key: sentRes.key })
            }).catch(() => {});
          }
          console.log(`📤 Imagen enviada a ${targetJid}.`);
          sendSuccess = true;
          break;
        } else if (msg.latitude && msg.longitude) {
          const sentRes = await sock.sendMessage(targetJid, {
            location: {
              degreesLatitude: Number(msg.latitude),
              degreesLongitude: Number(msg.longitude),
              name: msg.locationName || 'Clínica COAT',
              address: msg.locationAddress || 'Córdoba, Argentina'
            }
          });
          if (sentRes && sentRes.key) {
            registerSentKey(msg.id, sentRes.key);
            if (msg.targetMsgId) registerSentKey(msg.targetMsgId, sentRes.key);
            fetch('https://app.cpcoat.workers.dev/api/message-sent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ remitente: msg.remitente, msgId: msg.id, internalMsgId: msg.internalMsgId, key: sentRes.key })
            }).catch(() => {});
          }
          console.log(`📍 Ubicación GPS nativa enviada a ${targetJid} (${msg.locationName || 'Clínica COAT'})`);
          sendSuccess = true;
          break;
        } else if (msg.text) {
          const sentRes = await sock.sendMessage(targetJid, { text: msg.text });
          if (sentRes && sentRes.key) {
            registerSentKey(msg.id, sentRes.key);
            if (msg.targetMsgId) registerSentKey(msg.targetMsgId, sentRes.key);
            fetch('https://app.cpcoat.workers.dev/api/message-sent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ remitente: msg.remitente, msgId: msg.id, internalMsgId: msg.internalMsgId, key: sentRes.key })
            }).catch(() => {});
          }
          console.log(`📤 Respuesta de secretaria enviada a ${targetJid}: "${msg.text}"`);
          sendSuccess = true;
          break;
        }
      } catch (errJid) {
        console.warn(`⚠️ Error al enviar a ${targetJid}, intentando siguiente dirección...:`, errJid?.message || errJid);
      }
    }

    if (!sendSuccess) {
      console.error(`❌ No se pudo entregar mensaje a ninguna dirección de ${msg.remitente}`);
      return false;
    }
    return true;
  }

  // ─── PROCESAMIENTO DE MENSAJES SSE (necesita acceso a sendOutgoingMessage) ───
  async function processSsePendingMessage(msg) {
    try {
      // DEDUPLICADOR
      const msgDedupeKey = msg.id || `${msg.remitente}_${msg.text}_${msg.pdfNombre || ''}`;
      if (persistentSentIds.has(msgDedupeKey) || (msg.id && persistentSentIds.has(msg.id))) {
        console.warn(`⚠️ [SSE DEDUPE] Omitiendo mensaje ya enviado: ${msgDedupeKey}`);
        return;
      }

      // Reusar la lógica de envío del polling
      const sendResult = await sendOutgoingMessage(msg);

      // SOLO marcar como enviado si el envío fue exitoso
      if (sendResult !== false) {
        markMsgAsSent(msgDedupeKey);
        if (msg.id) markMsgAsSent(msg.id);
      }

      // ACK al worker
      fetch(WORKER_SSE_ACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgId: msg.id, gatewayId: GATEWAY_ID })
      }).catch(() => {});
    } catch (err) {
      console.error('❌ [SSE] Error procesando mensaje:', err.message);
    }
  }

  // Asignar la referencia global para que handleSSEMessage y fetchPendingMessagesOnce la usen
  _processSsePendingMessage = processSsePendingMessage;

  // Polling adaptativo: solo cuando SSE está caído, con backoff exponencial
  // Cuando hay tráfico, SSE se mantiene solo. El polling es solo respaldo.
  let lastPollingTime = 0;
  let pollingInterval = 30000; // Empezar con 30s
  const MAX_POLL_INTERVAL = 300000; // Máximo 5 minutos

  setInterval(async () => {
    const now = Date.now();

    // Si SSE está conectado y activo, no hacer polling (ahorrar requests)
    if (sseConnection && (now - sseLastDataTime < 25000)) {
      pollingInterval = 30000; // Resetear a 30s cuando SSE vuelve
      return;
    }

    if (now - lastPollingTime < pollingInterval) return;
    lastPollingTime = now;

    try {
      const res = await fetch(WORKER_PENDING_URL);
      if (!res.ok) return;

      const data = await res.json();
      const messages = data.messages || [];

      if (messages.length > 0) {
        // Si hay mensajes, procesar y resetear intervalo
        pollingInterval = 30000;
        for (const msg of messages) {
          try {
            // DEDUPLICADOR PERSISTENTE EN DISCO (GATEWAY)
          const msgDedupeKey = msg.id || `${msg.remitente}_${msg.text}_${msg.pdfNombre || ''}`;
          if (persistentSentIds.has(msgDedupeKey) || (msg.id && persistentSentIds.has(msg.id))) {
            continue;
          }

          console.log(`🔄 [POLLING] Procesando mensaje pendiente: ${msgDedupeKey}`);
          const sendResult = await sendOutgoingMessage(msg);
          if (sendResult !== false) {
            markMsgAsSent(msgDedupeKey);
            if (msg.id) markMsgAsSent(msg.id);
          }
        } catch (sendErr) {
          console.error(`❌ Error procesando mensaje saliente:`, sendErr?.message || sendErr);
        }
      }
      } else {
        // Sin mensajes: aumentar intervalo progresivamente (ahorrar requests)
        pollingInterval = Math.min(pollingInterval * 2, MAX_POLL_INTERVAL);
      }
    } catch (pollErr) {
      // Ignorar errores temporales de red en el polling saliente
      pollingInterval = Math.min(pollingInterval * 2, MAX_POLL_INTERVAL);
    }
  }, 10000); // Tick cada 10s, pero el intervalo real lo controla pollingInterval

}

startWhatsAppGateway().catch((err) => {
  console.error('❌ Error fatal en WhatsApp Gateway:', err);
});
