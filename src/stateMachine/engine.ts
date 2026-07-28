import { Env, StateType, WebhookPayload, WebhookResponse } from '../types';
import { MESSAGES } from '../templates/messages';
import { MENU_PRINCIPAL, SUBMENU_TURNOS, interactiveToPlainText } from '../templates/interactiveMenus';
import { ScheduleService } from '../services/scheduleService';
import { FirestoreService } from '../services/firestoreService';
import { ImageUploadService } from '../services/imageUploadService';

export class StateEngine {
  public static async processMessage(payload: WebhookPayload, env?: Env): Promise<WebhookResponse> {
    const { remitente, mensaje, simulatedTime, imagenBase64, imagenNombre } = payload;
    const firestore = new FirestoreService(env);
    const timestamp = new Date().toISOString();

    // 1. Control de Horario
    const scheduleCheck = ScheduleService.isWithinBusinessHours(simulatedTime);
    if (!scheduleCheck.isWithinHours) {
      return {
        remitente,
        respuesta: MESSAGES.FUERA_DE_HORARIO,
        estadoActual: 'inicio',
        enHorario: false,
        timestamp
      };
    }

    // 2. Obtener sesión
    const sesion = await firestore.getSesion(remitente);
    const msgClean = mensaje.trim().toLowerCase();

    // Palabras clave de saludo
    const saludos = ['hola', 'buen dia', 'buenas', 'buenos dias', 'buenas tardes',
      'buenas noches', 'iniciar', 'menu', 'inicio', 'recomenzar', 'bot', 'ayuda', 'start'];
    const esSaludo = saludos.some(s => msgClean.includes(s));

    // 3. Mostrar Menú Principal (interactivo) si es saludo o inicio
    if (esSaludo || sesion.estado === 'inicio') {
      await firestore.saveSesion(remitente, 'esperando_opcion_principal');
      return {
        remitente,
        respuesta: interactiveToPlainText(MENU_PRINCIPAL),
        interactive: MENU_PRINCIPAL,
        estadoActual: 'esperando_opcion_principal',
        enHorario: true,
        timestamp
      };
    }

    // 4. Máquina de estados
    switch (sesion.estado) {

      case 'esperando_opcion_principal': {
        const opcion = msgClean.charAt(0).toUpperCase();

        if (opcion === 'A') {
          await firestore.saveSesion(remitente, 'esperando_opcion_a_sub');
          return {
            remitente,
            respuesta: interactiveToPlainText(SUBMENU_TURNOS),
            interactive: SUBMENU_TURNOS,
            estadoActual: 'esperando_opcion_a_sub',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'B') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_b');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_B,
            estadoActual: 'esperando_datos_opcion_b',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'C') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_c');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_C,
            estadoActual: 'esperando_datos_opcion_c',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'D') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_d');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_D,
            estadoActual: 'esperando_datos_opcion_d',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'E') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_e');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_E,
            estadoActual: 'esperando_datos_opcion_e',
            enHorario: true,
            timestamp
          };
        } else {
          return {
            remitente,
            respuesta: interactiveToPlainText(MENU_PRINCIPAL),
            interactive: MENU_PRINCIPAL,
            estadoActual: 'esperando_opcion_principal',
            enHorario: true,
            timestamp
          };
        }
      }

      case 'esperando_opcion_a_sub': {
        const sub = msgClean.charAt(0);
        if (sub === '1') {
          await firestore.saveSesion(remitente, 'esperando_datos_a1');
          return { remitente, respuesta: MESSAGES.PLANTILLA_A1_ORL, estadoActual: 'esperando_datos_a1', enHorario: true, timestamp };
        } else if (sub === '2') {
          await firestore.saveSesion(remitente, 'esperando_datos_a2');
          return { remitente, respuesta: MESSAGES.PLANTILLA_A2_ESTUDIOS, estadoActual: 'esperando_datos_a2', enHorario: true, timestamp };
        } else if (sub === '3') {
          await firestore.saveSesion(remitente, 'esperando_datos_a3');
          return { remitente, respuesta: MESSAGES.PLANTILLA_A3_CIRUGIAS, estadoActual: 'esperando_datos_a3', enHorario: true, timestamp };
        } else {
          return {
            remitente,
            respuesta: interactiveToPlainText(SUBMENU_TURNOS),
            interactive: SUBMENU_TURNOS,
            estadoActual: 'esperando_opcion_a_sub',
            enHorario: true,
            timestamp
          };
        }
      }

      case 'esperando_datos_a1':
      case 'esperando_datos_a2':
      case 'esperando_datos_a3':
      case 'esperando_datos_opcion_b':
      case 'esperando_datos_opcion_c':
      case 'esperando_datos_opcion_d':
      case 'esperando_datos_opcion_e': {
        const opcionMap: Record<string, string> = {
          esperando_datos_a1: 'A1_Turno_ORL_9Datos',
          esperando_datos_a2: 'A2_Turno_Estudios_7Datos_Foto',
          esperando_datos_a3: 'A3_Turno_Cirugias_6Datos_Foto',
          esperando_datos_opcion_b: 'B_Autorizacion_Estudios_Ordenes',
          esperando_datos_opcion_c: 'C_Consultas_Generales_Ayuda',
          esperando_datos_opcion_d: 'D_Afiliados_PAMI_3Datos',
          esperando_datos_opcion_e: 'E_Reprogramacion_Cancelacion'
        };

        const opcionElegida = opcionMap[sesion.estado] || 'Desconocido';
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
          imagenUrl: imagenSubidaUrl || null,
          proveedorAlmacenamiento: proveedorAlmacenamiento || null
        };

        await firestore.crearConsulta(remitente, opcionElegida, datosEstructurados);
        await firestore.saveSesion(remitente, 'inicio');

        let confirmacionMsg = MESSAGES.CONFIRMACION_CONSULTA_RECIBIDA;
        if (imagenSubidaUrl) {
          const prov = proveedorAlmacenamiento === 'google_drive' ? 'Google Drive'
            : proveedorAlmacenamiento === 'supabase' ? 'Supabase' : 'Almacenamiento';
          confirmacionMsg += `\n\n📷 *Imagen adjuntada correctamente en ${prov}:*\n[Ver Imagen](${imagenSubidaUrl})`;
        }

        return {
          remitente,
          respuesta: confirmacionMsg,
          estadoActual: 'inicio',
          enHorario: true,
          timestamp,
          imagenSubidaUrl
        };
      }

      default: {
        await firestore.saveSesion(remitente, 'esperando_opcion_principal');
        return {
          remitente,
          respuesta: interactiveToPlainText(MENU_PRINCIPAL),
          interactive: MENU_PRINCIPAL,
          estadoActual: 'esperando_opcion_principal',
          enHorario: true,
          timestamp
        };
      }
    }
  }
}
