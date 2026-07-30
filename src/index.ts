import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, WebhookPayload } from './types';
import { StateEngine } from './stateMachine/engine';
import { MESSAGES } from './templates/messages';
import { FirestoreService, DEFAULT_MENU_TREE } from './services/firestoreService';

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

app.get('/api/vip-contacts', async (c) => {
  const firestore = new FirestoreService(c.env);
  const items = await firestore.getVipContacts();
  return c.json({ items });
});

app.post('/api/vip-contacts', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const firestore = new FirestoreService(c.env);
    await firestore.saveVipContacts(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar contactos VIP', details: e?.message }, 500);
  }
});

app.get('/api/quick-replies', async (c) => {
  const firestore = new FirestoreService(c.env);
  const items = await firestore.getQuickReplies();
  return c.json({ items });
});

app.post('/api/quick-replies', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const firestore = new FirestoreService(c.env);
    await firestore.saveQuickReplies(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar respuestas rápidas', details: e?.message }, 500);
  }
});

app.get('/api/pdf-config', async (c) => {
  const firestore = new FirestoreService(c.env);
  const items = await firestore.getPdfConfig();
  return c.json({ items });
});

app.post('/api/pdf-config', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const firestore = new FirestoreService(c.env);
    await firestore.savePdfConfig(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar configuración de PDFs', details: e?.message }, 500);
  }
});

app.get('/api/tag-config', async (c) => {
  const firestore = new FirestoreService(c.env);
  const tags = await firestore.getTagConfig();
  return c.json({ tags });
});

app.post('/api/tag-config', async (c) => {
  try {
    const body = await c.req.json();
    const tags = body.tags || {};
    const firestore = new FirestoreService(c.env);
    await firestore.saveTagConfig(tags);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar etiquetas', details: e?.message }, 500);
  }
});

app.get('/api/schedule-config', async (c) => {
  const firestore = new FirestoreService(c.env);
  const mode = await firestore.getScheduleMode();
  return c.json({ mode });
});

app.post('/api/schedule-config', async (c) => {
  try {
    const body = await c.req.json();
    const mode = body.mode || 'auto';
    const firestore = new FirestoreService(c.env);
    await firestore.saveScheduleMode(mode);
    return c.json({ success: true, mode });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar schedule mode', details: e?.message }, 500);
  }
});

app.get('/api/menu-tree', async (c) => {
  const firestore = new FirestoreService(c.env);
  const tree = await firestore.getMenuTree();
  return c.json({ tree });
});

app.post('/api/menu-tree', async (c) => {
  try {
    const body = await c.req.json();
    const tree = body.tree || body;
    const firestore = new FirestoreService(c.env);
    await firestore.saveMenuTree(tree);
    return c.json({
      success: true,
      mensaje: 'Árbol de menú y opciones actualizado exitosamente.'
    });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar el árbol de menú', details: e?.message }, 500);
  }
});

app.get('/api/bot-config', async (c) => {
  const firestore = new FirestoreService(c.env);
  const config = await firestore.getBotConfig();
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
    const firestore = new FirestoreService(c.env);
    await firestore.saveBotConfig(body);
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

    const firestore = new FirestoreService(c.env);

    await firestore.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_pac`,
      sender: 'paciente',
      text: mensaje || '(Imagen/Documento adjunto)',
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

app.patch('/api/consultas/:id/etiquetas', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const etiquetas = body.etiquetas || [];

  const firestore = new FirestoreService(c.env);
  const ok = await firestore.actualizarEtiquetasConsulta(id, etiquetas);

  if (ok) {
    return c.json({ success: true, id, etiquetas });
  } else {
    return c.json({ error: 'No se pudo actualizar las etiquetas de la consulta' }, 500);
  }
});

app.patch('/api/consultas/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const nuevoEstado = body.estado || 'atendido';

  const firestore = new FirestoreService(c.env);
  const ok = await firestore.actualizarEstadoConsulta(id, nuevoEstado);

  if (ok && nuevoEstado === 'atendido') {
    const config = await firestore.getBotConfig();
    const closingMsg = config.confirmacionCierre || MESSAGES.CONFIRMACION_CHAT_FINALIZADO;

    const consultas = await firestore.getConsultas();
    const target = consultas.find(item => item.id === id);
    if (target && target.remitente) {
      await firestore.saveSesion(target.remitente, 'inicio');
      await firestore.addPendingOutgoing(target.remitente, closingMsg, id);
    }
  }

  if (ok) {
    return c.json({ success: true, id, estado: nuevoEstado });
  } else {
    return c.json({ error: 'No se pudo actualizar el estado de la consulta' }, 500);
  }
});

app.post('/api/clear-consultas', async (c) => {
  const firestore = new FirestoreService(c.env);
  await firestore.clearAllConsultas();
  return c.json({ success: true, message: 'Todas las solicitudes han sido eliminadas' });
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
      // CORRECCIÓN CRÍTICA: Responder por secretaría NUNCA debe marcar el estado como 'atendido' automáticamente.
      // El chat debe permanecer en estado 'pendiente' y abierto en pantalla hasta que la secretaria haga clic en 'Marcar Atendido'.
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

export default app;
