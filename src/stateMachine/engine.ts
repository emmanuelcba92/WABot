import { WebhookPayload, WebhookResponse, StateType, UserSession, Env, MenuTreeConfig, MenuItemOption } from '../types';
import { MESSAGES } from '../templates/messages';
import { FirestoreService } from '../services/firestoreService';
import { ScheduleService } from '../services/scheduleService';
import { ImageUploadService } from '../services/imageUploadService';

export class StateEngine {
  public static buildWelcomeMenu(tree: MenuTreeConfig): string {
    let msg = tree.welcomeMessage || '🏥 *¡Hola! Bienvenido/a a la Clínica Médica.*\nPor favor, responde con la letra de la opción que necesitas:';
    msg += '\n\n';
    if (tree.items && Array.isArray(tree.items)) {
      tree.items.forEach(item => {
        msg += `*${item.key.toUpperCase()})* ${item.label}\n`;
      });
    }
    return msg.trim();
  }

  public static async processMessage(payload: WebhookPayload, env?: Env): Promise<WebhookResponse> {
    const remitente = payload.remitente.trim();
    const mensaje = payload.mensaje.trim();
    const simulatedTime = payload.simulatedTime;
    const imagenBase64 = payload.imagenBase64;
    const imagenNombre = payload.imagenNombre;
    const timestamp = new Date().toISOString();

    const firestore = new FirestoreService(env);
    const botConfig = await firestore.getBotConfig();
    const menuTree = await firestore.getMenuTree();

    const saludoBienvenidaMsg = this.buildWelcomeMenu(menuTree);
    const fueraDeHorarioMsg = botConfig.fueraDeHorario || MESSAGES.FUERA_DE_HORARIO;

    // 1. Control de Horario (Persistido en Firestore)
    const scheduleMode = await firestore.getScheduleMode();
    const scheduleCheck = ScheduleService.isWithinBusinessHours(simulatedTime, scheduleMode);
    if (!scheduleCheck.isWithinHours) {
      return {
        remitente,
        respuesta: fueraDeHorarioMsg,
        estadoActual: 'inicio',
        enHorario: false,
        timestamp
      };
    }

    // 2. Obtener estado de sesión del paciente
    const sesion = await firestore.getSesion(remitente);

    // Normalizar texto para palabras clave de reinicio o saludo
    const msgClean = mensaje.toLowerCase().trim();
    const esSaludoExplicit = ['hola', 'buen dia', 'buenas tardes', 'buenas noches', 'menu', 'inicio', 'volver', 'recomenzar'].includes(msgClean);

    // 3. Si el paciente ya completó la solicitud y está esperando atención de secretaría
    if (sesion.estado === 'esperando_atencion_humana') {
      if (esSaludoExplicit) {
        await firestore.saveSesion(remitente, 'esperando_opcion_principal');
        return {
          remitente,
          respuesta: saludoBienvenidaMsg,
          estadoActual: 'esperando_opcion_principal',
          enHorario: true,
          timestamp
        };
      }

      // Si el bot está en silencio, adjuntar la nueva foto o mensaje a la consulta existente
      await firestore.appendPacienteMensajeAConsulta(remitente, mensaje, imagenBase64);

      return {
        remitente,
        respuesta: '', // Cadena vacía = Bot en silencio sin spam
        estadoActual: 'esperando_atencion_humana',
        enHorario: true,
        timestamp
      };
    }

    // 4. Mostrar Menú Principal si es un saludo explícito o si la sesión está en inicio
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

    // 7. RECEPCIÓN DE DATOS / FOTOS FINAL DE LA SOLICITUD
    if (typeof sesion.estado === 'string' && (sesion.estado.startsWith('esperando_datos_') || sesion.estado.startsWith('esperando_datos'))) {
      const opcionElegida = sesion.estado.replace('esperando_datos_', '').toUpperCase();
      return await this.guardarConsultaFinal(remitente, opcionElegida, mensaje, imagenBase64, imagenNombre, env, timestamp, firestore);
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
    env: Env | undefined,
    timestamp: string,
    firestore: FirestoreService
  ): Promise<WebhookResponse> {
    const consultasExistentes = await firestore.getConsultas();
    const consultaActiva = consultasExistentes.find(c => c.remitente === remitente && c.estado === 'pendiente');

    if (consultaActiva) {
      await firestore.appendPacienteMensajeAConsulta(remitente, mensaje, imagenBase64);
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

    const datosEstructurados = {
      tipoSolicitud: opcionElegida,
      contenidoMensaje: mensaje,
      lineasParseadas: mensaje.split('\n').map(l => l.trim()).filter(l => l.length > 0),
      imagenUrl: (proveedorAlmacenamiento && proveedorAlmacenamiento !== 'simulated') ? imagenSubidaUrl : null,
      imagenBase64: imagenBase64 || null,
      imagenesAdjuntas: imagenBase64 ? [imagenBase64] : [],
      proveedorAlmacenamiento: proveedorAlmacenamiento || null,
      respuestasPaciente: []
    };

    await firestore.crearConsulta(remitente, opcionElegida, datosEstructurados);
    await firestore.saveSesion(remitente, 'esperando_atencion_humana');

    let confirmacionMsg = MESSAGES.CONFIRMACION_CONSULTA_RECIBIDA;
    if (imagenSubidaUrl && proveedorAlmacenamiento && proveedorAlmacenamiento !== 'simulated') {
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
