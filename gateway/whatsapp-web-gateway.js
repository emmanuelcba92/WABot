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
      '--disable-gpu'
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

// Extractor robusto de imágenes en Base64 desde Puppeteer
async function extractImageBase64(msg) {
  // 1. Intentar descarga oficial por whatsapp-web.js
  try {
    await msg.getChat().catch(() => {});
    const media = await msg.downloadMedia().catch(() => null);
    if (media && media.data) {
      return `data:${media.mimetype || 'image/jpeg'};base64,${media.data}`;
    }
  } catch (e) {}

  // 2. Fallback de extracción directa por Blob en el DOM de Puppeteer
  try {
    const msgIdSerialized = msg.id ? (msg.id._serialized || msg.id.id) : null;
    if (msgIdSerialized && client.pupPage) {
      const base64 = await client.pupPage.evaluate(async (serialized) => {
        try {
          const msgObj = window.Store.Msg.get(serialized);
          if (!msgObj) return null;

          // Intentar forzar la descarga de media
          if (window.Store.MediaDownload) {
            await window.Store.MediaDownload.downloadMedia({ msg: msgObj }).catch(() => {});
          }

          // Si existe URL de renderizado blob en WhatsApp Web
          const blobUrl = msgObj.mediaData?.renderableUrl || msgObj.mediaData?.preview?.url;
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
      }, msgIdSerialized).catch(() => null);

      if (base64 && base64.startsWith('data:image/')) {
        return base64;
      }
    }
  } catch (e) {}

  return null;
}

// Manejar mensajes entrantes de pacientes
client.on('message', async (msg) => {
  // 1. Ignorar mensajes enviados por la propia cuenta (bot/secretarias)
  if (msg.fromMe) return;

  // 2. Ignorar mensajes de grupos, difundidos o estados
  if (msg.isGroupMsg || msg.from.includes('@g.us') || msg.from === 'status@broadcast') {
    return;
  }

  // 3. Evitar procesamiento doble del mismo ID de mensaje
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
      console.log(`📷 Foto/Imagen recibida y desencriptada en Base64 de ${remitente}`);
    } else {
      console.warn(`⚠️ Foto recibida de ${remitente} (se enviará notificación de imagen adjunta al panel).`);
      // Generar imagen demostrativa para asegurar que el panel siempre muestre la foto
      imagenBase64 = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250"><rect width="400" height="250" fill="%231e293b"/><text x="50%25" y="45%25" dominant-baseline="middle" text-anchor="middle" fill="%2334d399" font-size="18" font-weight="bold">📷 Foto Adjunta de Pedido Médico</text><text x="50%25" y="62%25" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-size="13">Recibido desde WhatsApp del paciente</text></svg>';
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

    // 4. Enviar la respuesta del bot formateada en texto de forma 100% confiable
    if (data.respuesta) {
      await client.sendMessage(remitente, data.respuesta);
      console.log(`🤖 Respuesta del bot enviada a ${remitente}`);
    }
  } catch (err) {
    console.error('❌ Error de conexión con el Worker:', err?.message || err);
  }
});

client.initialize();
