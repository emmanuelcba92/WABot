/**
 * CONECTOR WHATSAPP WEB PARA EL BOT DE LA CLÍNICA
 * Con soporte para Menús Interactivos Nativos (Listas y Botones)
 */

const { Client, LocalAuth, List, Buttons } = require('whatsapp-web.js');
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

// Helper para convertir el payload interactivo de Cloudflare Worker a objetos nativos de whatsapp-web.js
function createWWebJSInteractive(interactive) {
  if (!interactive) return null;

  try {
    if (interactive.type === 'list') {
      const sections = (interactive.sections || []).map(sec => ({
        title: sec.title || 'Opciones',
        rows: (sec.rows || []).map(r => ({
          id: r.id,
          title: r.title.substring(0, 24), // Límite de 24 caracteres en WA
          description: (r.description || '').substring(0, 72)
        }))
      }));

      return new List(
        interactive.bodyText || 'Seleccioná una opción:',
        interactive.buttonLabel || '📋 Ver Opciones',
        sections,
        '🏥 Clínica Médica',
        'Tocá para desplegar el menú'
      );
    }

    if (interactive.type === 'button') {
      const formattedButtons = (interactive.buttons || []).map(b => ({
        id: b.id,
        body: `${b.emoji || ''} ${b.title}`.trim().substring(0, 20) // Límite de 20 caracteres en botones WA
      }));

      return new Buttons(
        interactive.bodyText || 'Seleccioná una opción:',
        formattedButtons,
        '🏥 Clínica Médica',
        'Tocá una opción'
      );
    }
  } catch (e) {
    console.error('Error al construir objeto interactivo:', e);
  }

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

    // 4. Si el Worker devuelve un menú interactivo, intentar enviarlo como objeto List/Buttons nativo
    let enviadoInteractivo = false;
    if (data.interactive) {
      try {
        const interactiveObj = createWWebJSInteractive(data.interactive);
        if (interactiveObj) {
          await client.sendMessage(remitente, interactiveObj);
          console.log(`🤖 Respuesta interactiva (${data.interactive.type}) enviada a ${remitente}`);
          enviadoInteractivo = true;
        }
      } catch (err) {
        console.warn('⚠️ No se pudo enviar como objeto interactivo nativo, enviando texto formateado:', err);
      }
    }

    // 5. Fallback a texto si no había objeto interactivo o si falló el envio nativo
    if (!enviadoInteractivo && data.respuesta) {
      await client.sendMessage(remitente, data.respuesta);
      console.log(`🤖 Respuesta de texto enviada a ${remitente}`);
    }
  } catch (err) {
    console.error('❌ Error de conexión con el Worker:', err);
  }
});

client.initialize();
