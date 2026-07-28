/**
 * CONECTOR WHATSAPP WEB PARA EL BOT DE LA CLÍNICA
 * 
 * Este script se ejecuta en cualquier PC o servidor con Node.js.
 * Genera un código QR en pantalla para escanear con el teléfono de la clínica.
 * Reenvía los mensajes entrantes a tu Cloudflare Worker y responde automáticamente.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const WORKER_WEBHOOK_URL = process.env.WORKER_URL || 'https://coatwa.emmanuel-ag92.workers.dev/webhook';

console.log('🚀 Iniciando Conector de WhatsApp Web...');
console.log(`🔗 Webhook apuntando a: ${WORKER_WEBHOOK_URL}\n`);

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
  console.log('✅ ¡WhatsApp Web Conectado y Listo para recibir mensajes!\n');
});

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
    // Limpiar memoria de IDs procesados si supera los 2000
    if (processedMsgIds.size > 2000) processedMsgIds.clear();
  }

  const remitente = msg.from;
  const mensajeTexto = msg.body || '';

  console.log(`📩 Mensaje recibido de ${remitente}: "${mensajeTexto}"`);

  let imagenBase64 = null;
  let imagenNombre = null;

  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.mimetype && media.mimetype.startsWith('image/')) {
        imagenBase64 = `data:${media.mimetype};base64,${media.data}`;
        imagenNombre = media.filename || `foto_${Date.now()}.${media.mimetype.split('/')[1] || 'jpg'}`;
        console.log(`📷 Foto recibida de ${remitente}`);
      }
    } catch (err) {
      console.error('Error al descargar multimedia:', err);
    }
  }

  try {
    const res = await fetch(WORKER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        remitente,
        mensaje: mensajeTexto,
        imagenBase64,
        imagenNombre
      })
    });

    if (!res.ok) {
      console.error(`❌ Error del Worker HTTP ${res.status}`);
      return;
    }

    const data = await res.json();

    if (data.respuesta) {
      await client.sendMessage(remitente, data.respuesta);
      console.log(`🤖 Respuesta enviada a ${remitente}`);
    }
  } catch (err) {
    console.error('❌ Error de conexión con el Worker:', err);
  }
});

client.initialize();
