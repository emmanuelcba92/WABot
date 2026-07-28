import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, WebhookPayload } from './types';
import { StateEngine } from './stateMachine/engine';
import { ScheduleService, ScheduleMode } from './services/scheduleService';
import { FirestoreService } from './services/firestoreService';
import { SeedService } from './services/seedService';
import { MESSAGES } from './templates/messages';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/api/status', (c) => {
  const schedule = ScheduleService.isWithinBusinessHours();
  return c.json({
    status: 'ok',
    service: 'WA Bot Backend - Clínica Médica',
    platform: 'Cloudflare Worker',
    scheduleInfo: schedule
  });
});

app.get('/api/schedule-config', (c) => {
  const schedule = ScheduleService.isWithinBusinessHours();
  return c.json({
    mode: ScheduleService.getMode(),
    scheduleInfo: schedule
  });
});

app.post('/api/schedule-config', async (c) => {
  try {
    const body = await c.req.json();
    const mode = (body.mode as ScheduleMode) || 'auto';
    ScheduleService.setMode(mode);
    const schedule = ScheduleService.isWithinBusinessHours();
    return c.json({
      success: true,
      mode: ScheduleService.getMode(),
      scheduleInfo: schedule,
      mensaje: `Modo de horario actualizado a: ${mode}`
    });
  } catch (e: any) {
    return c.json({ error: 'Error al cambiar modo de horario', details: e?.message }, 500);
  }
});

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
      return c.json({ error: 'El campo "remitente" es requerido' }, 400);
    }

    const payload: WebhookPayload = {
      remitente,
      mensaje,
      simulatedTime: body.simulatedTime,
      imagenBase64: body.imagenBase64,
      imagenNombre: body.imagenNombre
    };

    const firestore = new FirestoreService(c.env);

    await firestore.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_pac`,
      sender: 'paciente',
      text: mensaje || '(Imagen adjunta)',
      timestamp: new Date().toISOString(),
      imageUrl: body.imagenBase64 ? 'imagen_adjunta' : undefined
    });

    const result = await StateEngine.processMessage(payload, c.env);

    await firestore.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_bot`,
      sender: 'bot',
      text: result.respuesta,
      timestamp: new Date().toISOString(),
      imageUrl: result.imagenSubidaUrl,
      interactive: result.interactive
    });

    return c.json(result, 200);
  } catch (err: any) {
    console.error('Error en /webhook:', err);
    return c.json({ error: 'Error interno del servidor', details: err?.message }, 500);
  }
});

app.get('/api/session/:remitente', async (c) => {
  const remitente = c.req.param('remitente');
  const firestore = new FirestoreService(c.env);
  const sesion = await firestore.getSesion(remitente);
  return c.json(sesion);
});

app.get('/api/consultas', async (c) => {
  const estado = c.req.query('estado');
  const firestore = new FirestoreService(c.env);
  const consultas = await firestore.getConsultas(estado);
  return c.json({
    total: consultas.length,
    consultas
  });
});

app.patch('/api/consultas/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const nuevoEstado = body.estado || 'atendido';

  const firestore = new FirestoreService(c.env);
  const ok = await firestore.actualizarEstadoConsulta(id, nuevoEstado);

  if (ok && nuevoEstado === 'atendido') {
    const consultas = await firestore.getConsultas();
    const target = consultas.find(item => item.id === id);
    if (target && target.remitente) {
      await firestore.saveSesion(target.remitente, 'inicio');
      await firestore.addPendingOutgoing(target.remitente, MESSAGES.CONFIRMACION_CHAT_FINALIZADO, id);
    }
  }

  if (ok) {
    return c.json({ success: true, id, estado: nuevoEstado });
  } else {
    return c.json({ error: 'No se pudo actualizar el estado de la consulta' }, 500);
  }
});

app.post('/api/send-message', async (c) => {
  try {
    const body = await c.req.json();
    const { remitente, respuesta, idConsulta, pdfUrl, pdfNombre, pdfBase64 } = body;

    if (!remitente || (!respuesta && !pdfUrl && !pdfBase64)) {
      return c.json({ error: 'Faltan parámetros (remitente o respuesta/PDF)' }, 400);
    }

    const firestore = new FirestoreService(c.env);

    if (idConsulta) {
      await firestore.actualizarEstadoConsulta(idConsulta, 'atendido');
      const textoReg = `${respuesta || ''} ${pdfNombre ? `[📎 Adjunto PDF: ${pdfNombre}]` : ''}`.trim();
      await firestore.registrarRespuestaSecretaria(idConsulta, textoReg);
    }

    const textoFinal = respuesta ? `👩‍⚕️ *[Secretaría]* ${respuesta}` : `👩‍⚕️ *[Secretaría]* Te enviamos el documento adjunto con las indicaciones.`;

    await firestore.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_sec`,
      sender: 'secretaria',
      text: textoFinal,
      timestamp: new Date().toISOString()
    });

    await firestore.addPendingOutgoing(remitente, textoFinal, idConsulta, pdfUrl, pdfNombre, pdfBase64);

    return c.json({
      success: true,
      remitente,
      respuestaEnviada: respuesta,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ error: 'Error al enviar respuesta', details: err?.message }, 500);
  }
});

app.get('/api/pending-outgoing', async (c) => {
  const firestore = new FirestoreService(c.env);
  const messages = await firestore.popPendingOutgoing();
  return c.json({
    total: messages.length,
    messages
  });
});

app.post('/api/seed-consultas', async (c) => {
  try {
    const totalGeneradas = await SeedService.generate70TestConsultas(c.env);
    return c.json({
      success: true,
      totalGeneradas,
      mensaje: 'Se han generado 70 consultas de prueba en Firestore exitosamente.'
    });
  } catch (err: any) {
    return c.json({ error: 'Error al generar datos de prueba', details: err?.message }, 500);
  }
});

app.post('/api/clear-consultas', async (c) => {
  const firestore = new FirestoreService(c.env);
  await firestore.clearAllConsultas();
  return c.json({ success: true, mensaje: 'Todas las consultas y chats de prueba han sido limpiados.' });
});

app.delete('/api/consultas', async (c) => {
  const firestore = new FirestoreService(c.env);
  await firestore.clearAllConsultas();
  return c.json({ success: true, mensaje: 'Todas las consultas y chats de prueba han sido limpiados.' });
});

export default app;
