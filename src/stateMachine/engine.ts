import { WebhookPayload, WebhookResponse, StateType, UserSession, Env } from '../types';
import { MESSAGES } from '../templates/messages';
import { FirestoreService } from '../services/firestoreService';
import { ScheduleService } from '../services/scheduleService';
import { ImageUploadService } from '../services/imageUploadService';

export class StateEngine {
  public static async processMessage(payload: WebhookPayload, env?: Env): Promise<WebhookResponse> {
    const remitente = payload.remitente.trim();
    const mensaje = payload.mensaje.trim();
    const simulatedTime = payload.simulatedTime;
    const imagenBase64 = payload.imagenBase64;
    const imagenNombre = payload.imagenNombre;
    const timestamp = new Date().toISOString();

    const firestore = new FirestoreService(env);

    // 1. Control de Horario (Persistido en Firestore)
    const scheduleMode = await firestore.getScheduleMode();
    const scheduleCheck = ScheduleService.isWithinBusinessHours(simulatedTime, scheduleMode);
    if (!scheduleCheck.isWithinHours) {
      return {
        remitente,
        respuesta: MESSAGES.FUERA_DE_HORARIO,
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
          respuesta: MESSAGES.SALUDO_BIENVENIDA,
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
        respuesta: MESSAGES.SALUDO_BIENVENIDA,
        estadoActual: 'esperando_opcion_principal',
        enHorario: true,
        timestamp
      };
    }

    // 5. Máquina de estados
    switch (sesion.estado) {

      case 'esperando_opcion_principal': {
        const input = msgClean.replace(/[^a-z0-9]/g, '');

        if (input === 'a' || input === '1' || input.includes('turno') || input.includes('solicitar')) {
          await firestore.saveSesion(remitente, 'esperando_opcion_a_sub');
          return {
            remitente,
            respuesta: MESSAGES.SUBMENU_OPCION_A,
            estadoActual: 'esperando_opcion_a_sub',
            enHorario: true,
            timestamp
          };
        } else if (input === 'b' || input === '2' || input.includes('autoriz')) {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_b');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_B,
            estadoActual: 'esperando_datos_opcion_b',
            enHorario: true,
            timestamp
          };
        } else if (input === 'c' || input === '3' || input.includes('consulta') || input.includes('ayuda')) {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_c');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_C,
            estadoActual: 'esperando_datos_opcion_c',
            enHorario: true,
            timestamp
          };
        } else if (input === 'd' || input === '4' || input.includes('pami')) {
          await firestore.saveSesion(remitente, 'esperando_datos_opcion_d');
          return {
            remitente,
            respuesta: MESSAGES.PLANTILLA_OPCION_D,
            estadoActual: 'esperando_datos_opcion_d',
            enHorario: true,
            timestamp
          };
        } else if (input === 'e' || input === '5' || input.includes('reprogram') || input.includes('cancel')) {
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
            respuesta: MESSAGES.SALUDO_BIENVENIDA,
            estadoActual: 'esperando_opcion_principal',
            enHorario: true,
            timestamp
          };
        }
      }

      case 'esperando_opcion_a_sub': {
        const subInput = msgClean.replace(/[^a-z0-9]/g, '');
        if (subInput === '1' || subInput.includes('orl') || subInput.includes('medico')) {
          await firestore.saveSesion(remitente, 'esperando_datos_a1');
          return { remitente, respuesta: MESSAGES.PLANTILLA_A1_ORL, estadoActual: 'esperando_datos_a1', enHorario: true, timestamp };
        } else if (subInput === '2' || subInput.includes('estudio')) {
          await firestore.saveSesion(remitente, 'esperando_datos_a2');
          return { remitente, respuesta: MESSAGES.PLANTILLA_A2_ESTUDIOS, estadoActual: 'esperando_datos_a2', enHorario: true, timestamp };
        } else if (subInput === '3' || subInput.includes('cirugia')) {
          await firestore.saveSesion(remitente, 'esperando_datos_a3');
          return { remitente, respuesta: MESSAGES.PLANTILLA_A3_CIRUGIAS, estadoActual: 'esperando_datos_a3', enHorario: true, timestamp };
        } else {
          return {
            remitente,
            respuesta: MESSAGES.SUBMENU_OPCION_A,
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

        const opcionElegida = opcionMap[sesion.estado] || 'A1_Turno_ORL_9Datos';
        return await this.guardarConsultaFinal(remitente, opcionElegida, mensaje, imagenBase64, imagenNombre, env, timestamp, firestore);
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
    // Verificar si el paciente ya tiene una consulta activa sin atender
    const consultasExistentes = await firestore.getConsultas();
    const consultaActiva = consultasExistentes.find(c => c.remitente === remitente && c.estado === 'pendiente');

    if (consultaActiva) {
      // Adjuntar fotos/mensajes adicionales a la misma tarjeta existente
      await firestore.appendPacienteMensajeAConsulta(remitente, mensaje, imagenBase64);
      await firestore.saveSesion(remitente, 'esperando_atencion_humana');

      return {
        remitente,
        respuesta: '', // Silencio para no enviar confirmaciones duplicadas por cada foto
        estadoActual: 'esperando_atencion_humana',
        enHorario: true,
        timestamp
      };
    }

    // Si no existía consulta activa, crear la tarjeta única
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
