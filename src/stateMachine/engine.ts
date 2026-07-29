import { WebhookPayload, WebhookResponse, Env } from '../types';
import { MESSAGES } from '../templates/messages';
import { ScheduleService } from '../services/scheduleService';
import { FirestoreService } from '../services/firestoreService';
import { ImageUploadService } from '../services/imageUploadService';

export class StateEngine {
  public static async processMessage(
    payload: WebhookPayload,
    env?: Env
  ): Promise<WebhookResponse> {
    const firestore = new FirestoreService(env);
    const remitente = payload.remitente.trim();
    const mensaje = payload.mensaje.trim();
    const imagenBase64 = payload.imagenBase64;
    const imagenNombre = payload.imagenNombre;
    const pdfBase64 = payload.pdfBase64;
    const pdfNombre = payload.pdfNombre;

    const timestamp = payload.simulatedTime || new Date().toISOString();

    const scheduleMode = await firestore.getScheduleMode();
    ScheduleService.setMode(scheduleMode);
    const scheduleInfo = ScheduleService.isWithinBusinessHours(payload.simulatedTime, scheduleMode);

    const botConfig = await firestore.getBotConfig();
    const fueraDeHorarioMsg = botConfig.fueraDeHorario || MESSAGES.FUERA_DE_HORARIO;

    const menuTree = await firestore.getMenuTree();
    const saludoBienvenidaMsg = menuTree.welcomeMessage || MESSAGES.SALUDO_BIENVENIDA;

    // 1. FUERA DE HORARIO DE ATENCIÓN
    if (!scheduleInfo.isOpen) {
      await firestore.saveSesion(remitente, 'inicio');
      return {
        remitente,
        respuesta: fueraDeHorarioMsg,
        estadoActual: 'inicio',
        enHorario: false,
        timestamp
      };
    }

    const sesion = await firestore.getSesion(remitente);
    const msgClean = mensaje.toLowerCase().trim();

    // Reset comandos globales ("hola", "inicio", "menu")
    const esSaludoExplicit = msgClean === 'hola' || msgClean === 'inicio' || msgClean === 'menu' || msgClean === 'cancelar' || msgClean === 'reset';

    // 2. ATENCIÓN HUMANA ACTIVA (SILENCIO TOTAL SI EL PACIENTE HABLA)
    if (sesion.estado === 'esperando_atencion_humana' && !esSaludoExplicit) {
      if (mensaje.length > 0 || imagenBase64 || pdfBase64) {
        await firestore.appendPacienteMensajeAConsulta(remitente, mensaje, imagenBase64, pdfBase64, pdfNombre);
      }
      return {
        remitente,
        respuesta: '', // Silencio para no saturar al paciente mientras responde la secretaria
        estadoActual: 'esperando_atencion_humana',
        enHorario: true,
        timestamp
      };
    }

    // 3. SALUDO INICIAL / RESET DE CONVERSACIÓN
    if (esSaludoExplicit || sesion.estado === 'inicio') {
      await firestore.saveSesion(remitente, 'esperando_opcion_principal');
      return {
        remitente,
        respuesta: saludoBienvenidaMsg,
        estadoActual: 'esperando_opcion_principal',
        enHorario: true,
        timestamp
      };
    }

    // 5. EVALUACIÓN DINÁMICA DE OPCIONES CONFIGURADAS POR EL ADMIN
    if (sesion.estado === 'esperando_opcion_principal') {
      const input = msgClean.replace(/[^a-z0-9]/g, '');

      // Buscar si coincide con alguna opción principal (A, B, C, D, E, F...)
      const itemMatch = (menuTree.items || []).find(item => item.key.toLowerCase() === input);

      if (itemMatch) {
        if (itemMatch.type === 'info') {
          await firestore.saveSesion(remitente, 'esperando_atencion_humana');
          return {
            remitente,
            respuesta: itemMatch.responseTemplate || 'Gracias por comunicarte con nosotros.',
            estadoActual: 'esperando_atencion_humana',
            enHorario: true,
            timestamp
          };
        } else if (itemMatch.type === 'submenu' && itemMatch.subItems && itemMatch.subItems.length > 0) {
          await firestore.saveSesion(remitente, `esperando_sub_${itemMatch.key}`);
          let subMsg = `📋 *${itemMatch.label}*\nPor favor responde con el número de la opción elegida:\n\n`;
          itemMatch.subItems.forEach(sub => {
            subMsg += `*${sub.key})* ${sub.label}\n`;
          });
          return {
            remitente,
            respuesta: subMsg.trim(),
            estadoActual: `esperando_sub_${itemMatch.key}`,
            enHorario: true,
            timestamp
          };
        } else {
          await firestore.saveSesion(remitente, `esperando_datos_${itemMatch.key}`);
          return {
            remitente,
            respuesta: itemMatch.responseTemplate || MESSAGES.PLANTILLA_OPCION_B,
            estadoActual: `esperando_datos_${itemMatch.key}`,
            enHorario: true,
            timestamp
          };
        }
      }

      // Si no coincide con ninguna opción, repetir menú principal
      return {
        remitente,
        respuesta: saludoBienvenidaMsg,
        estadoActual: 'esperando_opcion_principal',
        enHorario: true,
        timestamp
      };
    }

    // 6. EVALUACIÓN DINÁMICA DE SUB-MENÚS (ej: 'esperando_sub_a')
    if (typeof sesion.estado === 'string' && sesion.estado.startsWith('esperando_sub_')) {
      const parentKey = sesion.estado.replace('esperando_sub_', '');
      const parentMatch = (menuTree.items || []).find(item => item.key.toLowerCase() === parentKey.toLowerCase());

      if (parentMatch && parentMatch.subItems) {
        const subInput = msgClean.replace(/[^a-z0-9]/g, '');
        const subMatch = parentMatch.subItems.find(sub => sub.key.toLowerCase() === subInput);

        if (subMatch) {
          await firestore.saveSesion(remitente, `esperando_datos_${parentMatch.key}_${subMatch.key}`);
          return {
            remitente,
            respuesta: subMatch.responseTemplate || MESSAGES.PLANTILLA_A1_ORL,
            estadoActual: `esperando_datos_${parentMatch.key}_${subMatch.key}`,
            enHorario: true,
            timestamp
          };
        }
      }
    }

    // 7. RECEPCIÓN DE DATOS / FOTOS / PDFS FINAL DE LA SOLICITUD
    if (typeof sesion.estado === 'string' && (sesion.estado.startsWith('esperando_datos_') || sesion.estado.startsWith('esperando_datos'))) {
      const opcionElegida = sesion.estado.replace('esperando_datos_', '').toUpperCase();
      return await this.guardarConsultaFinal(remitente, opcionElegida, mensaje, imagenBase64, imagenNombre, pdfBase64, pdfNombre, env, timestamp, firestore);
    }

    // Fallback al menú principal
    await firestore.saveSesion(remitente, 'esperando_opcion_principal');
    return {
      remitente,
      respuesta: saludoBienvenidaMsg,
      estadoActual: 'esperando_opcion_principal',
      enHorario: true,
      timestamp
    };
  }

  private static async guardarConsultaFinal(
    remitente: string,
    opcionElegida: string,
    mensaje: string,
    imagenBase64: string | undefined,
    imagenNombre: string | undefined,
    pdfBase64: string | undefined,
    pdfNombre: string | undefined,
    env: Env | undefined,
    timestamp: string,
    firestore: FirestoreService
  ): Promise<WebhookResponse> {
    const consultasExistentes = await firestore.getConsultas();
    const consultaActiva = consultasExistentes.find(c => c.remitente === remitente && c.estado === 'pendiente');

    if (consultaActiva) {
      await firestore.appendPacienteMensajeAConsulta(remitente, mensaje, imagenBase64, pdfBase64, pdfNombre);
      await firestore.saveSesion(remitente, 'esperando_atencion_humana');

      return {
        remitente,
        respuesta: '', // Silencio para no enviar confirmaciones duplicadas
        estadoActual: 'esperando_atencion_humana',
        enHorario: true,
        timestamp
      };
    }

    let imagenSubidaUrl: string | undefined;
    let proveedorAlmacenamiento: string | undefined;

    if (imagenBase64) {
      try {
        const uploadRes = await ImageUploadService.uploadImage(
          imagenBase64, imagenNombre || `${remitente}_${Date.now()}.jpg`, env
        );
        imagenSubidaUrl = uploadRes.url;
        proveedorAlmacenamiento = uploadRes.provider;
      } catch (err) {
        console.error('Error al subir imagen:', err);
      }
    }

    const pdfsAdjuntos = pdfBase64 ? [{ nombre: pdfNombre || 'documento.pdf', base64: pdfBase64, timestamp }] : [];

    const datosEstructurados = {
      tipoSolicitud: opcionElegida,
      contenidoMensaje: mensaje,
      lineasParseadas: mensaje.split('\n').map(l => l.trim()).filter(l => l.length > 0),
      imagenUrl: (proveedorAlmacenamiento && proveedorAlmacenamiento !== 'simulated') ? imagenSubidaUrl : null,
      imagenBase64: imagenBase64 || null,
      imagenesAdjuntas: imagenBase64 ? [imagenBase64] : [],
      pdfsAdjuntos,
      proveedorAlmacenamiento: proveedorAlmacenamiento || null,
      respuestasPaciente: []
    };

    await firestore.crearConsulta(remitente, opcionElegida, datosEstructurados);
    await firestore.saveSesion(remitente, 'esperando_atencion_humana');

    let confirmacionMsg = MESSAGES.CONFIRMACION_CONSULTA_RECIBIDA;
    if (pdfBase64) {
      confirmacionMsg += `\n\n📄 *Documento PDF adjunto (${pdfNombre || 'archivo.pdf'}) recibido correctamente.*`;
    } else if (imagenSubidaUrl && proveedorAlmacenamiento && proveedorAlmacenamiento !== 'simulated') {
      const prov = proveedorAlmacenamiento === 'google_drive' ? 'Google Drive'
        : proveedorAlmacenamiento === 'supabase' ? 'Supabase' : 'Almacenamiento';
      confirmacionMsg += `\n\n📷 *Imagen adjuntada correctamente en ${prov}:*\n[Ver Imagen](${imagenSubidaUrl})`;
    } else if (imagenBase64) {
      confirmacionMsg += `\n\n📷 *Foto / Pedido médico adjunto recibido correctamente.*`;
    }

    return {
      remitente,
      respuesta: confirmacionMsg,
      estadoActual: 'esperando_atencion_humana',
      enHorario: true,
      timestamp,
      imagenSubidaUrl
    };
  }
}
