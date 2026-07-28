import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, WebhookPayload } from './types';
import { StateEngine } from './stateMachine/engine';
import { ScheduleService } from './services/scheduleService';
import { FirestoreService } from './services/firestoreService';

const app = new Hono<{ Bindings: Env }>();

// Habilitar CORS para permitir pruebas desde cualquier navegador o dominio
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
 * Recibe: { remitente: string, mensaje: string, simulatedTime?: string }
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
      simulatedTime: body.simulatedTime
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
 * Permite consultar el estado actual de la sesión en Firestore desde la página de pruebas
 */
app.get('/api/session/:remitente', async (c) => {
  const remitente = c.req.param('remitente');
  const firestore = new FirestoreService(c.env);
  const sesion = await firestore.getSesion(remitente);
  return c.json(sesion);
});

/**
 * ENDPOINT GET /api/consultas
 * Permite consultar la lista de consultas registradas (para verificación en el simulador)
 */
app.get('/api/consultas', (c) => {
  const consultas = FirestoreService.getConsultasGuardadasMemoria();
  return c.json({
    total: consultas.length,
    consultas
  });
});

export default app;
