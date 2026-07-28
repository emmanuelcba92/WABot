import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, WebhookPayload } from './types';
import { StateEngine } from './stateMachine/engine';
import { ScheduleService } from './services/scheduleService';
import { FirestoreService } from './services/firestoreService';

const app = new Hono<{ Bindings: Env }>();

// Habilitar CORS para permitir acceso desde cualquier navegador
app.use('*', cors());

// Endpoint de prueba de salud
app.get('/api/status', (c) => {
  const schedule = ScheduleService.isWithinBusinessHours();
  return c.json({
    status: 'ok',
    service: 'WA Bot Backend - Clínica Médica',
    platform: 'Cloudflare Worker',
    scheduleInfo: schedule
  });
});

/**
 * ENDPOINT PRINCIPAL POST /webhook
 * Recibe: { remitente: string, mensaje: string, simulatedTime?: string, imagenBase64?: string }
 */
app.post('/webhook', async (c) => {
  try {
    let body: Partial<WebhookPayload>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'JSON payload inválido. Se espera { remitente, mensaje }' }, 400);
    }

    const remitente = body.remitente?.trim();
    const mensaje = body.mensaje ?? '';

    if (!remitente) {
      return c.json({ error: 'El campo "remitente" es requerido (ej: "+5491112345678")' }, 400);
    }

    const payload: WebhookPayload = {
      remitente,
      mensaje,
      simulatedTime: body.simulatedTime,
      imagenBase64: body.imagenBase64,
      imagenNombre: body.imagenNombre
    };

    const result = await StateEngine.processMessage(payload, c.env);
    return c.json(result, 200);
  } catch (err: any) {
    console.error('Error en /webhook:', err);
    return c.json({ error: 'Error interno del servidor', details: err?.message }, 500);
  }
});

/**
 * ENDPOINT GET /api/session/:remitente
 */
app.get('/api/session/:remitente', async (c) => {
  const remitente = c.req.param('remitente');
  const firestore = new FirestoreService(c.env);
  const sesion = await firestore.getSesion(remitente);
  return c.json(sesion);
});

/**
 * ENDPOINT GET /api/consultas
 * Permite listar todas las consultas recibidas para el Panel de Secretarias
 */
app.get('/api/consultas', async (c) => {
  const firestore = new FirestoreService(c.env);
  const consultas = await firestore.getConsultas();
  return c.json({
    total: consultas.length,
    consultas
  });
});

/**
 * ENDPOINT PATCH /api/consultas/:id
 * Permite a las secretarias cambiar el estado de la consulta (ej: "pendiente" -> "atendido")
 */
app.patch('/api/consultas/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const nuevoEstado = body.estado || 'atendido';

  const firestore = new FirestoreService(c.env);
  const ok = await firestore.actualizarEstadoConsulta(id, nuevoEstado);

  if (ok) {
    return c.json({ success: true, id, estado: nuevoEstado });
  } else {
    return c.json({ error: 'No se pudo actualizar el estado de la consulta' }, 500);
  }
});

export default app;
