import { Env, StateType, WebhookPayload, WebhookResponse } from '../types';
import { MESSAGES } from '../templates/messages';
import { ScheduleService } from '../services/scheduleService';
import { FirestoreService } from '../services/firestoreService';
import { ImageUploadService } from '../services/imageUploadService';

export class StateEngine {
  /**
   * Procesa un mensaje entrante según la máquina de estados y las reglas de negocio.
   */
  public static async processMessage(payload: WebhookPayload, env?: Env): Promise<WebhookResponse> {
    const { remitente, mensaje, simulatedTime, imagenBase64, imagenNombre } = payload;
    const firestore = new FirestoreService(env);
    const timestamp = new Date().toISOString();

    // 1. Control de Horario (Zona Horaria Argentina: Lun-Vie 08:00 a 20:00 hs)
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

    // 2. Obtener estado de la sesión del paciente en Firestore
    const sesion = await firestore.getSesion(remitente);
    const msgClean = mensaje.trim().toLowerCase();

    // Palabras clave de saludo para reiniciar o iniciar conversación
    const saludos = ['hola', 'buen dia', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'iniciar', 'menu', 'inicio', 'recomenzar', 'bot', 'ayuda', 'start'];
    const esSaludo = saludos.some(saludo => msgClean.includes(saludo));

    // Si es un saludo o el estado actual es 'inicio', mostrar Saludo de Bienvenida
    if (esSaludo || sesion.estado === 'inicio') {
      await firestore.saveSesion(remitente, 'esperando_opcion_principal');
      return {
        remitente,
        respuesta: MESSAGES.SALUDO_BIENVENIDA,
        estadoActual: 'esperando_opcion_principal',
        enHorario: true,
        timestamp
      };
    }

    // 3. Procesar según el Estado Actual de la conversación
    switch (sesion.estado) {
      case 'esperando_opcion_principal': {
        const opcion = msgClean.charAt(0); // Tomar primera letra (a, b, c, d, e)

        if (opcion === 'a') {
          await firestore.saveSesion(remitente, 'esperando_opcion_a_sub');
          return {
            remitente,
            respuesta: MESSAGES.SUBMENU_OPCION_A,
            estadoActual: 'esperando_opcion_a_sub',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'b') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_b');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_B,
            estadoActual: 'esperando_datos_opcion_b',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'c') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_c');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_C,
            estadoActual: 'esperando_datos_opcion_c',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'd') {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_d');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_D,
            estadoActual: 'esperando_datos_opcion_d',
            enHorario: true,
            timestamp
          };
        } else if (opcion === 'e') {
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
            respuesta: MESSAGES.OPCION_INVALIDA,
            estadoActual: 'esperando_opcion_principal',
            enHorario: true,
            timestamp
          };
        }
      }

      case 'esperando_opcion_a_sub': {
        const subOpcion = msgClean.charAt(0); // Tomar número (1, 2, 3)

        if (subOpcion === '1') {
          await firestore.saveSesion(remitente, 'esperando_datos_a1');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_A1_ORL,
            estadoActual: 'esperando_datos_a1',
            enHorario: true,
            timestamp
          };
        } else if (subOpcion === '2') {
          await firestore.saveSesion(remitente, 'esperando_datos_a2');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_A2_ESTUDIOS,
            estadoActual: 'esperando_datos_a2',
            enHorario: true,
            timestamp
          };
        } else if (subOpcion === '3') {
          await firestore.saveSesion(remitente, 'esperando_datos_a3');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_A3_CIRUGIAS,
            estadoActual: 'esperando_datos_a3',
            enHorario: true,
            timestamp
          };
        } else {
          return {
            remitente,
            respuesta: `⚠️ Opción no válida.\n\n${MESSAGES.SUBMENU_OPCION_A}`,
            estadoActual: 'esperando_opcion_a_sub',
            enHorario: true,
            timestamp
          };
        }
      }

      // Estados de Recolección de Datos Finales
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
        let imagenSubidaUrl: string | undefined = undefined;
        let proveedorAlmacenamiento: string | undefined = undefined;

        // Si el usuario adjuntó una imagen (pedido médico / carnet)
        if (imagenBase64) {
          try {
            const uploadRes = await ImageUploadService.uploadImage(imagenBase64, imagenNombre || `${remitente}_${Date.now()}.jpg`, env);
            imagenSubidaUrl = uploadRes.url;
            proveedorAlmacenamiento = uploadRes.provider;
          } catch (err) {
            console.error('Error al procesar subida de imagen:', err);
          }
        }

        // Estructurar el objeto de datos recolectados
        const datosEstructurados = {
          tipoSolicitud: opcionElegida,
          contenidoMensaje: mensaje,
          lineasParseadas: mensaje.split('\n').map(l => l.trim()).filter(l => l.length > 0),
          imagenUrl: imagenSubidaUrl || null,
          proveedorAlmacenamiento: proveedorAlmacenamiento || null
        };

        // Guardar la consulta en la colección "consultas" en Firestore con estado "pendiente"
        await firestore.crearConsulta(remitente, opcionElegida, datosEstructurados);

        // Resetear la sesión del paciente a 'inicio'
        await firestore.saveSesion(remitente, 'inicio');

        let confirmacionMsg = MESSAGES.CONFIRMACION_CONSULTA_RECIBIDA;
        if (imagenSubidaUrl) {
          confirmacionMsg += `\n\n📷 *Imagen/Pedido adjuntado exitosamente en ${proveedorAlmacenamiento === 'google_drive' ? 'Google Drive' : proveedorAlmacenamiento === 'supabase' ? 'Supabase' : 'Almacenamiento'}:*\n[Ver Imagen](${imagenSubidaUrl})`;
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
          respuesta: MESSAGES.SALUDO_BIENVENIDA,
          estadoActual: 'esperando_opcion_principal',
          enHorario: true,
          timestamp
        };
      }
    }
  }
}
