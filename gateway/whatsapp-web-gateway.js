/**
 * CONECTOR WHATSAPP WEB PARA EL BOT DE LA CLÍNICA
 * 
 * Este script reenvía los mensajes entrantes de WhatsApp al Cloudflare Worker
 * y entrega las respuestas de la secretaría (texto y documentos PDF) al paciente de forma 100% automática.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const WORKER_BASE_URL = process.env.WORKER_URL ? process.env.WORKER_URL.replace('/webhook', '') : 'https://coatwa.emmanuel-ag92.workers.dev';
const WORKER_WEBHOOK_URL = `${WORKER_BASE_URL}/webhook`;

console.log('🚀 Iniciando Conector de WhatsApp Web...');
console.log(`🔗 Webhook apuntando a: ${WORKER_WEBHOOK_URL}\n`);

// Helper con reintentos automáticos para tolerar parpadeos de red o despliegues
async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 600) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ]
  }
});

// Set de control para evitar duplicados de mensajes
const processedMsgIds = new Set();

client.on('qr', (qr) => {
  console.log('📱 ESCANEA ESTE CÓDIGO QR CON EL WHATSAPP DE LA CLÍNICA:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('🔒 Sesión autenticada correctamente.');
});

client.on('ready', () => {
  console.log('✅ ¡WhatsApp Web Conectado y Listo para recibir y enviar mensajes!');
  console.log('📡 Servicio de entrega automática de respuestas de secretaría y adjuntos PDF ACTIVADO (Polling 3s)\n');
  
  // Iniciar polling de respuestas emitidas por las secretarias desde el Panel Web
  setInterval(pollSecretaryOutgoingMessages, 3000);
});

// Polling continuo de respuestas enviadas por secretarias desde admin.html
async function pollSecretaryOutgoingMessages() {
  try {
    const res = await fetchWithRetry(`${WORKER_BASE_URL}/api/pending-outgoing`, {}, 2, 400);
    if (!res || !res.ok) return;

    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length > 0) {
      console.log(`📬 [Secretaría] Encontrados ${messages.length} mensajes/documentos pendientes de entregar...`);
    }

    for (const item of messages) {
      if (item.remitente && (item.text || item.pdfBase64 || item.pdfUrl)) {
        try {
          let media = null;
          if (item.pdfBase64) {
            const cleanBase64 = item.pdfBase64.includes(',') ? item.pdfBase64.split(',')[1] : item.pdfBase64;
            media = new MessageMedia('application/pdf', cleanBase64, item.pdfNombre || 'Indicaciones.pdf');
          } else if (item.pdfUrl) {
            media = await MessageMedia.fromUrl(item.pdfUrl);
          }

          const chat = await client.getChatById(item.remitente);

          if (media) {
            await chat.sendMessage(media, { caption: item.text });
            console.log(`📄 [Secretaría] Documento PDF (${item.pdfNombre || 'Indicaciones.pdf'}) + Mensaje entregado a ${item.remitente}`);
          } else {
            await chat.sendMessage(item.text);
            console.log(`📤 [Secretaría] Respuesta entregada con éxito a ${item.remitente}: "${item.text.substring(0, 40)}..."`);
          }
        } catch (sendErr) {
          try {
            if (item.text) {
              await client.sendMessage(item.remitente, item.text);
            }
          } catch (err2) {
            console.error(`❌ Error al entregar mensaje de secretaría a ${item.remitente}:`, err2?.message || err2);
          }
        }
      }
    }
  } catch (err) {
    // Silencioso en reintentos de red
  }
}

// Extractor de Alta Definición HD (1080p / 4K) forzando apertura del chat en el motor de WhatsApp Web
async function extractImageBase64(msg) {
  const remitente = msg.from;
  const msgSerialized = msg.id ? (msg.id._serialized || msg.id.id) : null;

  // 1. Abrir activamente la conversación en el navegador Puppeteer para forzar a WhatsApp Web a descargar la foto HD original
  try {
    if (client.pupPage && msgSerialized) {
      await client.pupPage.evaluate(async (chatId, sId) => {
        try {
          const chat = window.Store.Chat.get(chatId);
          if (chat && window.Store.Cmd) {
            await window.Store.Cmd.openChatAt(chat);
          }
          const msgObj = window.Store.Msg.get(sId);
          if (msgObj && window.Store.MediaDownload) {
            await window.Store.MediaDownload.downloadMedia({ msg: msgObj, chat, type: 'manual' }).catch(() => {});
          }
        } catch (e) {}
      }, remitente, msgSerialized).catch(() => {});
    }
  } catch (e) {}

  // Esperar 1.5 segundos a que WhatsApp Web desencripte y cargue la foto HD en la sesión
  await new Promise(r => setTimeout(r, 1500));

  // 2. Extraer el blob HD desencriptado desde renderableUrl / fullUrl en Puppeteer
  try {
    if (client.pupPage && msgSerialized) {
      const fullBase64 = await client.pupPage.evaluate(async (sId) => {
        try {
          const msgObj = window.Store.Msg.get(sId);
          if (!msgObj) return null;

          // Esperar activamente si el mediaStage aún está descargando
          for (let i = 0; i < 15; i++) {
            if (msgObj.mediaData && (msgObj.mediaData.mediaStage === 'RESOLVED' || msgObj.mediaData.renderableUrl)) {
              break;
            }
            await new Promise(r => setTimeout(r, 200));
          }

          const blobUrl = msgObj.mediaData?.renderableUrl || msgObj.mediaData?.fullUrl;
          if (blobUrl) {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
          }
        } catch (err) {}
        return null;
      }, msgSerialized).catch(() => null);

      if (fullBase64 && fullBase64.length > 5000) {
        console.log(`📸 [HD Éxito Total] Foto original capturada en Alta Definición (${fullBase64.length} bytes base64)`);
        return fullBase64;
      }
    }
  } catch (e) {}

  // 3. Método oficial downloadMedia() de whatsapp-web.js
  try {
    const media = await msg.downloadMedia().catch((err) => {
      console.error('Error interno downloadMedia:', err?.message || err);
      return null;
    });
    if (media && media.data && media.data.length > 5000) {
      console.log(`📸 [HD WWebJS] Foto descargada mediante API oficial (${media.data.length} bytes)`);
      return `data:${media.mimetype || 'image/jpeg'};base64,${media.data}`;
    }
  } catch (e) {}

  // 4. Fallback de miniatura ligera de protocolo (Solo si falló la descarga HD)
  if (msg._data && msg._data.body) {
    const rawBody = msg._data.body;
    if (typeof rawBody === 'string' && rawBody.length > 50) {
      console.log('⚠️ [Miniatura] Se utilizó miniatura de respaldo (100px).');
      if (rawBody.startsWith('data:image/')) return rawBody;
      if (/^[A-Za-z0-9+/=]+$/.test(rawBody.replace(/[\r\n]/g, ''))) {
        const mime = (msg._data.mimetype || msg.mimetype || 'image/jpeg');
        return `data:${mime};base64,${rawBody}`;
      }
    }
  }

  return null;
}

// Manejar mensajes entrantes de pacientes
client.on('message', async (msg) => {
  if (msg.fromMe) return;

  if (msg.isGroupMsg || msg.from.includes('@g.us') || msg.from === 'status@broadcast') {
    return;
  }

  const msgUniqueId = msg.id ? (msg.id.id || msg.id._serialized) : null;
  if (msgUniqueId) {
    if (processedMsgIds.has(msgUniqueId)) return;
    processedMsgIds.add(msgUniqueId);
    if (processedMsgIds.size > 2000) processedMsgIds.clear();
  }

  const remitente = msg.from;
  const mensajeTexto = msg.body || '';

  console.log(`📩 Mensaje recibido de ${remitente}: "${mensajeTexto}"`);

  let imagenBase64 = null;
  let imagenNombre = null;

  if (msg.hasMedia || msg.type === 'image') {
    imagenBase64 = await extractImageBase64(msg);
    if (imagenBase64) {
      imagenNombre = `foto_${Date.now()}.jpg`;
    } else {
      console.warn(`⚠️ Foto recibida de ${remitente} (notificando imagen adjunta al panel).`);
      const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250"><rect width="400" height="250" fill="#1e293b"/><text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#34d399" font-size="18" font-weight="bold">Foto Adjunta de Pedido Medico</text><text x="50%" y="62%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-size="13">Recibido desde WhatsApp del paciente</text></svg>';
      imagenBase64 = `data:image/svg+xml;base64,${Buffer.from(svgStr).toString('base64')}`;
    }
  }

  try {
    const res = await fetchWithRetry(WORKER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        remitente,
        mensaje: mensajeTexto,
        imagenBase64,
        imagenNombre
      })
    }, 3, 600);

    if (!res.ok) {
      console.error(`❌ Error del Worker HTTP ${res.status}`);
      return;
    }

    const data = await res.json();

    if (data.respuesta) {
      await client.sendMessage(remitente, data.respuesta);
      console.log(`🤖 Respuesta del bot enviada a ${remitente}`);
    }
  } catch (err) {
    console.error('❌ Error de conexión con el Worker:', err?.message || err);
  }
});

client.initialize();
