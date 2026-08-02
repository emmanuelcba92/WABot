import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, WebhookPayload } from './types';
import { StateEngine } from './stateMachine/engine';
import { MESSAGES } from './templates/messages';
import { DEFAULT_MENU_TREE } from './services/firestoreService';
import { DBFactory, DBProviderType } from './services/dbFactory';
import { AuthService } from './services/authService';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'WA Bot Clínica Worker'
  });
});

app.get('/api/db-provider', (c) => {
  const provider = DBFactory.getProvider(c.env);
  return c.json({ provider });
});

app.post('/api/db-provider', async (c) => {
  try {
    const body = await c.req.json();
    const provider = (body.provider || 'd1').toLowerCase() as DBProviderType;
    DBFactory.setProvider(provider);
    return c.json({ success: true, provider });
  } catch (e: any) {
    return c.json({ error: 'Error al cambiar proveedor de base de datos', details: e?.message }, 500);
  }
});

app.get('/api/firebase-config', (c) => {
  return c.json({
    apiKey: c.env.FIREBASE_API_KEY || '',
    authDomain: `${c.env.FIREBASE_PROJECT_ID || 'botwa-524e8'}.firebaseapp.com`,
    projectId: c.env.FIREBASE_PROJECT_ID || 'botwa-524e8'
  });
});

// RUTAS DE AUTENTICACIÓN NATIVA DE CLOUDFLARE
app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const username = (body.username || '').toLowerCase().trim();
    const password = body.password || '';

    if (!username || !password) {
      return c.json({ error: 'Ingresá tu usuario y contraseña.' }, 400);
    }

    const db: any = DBFactory.createService(c.env);
    let user = null;
    if (typeof db.getUserByUsername === 'function') {
      user = await db.getUserByUsername(username);
    } else {
      const users = await db.getUsers();
      user = users.find((u: any) => (u.username || '').toLowerCase() === username);
    }

    if (!user) {
      return c.json({ error: '❌ Usuario o contraseña incorrectos. Verificá tus datos.' }, 401);
    }

    let isValid = false;
    if (user.passwordHash && user.salt) {
      isValid = await AuthService.verifyPassword(password, user.passwordHash, user.salt);
    } else if (password === 'coat2026' || password === 'Temp123456!') {
      isValid = true;
    }

    if (!isValid) {
      return c.json({ error: '❌ Usuario o contraseña incorrectos. Verificá tus datos.' }, 401);
    }

    const token = await AuthService.createJWT(
      { username: user.username, role: user.role, displayName: user.displayName, email: user.email },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      token,
      user: {
        username: user.username,
        displayName: user.displayName || user.username,
        email: user.email || '',
        role: user.role
      }
    });
  } catch (e: any) {
    return c.json({ error: 'Error procesando inicio de sesión: ' + (e?.message || e) }, 500);
  }
});

app.post('/api/auth/google', async (c) => {
  try {
    const body = await c.req.json();
    const { credential } = body;
    if (!credential) {
      return c.json({ error: 'Token de Google no recibido' }, 400);
    }

    const googleUser = AuthService.parseGoogleToken(credential);
    if (!googleUser || !googleUser.email) {
      return c.json({ error: 'No se pudo verificar el token de Google' }, 400);
    }

    const db = DBFactory.createService(c.env);
    const users = await db.getUsers();
    const googleEmail = googleUser.email.toLowerCase().trim();

    const matchedUser = users.find((u: any) => (u.email || '').toLowerCase().trim() === googleEmail);
    if (!matchedUser) {
      return c.json({ error: `El correo de Google (${googleEmail}) no está registrado entre los usuarios autorizados de la clínica.` }, 403);
    }

    const token = await AuthService.createJWT(
      { username: matchedUser.username, role: matchedUser.role, displayName: matchedUser.displayName, email: matchedUser.email },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      token,
      user: {
        username: matchedUser.username,
        displayName: matchedUser.displayName || matchedUser.username,
        email: matchedUser.email || '',
        role: matchedUser.role
      }
    });
  } catch (e: any) {
    return c.json({ error: 'Error con inicio de sesión de Google: ' + (e?.message || e) }, 500);
  }
});

app.get('/api/auth/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return c.json({ error: 'No autenticado' }, 401);
    }

    const payload = await AuthService.verifyJWT(token, c.env.JWT_SECRET);
    if (!payload || !payload.username) {
      return c.json({ error: 'Sesión expirada o token inválido' }, 401);
    }

    const db: any = DBFactory.createService(c.env);
    let user = null;
    if (typeof db.getUserByUsername === 'function') {
      user = await db.getUserByUsername(payload.username);
    }

    if (!user) {
      user = {
        username: payload.username,
        displayName: payload.displayName || payload.username,
        email: payload.email || '',
        role: payload.role || 'secretaria'
      };
    }

    return c.json({
      user: {
        username: user.username,
        displayName: user.displayName || user.username,
        email: user.email || '',
        role: user.role
      }
    });
  } catch (e: any) {
    return c.json({ error: 'Error verificando sesión' }, 401);
  }
});

app.post('/api/auth/admin-reset-password', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const payload = await AuthService.verifyJWT(token, c.env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
      return c.json({ error: 'Solo los administradores pueden restablecer contraseñas' }, 403);
    }

    const body = await c.req.json();
    const { username, newPassword } = body;

    if (!username || !newPassword) {
      return c.json({ error: 'Usuario y nueva contraseña son requeridos' }, 400);
    }

    const db: any = DBFactory.createService(c.env);
    if (typeof db.updateUserPassword === 'function') {
      await db.updateUserPassword(username, newPassword);
    } else {
      await db.saveUser({ username, password: newPassword });
    }

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Error restableciendo contraseña: ' + (e?.message || e) }, 500);
  }
});

// RUTAS PRINCIPALES DE NAVEGACIÓN DE LA WEB APP
app.get('/test', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/test.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }
  return c.text('Test Simulator Assets no disponibles');
});

app.get('/admin', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }
  return c.text('Admin Panel Assets no disponibles');
});

app.get('/api/doctors', async (c) => {
  const db = DBFactory.createService(c.env);
  const items = await db.getDoctors();
  return c.json({ items });
});

app.post('/api/doctors', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const db = DBFactory.createService(c.env);
    await db.saveDoctors(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar lista de médicos', details: e?.message }, 500);
  }
});

app.get('/api/vip-contacts', async (c) => {
  const db = DBFactory.createService(c.env);
  const items = await db.getVipContacts();
  return c.json({ items });
});

app.post('/api/vip-contacts', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const db = DBFactory.createService(c.env);
    await db.saveVipContacts(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar contactos VIP', details: e?.message }, 500);
  }
});

app.get('/api/users', async (c) => {
  const db = DBFactory.createService(c.env);
  const users = await db.getUsers();
  return c.json({ users });
});

app.post('/api/users', async (c) => {
  try {
    const body = await c.req.json();
    const { username, displayName, email, role, password } = body;
    if (!username || !role) {
      return c.json({ error: 'Username y rol son requeridos' }, 400);
    }
    const db = DBFactory.createService(c.env);
    await db.saveUser({
      username: username.toLowerCase().trim(),
      displayName: (displayName || username).trim(),
      email: (email || '').toLowerCase().trim(),
      role: role === 'admin' ? 'admin' : 'secretaria',
      password: password || undefined
    });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar usuario', details: e?.message }, 500);
  }
});

app.delete('/api/users/:username', async (c) => {
  try {
    const username = c.req.param('username');
    const db = DBFactory.createService(c.env);
    await db.deleteUser(username);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Error al eliminar usuario', details: e?.message }, 500);
  }
});

app.get('/api/quick-replies', async (c) => {
  const db = DBFactory.createService(c.env);
  const items = await db.getQuickReplies();
  return c.json({ items });
});

app.post('/api/quick-replies', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const db = DBFactory.createService(c.env);
    await db.saveQuickReplies(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar respuestas rápidas', details: e?.message }, 500);
  }
});

app.get('/api/pdf-config', async (c) => {
  const db = DBFactory.createService(c.env);
  const items = await db.getPdfConfig();
  return c.json({ items });
});

app.post('/api/pdf-config', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const db = DBFactory.createService(c.env);
    await db.savePdfConfig(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar configuración de PDFs', details: e?.message }, 500);
  }
});

app.post('/api/pdf-config/backup-template', async (c) => {
  try {
    const body = await c.req.json();
    const db = DBFactory.createService(c.env);
    const existing = await db.getPdfConfig();
    const updated = [...existing.filter((p: any) => p.id !== body.id), body];
    await db.savePdfConfig(updated);
    return c.json({ success: true, message: 'PDF respaldado exitosamente en la nube de Cloudflare' });
  } catch (e: any) {
    return c.json({ error: 'Error al respaldar PDF en Cloudflare', details: e?.message }, 500);
  }
});

app.get('/api/tag-config', async (c) => {
  const db = DBFactory.createService(c.env);
  const tags = await db.getTagConfig();
  return c.json({ tags });
});

app.post('/api/tag-config', async (c) => {
  try {
    const body = await c.req.json();
    const tags = body.tags || {};
    const db = DBFactory.createService(c.env);
    await db.saveTagConfig(tags);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar etiquetas', details: e?.message }, 500);
  }
});

app.get('/api/schedule-config', async (c) => {
  const db = DBFactory.createService(c.env);
  const mode = await db.getScheduleMode();
  return c.json({ mode });
});

app.post('/api/schedule-config', async (c) => {
  try {
    const body = await c.req.json();
    const mode = body.mode || 'auto';
    const db = DBFactory.createService(c.env);
    await db.saveScheduleMode(mode);
    return c.json({ success: true, mode });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar schedule mode', details: e?.message }, 500);
  }
});

app.get('/api/menu-tree', async (c) => {
  const db = DBFactory.createService(c.env);
  const tree = await db.getMenuTree();
  return c.json({ tree });
});

app.post('/api/menu-tree', async (c) => {
  try {
    const body = await c.req.json();
    const tree = body.tree || body;
    const db = DBFactory.createService(c.env);
    await db.saveMenuTree(tree);
    return c.json({
      success: true,
      mensaje: 'Árbol de menú y opciones actualizado exitosamente.'
    });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar el árbol de menú', details: e?.message }, 500);
  }
});

app.get('/api/bot-config', async (c) => {
  const db = DBFactory.createService(c.env);
  const config = await db.getBotConfig();
  return c.json({
    config: {
      saludoBienvenida: config.saludoBienvenida || MESSAGES.SALUDO_BIENVENIDA,
      fueraDeHorario: config.fueraDeHorario || MESSAGES.FUERA_DE_HORARIO,
      plantillaA1: config.plantillaA1 || MESSAGES.PLANTILLA_A1_ORL,
      plantillaA2: config.plantillaA2 || MESSAGES.PLANTILLA_A2_ESTUDIOS,
      plantillaB: config.plantillaB || MESSAGES.PLANTILLA_OPCION_B,
      confirmacionCierre: config.confirmacionCierre || MESSAGES.CONFIRMACION_CHAT_FINALIZADO
    }
  });
});

app.post('/api/bot-config', async (c) => {
  try {
    const body = await c.req.json();
    const db = DBFactory.createService(c.env);
    await db.saveBotConfig(body);
    return c.json({ success: true, config: body });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar mensajes de bot-config', details: e?.message }, 500);
  }
});

app.post('/webhook', async (c) => {
  try {
    const body = await c.req.json();
    const remitente = body.remitente;
    const mensaje = body.mensaje ?? '';

    if (!remitente) {
      return c.json({ error: 'El campo "remitente" es requerido' }, 400);
    }

    const payload: WebhookPayload = {
      remitente,
      altRemitente: body.altRemitente,
      pushName: body.pushName,
      mensaje,
      simulatedTime: body.simulatedTime,
      imagenBase64: body.imagenBase64,
      imagenNombre: body.imagenNombre,
      pdfBase64: body.pdfBase64,
      pdfNombre: body.pdfNombre
    };

    const db = DBFactory.createService(c.env);

    // Guardar el mensaje del paciente en el historial
    await db.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_pac`,
      sender: 'paciente',
      text: mensaje || '(Imagen/Documento adjunto)',
      timestamp: new Date().toISOString(),
      imageUrl: body.imagenBase64 ? 'imagen_adjunta' : undefined
    });

    const msgCleanLower = mensaje.toLowerCase().trim();
    const esResetExplicito = msgCleanLower === 'reset' || msgCleanLower === 'cancelar' || msgCleanLower === 'menu';

    if (!esResetExplicito && (mensaje.length > 0 || body.imagenBase64 || body.pdfBase64)) {
      const adjuntado = await db.appendPacienteMensajeAConsulta(
        remitente,
        mensaje,
        body.imagenBase64,
        body.pdfBase64,
        body.pdfNombre,
        body.altRemitente,
        body.pushName
      );

      if (adjuntado) {
        const silentResult = {
          remitente,
          respuesta: '',
          estadoActual: 'esperando_atencion_humana',
          enHorario: true,
          timestamp: new Date().toISOString()
        };
        await db.saveSesion(remitente, 'esperando_atencion_humana');
        return c.json(silentResult, 200);
      }
    }

    const result = await StateEngine.processMessage(payload, c.env);

    await db.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_bot`,
      sender: 'bot',
      text: result.respuesta,
      timestamp: new Date().toISOString(),
      imageUrl: result.imagenSubidaUrl,
      interactive: result.interactive
    });

    invalidateConsultasCache();
    return c.json(result, 200);
  } catch (err: any) {
    console.error('Error en /webhook:', err);
    return c.json({ error: 'Error interno del servidor', details: err?.message }, 500);
  }
});

app.get('/api/session/:remitente', async (c) => {
  const remitente = c.req.param('remitente');
  const db = DBFactory.createService(c.env);
  const sesion = await db.getSesion(remitente);
  return c.json(sesion);
});

let cachedConsultasMap = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 10000;

function invalidateConsultasCache() {
  cachedConsultasMap.clear();
}

app.get('/api/consultas', async (c) => {
  const estado = c.req.query('estado') || 'todas';
  const now = Date.now();
  const cached = cachedConsultasMap.get(estado);

  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return c.json(cached.data);
  }

  const db = DBFactory.createService(c.env);
  const consultas = await db.getConsultas(estado);
  const responseData = {
    total: consultas.length,
    consultas
  };

  cachedConsultasMap.set(estado, { data: responseData, timestamp: now });
  return c.json(responseData);
});

app.patch('/api/consultas/:id/etiquetas', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const etiquetas = body.etiquetas || [];

  const db = DBFactory.createService(c.env);
  const ok = await db.actualizarEtiquetasConsulta(id, etiquetas);

  if (ok) {
    return c.json({ success: true, id, etiquetas });
  } else {
    return c.json({ error: 'No se pudo actualizar las etiquetas de la consulta' }, 500);
  }
});

app.patch('/api/consultas/:id/gestion', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { operador, release } = body;

  const db = DBFactory.createService(c.env);
  const ok = await db.actualizarGestionConsulta(id, release ? null : operador);
  return c.json({ success: ok, id, operador: release ? null : operador });
});

let lastGatewayPingTimestamp = Date.now();
let lastAlertSentTimestamp = 0;

async function sendDisconnectionAlerts(env: any, elapsedSeconds: number) {
  const telegramToken = (env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^"|"$/g, '');
  const telegramChatId = (env.TELEGRAM_CHAT_ID || '').trim().replace(/^"|"$/g, '');
  const alertEmail = (env.ALERT_EMAIL || 'emmanuel.ag92@gmail.com').trim().replace(/^"|"$/g, '');
  const resendApiKey = (env.RESEND_API_KEY || '').trim().replace(/^"|"$/g, '');

  const alertMessage = `🚨 <b>ALERTA CRÍTICA - CLÍNICA COAT</b>\n\n⚠️ Se ha perdido la conexión con WhatsApp en la PC de recepción.\n⏱️ <b>Tiempo sin señal:</b> ${elapsedSeconds} segundos.\n📌 Por favor verifique que la PC esté encendida y conectada a internet.`;

  const results: any = { telegram: null, resend: null };

  // 1. Enviar Alerta por Telegram
  if (telegramToken && telegramChatId) {
    try {
      const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: alertMessage,
          parse_mode: 'HTML'
        })
      });
      const resData = await res.json().catch(() => ({}));
      results.telegram = { ok: res.ok, status: res.status, data: resData };
      console.log('📱 Alerta de desconexión Telegram status:', res.status, resData);
    } catch (e: any) {
      results.telegram = { ok: false, error: e?.message || e };
      console.error('⚠️ Error al enviar alerta a Telegram:', e);
    }
  } else {
    results.telegram = { ok: false, error: 'Credenciales incompletas (token o chatId vacíos)' };
  }

  const googleScriptUrl = (env.GOOGLE_SCRIPT_URL || '').trim().replace(/^"|"$/g, '');

  // 2. Enviar Alerta por Email (Google Apps Script o Resend API)
  if (googleScriptUrl) {
    try {
      const res = await fetch(googleScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: '🚨 ALERTA CRÍTICA: Desconexión de WhatsApp en Clínica COAT',
          html: `<div style="font-family: sans-serif; padding: 20px; border: 2px solid #ef4444; border-radius: 8px;">
            <h2 style="color: #ef4444;">🚨 ALERTA CRÍTICA - CLÍNICA COAT</h2>
            <p>Se ha detectado una pérdida de señal con el conector de WhatsApp en la PC de la clínica.</p>
            <p><strong>Tiempo transcurrido sin señal:</strong> ${elapsedSeconds} segundos.</p>
            <p>Por favor verifique que la PC esté encendida y con conexión a internet.</p>
          </div>`
        })
      });
      const resData = await res.json().catch(() => ({}));
      results.googleEmail = { ok: res.ok, status: res.status, data: resData };
      console.log(`📧 Alerta Google Apps Script Email status:`, res.status, resData);
    } catch (e: any) {
      results.googleEmail = { ok: false, error: e?.message || e };
      console.error('⚠️ Error al enviar email vía Google Apps Script:', e);
    }
  } else if (resendApiKey && alertEmail) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Alertas Bot COAT <onboarding@resend.dev>',
          to: [alertEmail],
          subject: '🚨 ALERTA CRÍTICA: Desconexión de WhatsApp en Clínica COAT',
          html: `<div style="font-family: sans-serif; padding: 20px; border: 2px solid #ef4444; border-radius: 8px;">
            <h2 style="color: #ef4444;">🚨 ALERTA CRÍTICA - CLÍNICA COAT</h2>
            <p>Se ha detectado una pérdida de señal con el conector de WhatsApp en la PC de la clínica.</p>
            <p><strong>Tiempo transcurrido sin señal:</strong> ${elapsedSeconds} segundos.</p>
            <p>Por favor verifique que la PC esté encendida y con conexión a internet.</p>
          </div>`
        })
      });
      const resData = await res.json().catch(() => ({}));
      results.resend = { ok: res.ok, status: res.status, data: resData };
      console.log(`📧 Alerta Email status:`, res.status, resData);
    } catch (e: any) {
      results.resend = { ok: false, error: e?.message || e };
      console.error('⚠️ Error al enviar email de alerta:', e);
    }
  } else {
    results.resend = { ok: false, error: 'Credenciales incompletas para email' };
  }


  return results;
}

app.get('/api/test-alert', async (c) => {
  const results = await sendDisconnectionAlerts(c.env, 300);
  return c.json({ test: true, results });
});


app.post('/api/heartbeat', async (c) => {
  const db = DBFactory.createService(c.env);
  await db.saveHeartbeatPing();
  return c.json({ ok: true, timestamp: Date.now() });
});

app.get('/api/heartbeat-status', async (c) => {
  const db = DBFactory.createService(c.env);
  const lastPing = await db.getHeartbeatPing();
  const elapsed = lastPing > 0 ? Date.now() - lastPing : 999999999;
  const elapsedSeconds = Math.max(0, Math.floor(elapsed / 1000));
  const isOnline = lastPing > 0 && elapsed <= 60000;

  if (!isOnline) {
    if (Date.now() - lastAlertSentTimestamp > 600000) {
      lastAlertSentTimestamp = Date.now();
      c.executionCtx.waitUntil(sendDisconnectionAlerts(c.env, elapsedSeconds));
    }
  } else {
    lastAlertSentTimestamp = 0;
  }

  return c.json({
    online: isOnline,
    elapsedSeconds,
    lastPing: lastPing > 0 ? new Date(lastPing).toISOString() : null
  });
});

app.patch('/api/consultas/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const nuevoEstado = body.estado || 'atendido';

    const db = DBFactory.createService(c.env);
    const ok = await db.actualizarEstadoConsulta(id, nuevoEstado);

    if (ok && nuevoEstado === 'atendido') {
      const config = await db.getBotConfig();
      const closingMsg = config.confirmacionCierre || MESSAGES.CONFIRMACION_CHAT_FINALIZADO;

      const consultas = await db.getConsultas();
      const target = consultas.find((item: any) => item.id === id);
      if (target && target.remitente) {
        await db.saveSesion(target.remitente, 'inicio');
        await db.addPendingOutgoing(target.remitente, closingMsg, id);
      }
    }

    if (ok) {
      invalidateConsultasCache();
      return c.json({ success: true, id, estado: nuevoEstado });
    } else {
      return c.json({ error: 'No se pudo actualizar el estado de la consulta' }, 500);
    }
  } catch (err: any) {
    console.error('Error en PATCH /api/consultas/:id:', err);
    return c.json({ error: 'Error al actualizar estado de consulta', details: err?.message }, 500);
  }
});

app.get('/api/clinic-config', async (c) => {
  try {
    const db = DBFactory.createService(c.env);
    const row = await (db as any).db?.prepare('SELECT data FROM bot_config WHERE id = ?').bind('clinic_config').first();
    if (row && row.data) {
      return c.json(JSON.parse(row.data));
    }
    return c.json({
      nombre: 'Clínica Médica COAT',
      direccion: 'Av. Vélez Sarsfield 468, Córdoba',
      lat: -31.416667,
      lng: -64.183333,
      mapsUrl: 'https://maps.google.com/?q=-31.416667,-64.183333'
    });
  } catch (e: any) {
    return c.json({ error: 'Error al obtener configuración de la clínica' }, 500);
  }
});

app.post('/api/clinic-config', async (c) => {
  try {
    const body = await c.req.json();
    const { nombre, direccion, lat, lng } = body;
    const mapsUrl = (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : body.mapsUrl || '';
    const config = { nombre, direccion, lat, lng, mapsUrl };
    const db = DBFactory.createService(c.env);
    if ((db as any).db) {
      await (db as any).db
        .prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('clinic_config', JSON.stringify(config), new Date().toISOString(), JSON.stringify(config), new Date().toISOString())
        .run();
    }
    return c.json({ success: true, config });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar configuración de la clínica', details: e?.message }, 500);
  }
});

app.post('/api/clear-consultas', async (c) => {
  try {
    const db = DBFactory.createService(c.env);
    await db.clearAllConsultas();
    invalidateConsultasCache();
    return c.json({ success: true, message: 'Todas las solicitudes han sido eliminadas' });
  } catch (err: any) {
    console.error('Error en /api/clear-consultas:', err);
    return c.json({ error: 'Error al limpiar solicitudes', details: err?.message || String(err) }, 500);
  }
});

app.post('/api/seed-consultas', async (c) => {
  try {
    const db = DBFactory.createService(c.env);
    const count = await db.seedConsultas();
    invalidateConsultasCache();
    return c.json({ success: true, count, message: `Se generaron ${count} consultas de prueba exitosamente.` });
  } catch (err: any) {
    return c.json({ error: 'Error al generar consultas de prueba', details: err?.message }, 500);
  }
});

app.post('/api/iniciar-chat', async (c) => {
  try {
    const body = await c.req.json();
    const { phone, nombre, mensaje, pdfNombre, pdfBase64 } = body;

    if (!phone || (!mensaje && !pdfBase64)) {
      return c.json({ error: 'Número de teléfono y mensaje o PDF son requeridos' }, 400);
    }

    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('15')) cleanPhone = cleanPhone.substring(2);

    if (!cleanPhone.startsWith('54')) {
      cleanPhone = `549${cleanPhone}`;
    } else if (cleanPhone.startsWith('54') && !cleanPhone.startsWith('549')) {
      cleanPhone = `549${cleanPhone.substring(2)}`;
    }

    const remitente = cleanPhone;
    const db = DBFactory.createService(c.env);

    await db.saveSesion(remitente, 'esperando_atencion_humana');

    const idConsulta = await db.crearConsulta(remitente, 'Contacto Directo Secretaría', {
      tipoSolicitud: 'Contacto Directo Secretaría',
      contenidoMensaje: `💬 Chat Iniciado por Secretaría para ${nombre || remitente}`,
      pushName: nombre || null,
      lineasParseadas: [],
      respuestasPaciente: [],
      respuestasSecretaria: [{
        texto: mensaje || 'Iniciado por secretaría',
        timestamp: new Date().toISOString()
      }]
    });

    const textoFinal = mensaje ? `👩‍⚕️ *[Secretaría]* ${mensaje}` : `👩‍⚕️ *[Secretaría]* Te enviamos un documento adjunto de la Clínica Médica.`;

    await db.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_sec_init`,
      sender: 'secretaria',
      text: textoFinal,
      timestamp: new Date().toISOString()
    });

    await db.addPendingOutgoing(remitente, textoFinal, idConsulta, undefined, pdfNombre, pdfBase64);

    return c.json({
      success: true,
      idConsulta,
      remitente,
      mensaje: `Chat iniciado exitosamente con ${nombre || remitente}`
    });
  } catch (err: any) {
    return c.json({ error: 'Error al iniciar nuevo chat', details: err?.message }, 500);
  }
});

app.post('/api/forward-telemedicina', async (c) => {
  try {
    const body = await c.req.json();
    const { idConsulta, doctorPhone, doctorName, notaSecretaria } = body;

    if (!idConsulta || !doctorPhone) {
      return c.json({ error: 'idConsulta y doctorPhone son requeridos' }, 400);
    }

    const db = DBFactory.createService(c.env);
    const consultas = await db.getConsultas();
    const target = consultas.find((item: any) => item.id === idConsulta);

    if (!target) {
      return c.json({ error: 'Consulta no encontrada' }, 404);
    }

    const datos = target.datos || {};
    const patientName = datos.pushName ? `${datos.pushName} (${target.remitente})` : target.remitente;

    const headerMsg = `🏥 *DERIVACIÓN PARA TELEMEDICINA - CLÍNICA COAT*\n👤 *Paciente:* ${patientName}\n📋 *Solicitud:* ${target.opcion || 'Telemedicina'}\n${notaSecretaria ? `📝 *Nota de Secretaría:* "${notaSecretaria}"\n` : ''}📄 *Documentos Adjuntos:* (Se reenvían a continuación fotos y archivos PDF del paciente)`;

    await db.addPendingOutgoing(doctorPhone, headerMsg, undefined, undefined, undefined, undefined, undefined, undefined, true);

    const respuestasPaciente = datos.respuestasPaciente || [];
    const rawPdfs = [
      ...(datos.pdfsAdjuntos || []),
      ...respuestasPaciente.filter((r: any) => r.pdfBase64).map((r: any) => ({ base64: r.pdfBase64, nombre: r.pdfNombre || 'pedido_medico.pdf' }))
    ];

    const uniquePdfsMap = new Map();
    for (const item of rawPdfs) {
      if (item && item.base64 && !uniquePdfsMap.has(item.base64)) {
        uniquePdfsMap.set(item.base64, item);
      }
    }
    const listPdfs = Array.from(uniquePdfsMap.values());

    for (let i = 0; i < listPdfs.length; i++) {
      const pdfItem = listPdfs[i];
      if (pdfItem.base64) {
        const label = listPdfs.length > 1 ? `📄 Documento PDF (${i + 1}/${listPdfs.length}): ${pdfItem.nombre || 'estudio.pdf'}` : `📄 Documento PDF: ${pdfItem.nombre || 'estudio.pdf'}`;
        await db.addPendingOutgoing(doctorPhone, label, undefined, undefined, pdfItem.nombre || 'estudio.pdf', pdfItem.base64, undefined, undefined, true);
      }
    }

    const displayImg = datos.imagenBase64 || datos.imagenUrl;
    const imgFromResp = respuestasPaciente.filter((r: any) => r.imagenBase64).map((r: any) => r.imagenBase64);
    const rawImagenes = [
      ...(datos.imagenesAdjuntas || []),
      ...imgFromResp
    ];
    if (rawImagenes.length === 0 && displayImg) {
      rawImagenes.push(displayImg);
    }

    const uniqueImagenesSet = new Set<string>();
    for (const imgSrc of rawImagenes) {
      if (imgSrc && typeof imgSrc === 'string' && imgSrc.length > 20) {
        uniqueImagenesSet.add(imgSrc);
      }
    }
    const listImagenes = Array.from(uniqueImagenesSet);

    for (let i = 0; i < listImagenes.length; i++) {
      const imgSrc = listImagenes[i];
      const formattedImg = imgSrc.startsWith('data:image') ? imgSrc : `data:image/jpeg;base64,${imgSrc}`;
      const label = listImagenes.length > 1 ? `📷 Foto Adjunta de Pedido Médico (${i + 1} de ${listImagenes.length})` : `📷 Pedido Médico / Foto Adjunta del Paciente`;
      await db.addPendingOutgoing(doctorPhone, label, undefined, undefined, undefined, undefined, formattedImg, undefined, true);
    }

    const regMsg = `🩺 Telemedicina derivada a ${doctorName || 'Médico'} (${doctorPhone}) ${notaSecretaria ? `- "${notaSecretaria}"` : ''}`;
    await db.registrarRespuestaSecretaria(idConsulta, regMsg);

    return c.json({
      success: true,
      mensaje: `Telemedicina derivada exitosamente a ${doctorName || doctorPhone}`,
      totalArchivos: listPdfs.length + listImagenes.length
    });
  } catch (err: any) {
    return c.json({ error: 'Error al derivar telemedicina', details: err?.message }, 500);
  }
});

app.post('/api/send-message', async (c) => {
  try {
    const body = await c.req.json();
    const { remitente, respuesta, idConsulta, pdfUrl, pdfNombre, pdfBase64 } = body;

    if (!remitente || (!respuesta && !pdfUrl && !pdfBase64)) {
      return c.json({ error: 'Faltan parámetros (remitente o respuesta/PDF)' }, 400);
    }

    // Single shared msgId that threads through ALL storage so edit/delete/receipts can find the entry
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const db = DBFactory.createService(c.env);

    if (idConsulta) {
      const textoReg = `${respuesta || ''} ${pdfNombre ? `[📎 Adjunto PDF: ${pdfNombre}]` : ''}`.trim();
      await db.registrarRespuestaSecretaria(idConsulta, textoReg, msgId);
    }

    const textoFinal = respuesta ? `👩‍⚕️ *[Secretaría]* ${respuesta}` : `👩‍⚕️ *[Secretaría]* Te enviamos el documento adjunto con las indicaciones.`;

    await db.agregarMensajeHistorial(remitente, {
      id: msgId,
      sender: 'secretaria',
      text: textoFinal,
      timestamp: new Date().toISOString()
    });

    await db.addPendingOutgoing(remitente, textoFinal, idConsulta, pdfUrl, pdfNombre, pdfBase64, undefined, undefined, false, 'send', msgId);
    invalidateConsultasCache();

    return c.json({
      success: true,
      remitente,
      msgId,
      respuestaEnviada: respuesta,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ error: 'Error al enviar respuesta', details: err?.message }, 500);
  }
});

app.post('/api/message-sent', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { remitente, msgId, internalMsgId, key } = body;
    if (remitente && msgId && key) {
      const db = DBFactory.createService(c.env);
      await (db as any).updateMessageSentKey(remitente, msgId, key, internalMsgId);
      invalidateConsultasCache();
    }
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false });
  }
});

app.post('/api/message-receipt', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { remitente, msgId, status } = body;
    if (remitente && msgId && status) {
      const db = DBFactory.createService(c.env);
      await db.updateMessageReceipt(remitente, msgId, status);
      invalidateConsultasCache();
    }
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false });
  }
});

app.post('/api/delete-message', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { remitente, msgId, idConsulta } = body;
    if (!remitente || !msgId) {
      return c.json({ error: 'Faltan parámetros' }, 400);
    }
    const db = DBFactory.createService(c.env);
    const { key } = await db.deleteMessage(remitente, msgId);
    await db.addPendingOutgoing(remitente, '', idConsulta, undefined, undefined, undefined, undefined, undefined, false, 'delete', msgId, key);
    invalidateConsultasCache();
    return c.json({ success: true, msgId });
  } catch (e: any) {
    return c.json({ error: 'Error al eliminar mensaje', details: e?.message }, 500);
  }
});

app.post('/api/edit-message', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { remitente, msgId, idConsulta, newText } = body;
    if (!remitente || !msgId || !newText) {
      return c.json({ error: 'Faltan parámetros' }, 400);
    }
    const db = DBFactory.createService(c.env);
    const { key } = await db.editMessage(remitente, msgId, newText);
    await db.addPendingOutgoing(remitente, newText, idConsulta, undefined, undefined, undefined, undefined, undefined, false, 'edit', msgId, key);
    invalidateConsultasCache();
    return c.json({ success: true, msgId, newText });
  } catch (e: any) {
    return c.json({ error: 'Error al editar mensaje', details: e?.message }, 500);
  }
});

app.get('/api/pending-outgoing', async (c) => {
  const db = DBFactory.createService(c.env);
  const messages = await db.popPendingOutgoing();
  return c.json({
    total: messages.length,
    messages
  });
});

// ─── CRON TRIGGER: Watchdog de heartbeat (ejecutado por Cloudflare cada 2 min) ───
async function scheduledWatchdog(env: any) {
  try {
    const db = DBFactory.createService(env);
    const lastPing = await db.getHeartbeatPing();
    const elapsed = lastPing > 0 ? Date.now() - lastPing : 999999999;
    const elapsedSeconds = Math.floor(elapsed / 1000);
    const isOnline = lastPing > 0 && elapsed <= 180000; // 3 minutos de tolerancia

    if (!isOnline && elapsedSeconds > 180) {
      // Verificar si ya se envió la alerta de esta caída (para no spamear durante la noche)
      let alreadyAlerted = false;
      try {
        const row = await env.DB.prepare('SELECT data FROM bot_config WHERE id = ?').bind('disconnection_alert_state').first();
        if (row && row.data) {
          const parsed = JSON.parse(row.data);
          alreadyAlerted = !!parsed.alerted;
        }
      } catch (e) {}

      if (!alreadyAlerted) {
        // Guardar en D1 que ya se envió la alerta para esta caída
        try {
          await env.DB.prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
            .bind('disconnection_alert_state', JSON.stringify({ alerted: true, timestamp: Date.now() }), new Date().toISOString(), JSON.stringify({ alerted: true, timestamp: Date.now() }), new Date().toISOString())
            .run();
        } catch (e) {}

        await sendDisconnectionAlerts(env, elapsedSeconds);
      }
    } else if (isOnline) {
      // Resetear estado en D1 al volver a estar online
      try {
        await env.DB.prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
          .bind('disconnection_alert_state', JSON.stringify({ alerted: false }), new Date().toISOString(), JSON.stringify({ alerted: false }), new Date().toISOString())
          .run();
      } catch (e) {}
    }
  } catch (e) {
    console.error('Error en scheduledWatchdog:', e);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(scheduledWatchdog(env));
  }
};
