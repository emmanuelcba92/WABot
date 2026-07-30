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

app.get('/api/doctors', async (c) => {
  const firestore = new FirestoreService(c.env);
  const items = await firestore.getDoctors();
  return c.json({ items });
});

app.post('/api/doctors', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const firestore = new FirestoreService(c.env);
    await firestore.saveDoctors(items);
    return c.json({ success: true, count: items.length });
  } catch (e: any) {
    return c.json({ error: 'Error al guardar lista de médicos', details: e?.message }, 500);
  }
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
    const firestore = new FirestoreService(c.env);

    await firestore.saveSesion(remitente, 'esperando_atencion_humana');

    const idConsulta = await firestore.crearConsulta(remitente, 'Contacto Directo Secretaría', {
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

    await firestore.agregarMensajeHistorial(remitente, {
      id: `msg_${Date.now()}_sec_init`,
      sender: 'secretaria',
      text: textoFinal,
      timestamp: new Date().toISOString()
    });

    await firestore.addPendingOutgoing(remitente, textoFinal, idConsulta, undefined, pdfNombre, pdfBase64);

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

    const firestore = new FirestoreService(c.env);
    const consultas = await firestore.getConsultas();
    const target = consultas.find(item => item.id === idConsulta);

    if (!target) {
      return c.json({ error: 'Consulta no encontrada' }, 404);
    }

    const datos = target.datos || {};
    const patientName = datos.pushName ? `${datos.pushName} (${target.remitente})` : target.remitente;

    const headerMsg = `🏥 *DERIVACIÓN PARA TELEMEDICINA - CLÍNICA COAT*\n👤 *Paciente:* ${patientName}\n📋 *Solicitud:* ${target.opcion || 'Telemedicina'}\n${notaSecretaria ? `📝 *Nota de Secretaría:* "${notaSecretaria}"\n` : ''}📄 *Documentos Adjuntos:* (Se reenvían a continuación fotos y archivos PDF del paciente)`;

    // 1. Enviar Encabezado al Médico
    await firestore.addPendingOutgoing(doctorPhone, headerMsg, idConsulta);

    // 2. Enviar PDFs Adjuntos al Médico
    const respuestasPaciente = datos.respuestasPaciente || [];
    const pdfsFromResp = respuestasPaciente.filter((r: any) => r.pdfBase64).map((r: any) => ({ base64: r.pdfBase64, nombre: r.pdfNombre || 'pedido_medico.pdf' }));
    const listPdfs = (datos.pdfsAdjuntos && datos.pdfsAdjuntos.length > 0) ? datos.pdfsAdjuntos : pdfsFromResp;

    for (const pdfItem of listPdfs) {
      if (pdfItem.base64) {
        await firestore.addPendingOutgoing(doctorPhone, `📄 Documento PDF (${pdfItem.nombre || 'estudio.pdf'})`, idConsulta, undefined, pdfItem.nombre || 'estudio.pdf', pdfItem.base64);
      }
    }

    // 3. Enviar Imágenes Adjuntas al Médico
    const displayImg = datos.imagenBase64 || datos.imagenUrl;
    const imgFromResp = respuestasPaciente.filter((r: any) => r.imagenBase64).map((r: any) => r.imagenBase64);
    const listImagenes = [
      ...(datos.imagenesAdjuntas || []),
      ...imgFromResp
    ];
    if (listImagenes.length === 0 && displayImg) {
      listImagenes.push(displayImg);
    }

    for (const imgSrc of listImagenes) {
      if (imgSrc && typeof imgSrc === 'string' && imgSrc.length > 20) {
        const formattedImg = imgSrc.startsWith('data:image') ? imgSrc : `data:image/jpeg;base64,${imgSrc}`;
        await firestore.addPendingOutgoing(doctorPhone, `📷 Pedido Médico / Foto Adjunta del Paciente`, idConsulta, undefined, undefined, undefined, formattedImg);
      }
    }

    // 4. Registrar en la consulta que fue derivada a Telemedicina
    const regMsg = `🩺 Telemedicina derivada a ${doctorName || 'Médico'} (${doctorPhone}) ${notaSecretaria ? `- "${notaSecretaria}"` : ''}`;
    await firestore.registrarRespuestaSecretaria(idConsulta, regMsg);

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

    const firestore = new FirestoreService(c.env);

    if (idConsulta) {
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
