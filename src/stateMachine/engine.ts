import { WebhookPayload, WebhookResponse, Env, MenuTreeConfig } from '../types';
import { MESSAGES } from '../templates/messages';
import { ScheduleService } from '../services/scheduleService';
import { FirestoreService } from '../services/firestoreService';
import { ImageUploadService } from '../services/imageUploadService';

function buildFullMenuMessage(menuTree: MenuTreeConfig): string {
  const welcome = menuTree.welcomeMessage || MESSAGES.SALUDO_BIENVENIDA;
  const items = menuTree.items || [];
  if (items.length === 0) return welcome;

  let text = welcome.trim() + '\n\n';
  items.forEach(item => {
    text += `*${item.key.toUpperCase()})* ${item.label}\n`;
  });
  return text.trim();
}

export class StateEngine {
  public static async processMessage(
    payload: WebhookPayload,
    env?: Env
  ): Promise<WebhookResponse> {
    const firestore = new FirestoreService(env);
    const remitente = payload.remitente.trim();
    const altRemitente = payload.altRemitente ? payload.altRemitente.trim() : undefined;
    const pushName = payload.pushName ? payload.pushName.trim() : undefined;
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
    const saludoBienvenidaMsg = buildFullMenuMessage(menuTree);

    // 1. CHECK SI EL REMITENTE ES UN CONTACTO PRIORITARIO (VIP)
    // Para contactos prioritarios, BYPASS COMPLETO DEL BOT: escriben libremente y se envía directo a secretaría.
    const vipContacts = await firestore.getVipContacts();
    const vipMatch = vipContacts.find(v => {
      const vPhone = (v.phone || '').trim().toLowerCase();
      if (!vPhone) return false;
      const rLower = remitente.toLowerCase();
      const altLower = (altRemitente || '').toLowerCase();
      const vDigitsOnly = vPhone.replace(/[^0-9]/g, '');

      if (vPhone.includes('@lid') || (vDigitsOnly.length > 10 && !vPhone.startsWith('54'))) {
        if (rLower.includes(vDigitsOnly) || altLower.includes(vDigitsOnly)) return true;
      }
      const rDigits = rLower.replace(/[^0-9]/g, '');
      const altDigits = altLower.replace(/[^0-9]/g, '');
      if (vDigitsOnly.length >= 6) {
        if (rDigits && (rDigits.includes(vDigitsOnly) || vDigitsOnly.includes(rDigits))) return true;
        if (altDigits && (altDigits.includes(vDigitsOnly) || vDigitsOnly.includes(altDigits))) return true;
      }
      if (v.name && pushName && pushName.toLowerCase().includes(v.name.toLowerCase())) return true;
      return false;
    });

    if (vipMatch) {
      console.log(`⭐ [CONTACTO PRIORITARIO DETECTADO] ${pushName || vipMatch.name} (${remitente}). Bypass de menú automático.`);
      return await this.guardarConsultaFinal(remitente, altRemitente, pushName || vipMatch.name, 'Prioritario', mensaje, imagenBase64, imagenNombre, pdfBase64, pdfNombre, env, timestamp, firestore, true);
    }

    // 2. FUERA DE HORARIO DE ATENCIÓN (SOLO APLICA A PACIENTES NORMALES)
    if (!scheduleInfo.isWithinHours) {
      await firestore.saveSesion(remitente, 'inicio');
      return {
        remitente,
        respuesta: fueraDeHorarioMsg,
        estadoActual: 'inicio',
        enHorario: false,
        timestamp
      };
    }

    const sesion = await firestore.getSesion(remitente, altRemitente);
    const msgClean = mensaje.toLowerCase().trim();

    // Reset comandos globales explícitos únicamente ("reset", "cancelar", "menu")
    const esSaludoExplicit = msgClean === 'reset' || msgClean === 'cancelar' || msgClean === 'menu';

    // 3. ATENCIÓN HUMANA ACTIVA (SILENCIO TOTAL DEL BOT PARA CONVERSACIÓN FLUIDA)
    if (sesion.estado === 'esperando_atencion_humana' && !esSaludoExplicit) {
      if (mensaje.length > 0 || imagenBase64 || pdfBase64) {
        await firestore.appendPacienteMensajeAConsulta(remitente, mensaje, imagenBase64, pdfBase64, pdfNombre, altRemitente);
      }
      return {
        remitente,
        respuesta: '', // SILENCIO ABSOLUTO DEL BOT: LA SECRETARÍA ESTÁ CONVERSANDO DIRECTAMENTE
        estadoActual: 'esperando_atencion_humana',
        enHorario: true,
        timestamp
      };
    }

    // Si el usuario envía reset / cancelar, volver al menú inicial
    if (esSaludoExplicit) {
      await firestore.saveSesion(remitente, 'inicio');
      return {
        remitente,
        respuesta: saludoBienvenidaMsg,
        estadoActual: 'inicio',
        enHorario: true,
        timestamp
      };
    }

    // 4. MÁQUINA DE ESTADOS - PROCESAMIENTO SEGÚN EL MENÚ DINÁMICO
    switch (sesion.estado) {
      case 'inicio': {
        const itemElegido = (menuTree.items || []).find(i => i.key.toLowerCase() === msgClean);

        if (!itemElegido) {
          return {
            remitente,
            respuesta: saludoBienvenidaMsg,
            estadoActual: 'inicio',
            enHorario: true,
            timestamp
          };
        }

        if (itemElegido.type === 'submenu') {
          await firestore.saveSesion(remitente, 'esperando_sub_a', { parentKey: itemElegido.key });

          let subText = `*${itemElegido.label}*\nPor favor responde con el número de la opción elegida:\n\n`;
          (itemElegido.subItems || []).forEach(sub => {
            subText += `*${sub.key})* ${sub.label}\n`;
          });

          return {
            remitente,
            respuesta: subText.trim(),
            estadoActual: 'esperando_sub_a',
            enHorario: true,
            timestamp
          };
        } else if (itemElegido.type === 'form') {
          await firestore.saveSesion(remitente, 'esperando_datos_a_1', { optionKey: itemElegido.key, label: itemElegido.label });
          return {
            remitente,
            respuesta: itemElegido.responseTemplate || MESSAGES.PLANTILLA_A1_ORL,
            estadoActual: 'esperando_datos_a_1',
            enHorario: true,
            timestamp
          };
        } else if (itemElegido.type === 'info') {
          await firestore.saveSesion(remitente, 'inicio');
          return {
            remitente,
            respuesta: itemElegido.responseTemplate || 'Gracias por consultar.',
            estadoActual: 'inicio',
            enHorario: true,
            timestamp
          };
        }

        return {
          remitente,
          respuesta: saludoBienvenidaMsg,
          estadoActual: 'inicio',
          enHorario: true,
          timestamp
        };
      }

      case 'esperando_sub_a': {
        const parentKey = sesion.datosTemporales?.parentKey || 'a';
        const parentItem = (menuTree.items || []).find(i => i.key.toLowerCase() === parentKey.toLowerCase());
        const subItems = parentItem?.subItems || [];

        const subElegido = subItems.find(s => s.key.toLowerCase() === msgClean);

        if (!subElegido) {
          let subText = `⚠️ Opción no válida. Por favor responde con el número de la opción elegida:\n\n`;
          subItems.forEach(sub => {
            subText += `*${sub.key})* ${sub.label}\n`;
          });
          return {
            remitente,
            respuesta: subText.trim(),
            estadoActual: 'esperando_sub_a',
            enHorario: true,
            timestamp
          };
        }

        if (subElegido.type === 'info') {
          await firestore.saveSesion(remitente, 'inicio');
          return {
            remitente,
            respuesta: subElegido.responseTemplate || 'Gracias por consultar.',
            estadoActual: 'inicio',
            enHorario: true,
            timestamp
          };
        }

        await firestore.saveSesion(remitente, 'esperando_datos_a_1', { optionKey: `${parentKey}_${subElegido.key}`, label: subElegido.label });
        return {
          remitente,
          respuesta: subElegido.responseTemplate || MESSAGES.PLANTILLA_A1_ORL,
          estadoActual: 'esperando_datos_a_1',
          enHorario: true,
          timestamp
        };
      }

      case 'esperando_datos_a_1': {
        return await this.guardarConsultaFinal(remitente, altRemitente, pushName, sesion.datosTemporales?.label || 'Solicitud', mensaje, imagenBase64, imagenNombre, pdfBase64, pdfNombre, env, timestamp, firestore);
      }

      default: {
        await firestore.saveSesion(remitente, 'inicio');
        return {
          remitente,
          respuesta: saludoBienvenidaMsg,
          estadoActual: 'inicio',
          enHorario: true,
          timestamp
        };
      }
    }
  }

  private static async guardarConsultaFinal(
    remitente: string,
    altRemitente?: string,
    pushName?: string,
    opcionLabel: string = 'Solicitud',
    mensaje: string = '',
    imagenBase64?: string,
    imagenNombre?: string,
    pdfBase64?: string,
    pdfNombre?: string,
    env?: Env,
    timestamp?: string,
    firestore?: FirestoreService,
    isVipBypass: boolean = false
  ): Promise<WebhookResponse> {
    const fs = firestore || new FirestoreService(env);
    const ts = timestamp || new Date().toISOString();

    let uploadedImgUrl: string | undefined = undefined;
    if (imagenBase64) {
      const uploadResult = await ImageUploadService.uploadImage(imagenBase64, imagenNombre, env);
      if (uploadResult && uploadResult.url) {
        uploadedImgUrl = uploadResult.url;
      } else {
        uploadedImgUrl = imagenBase64;
      }
    }

    const datosRec: Record<string, any> = {
      tipoSolicitud: opcionLabel,
      contenidoMensaje: mensaje,
      altRemitente: altRemitente || null,
      pushName: pushName || null,
      lineasParseadas: parsearLineasFormulario(mensaje),
      respuestasPaciente: [],
      respuestasSecretaria: [],
      imagenBase64: uploadedImgUrl || imagenBase64 || null,
      imagenUrl: uploadedImgUrl || imagenBase64 || null,
      imagenesAdjuntas: (uploadedImgUrl || imagenBase64) ? [uploadedImgUrl || imagenBase64] : [],
      pdfsAdjuntos: pdfBase64 ? [{ nombre: pdfNombre || 'documento.pdf', base64: pdfBase64, timestamp: ts }] : []
    };

    const idConsulta = await fs.crearConsulta(remitente, opcionLabel, datosRec);
    await fs.saveSesion(remitente, 'esperando_atencion_humana');

    if (altRemitente) {
      await fs.saveSesion(altRemitente, 'esperando_atencion_humana');
    }

    const respText = MESSAGES.CONFIRMACION_CONSULTA_RECIBIDA;

    return {
      remitente,
      respuesta: respText,
      estadoActual: 'esperando_atencion_humana',
      enHorario: true,
      timestamp: ts,
      imagenSubidaUrl: uploadedImgUrl
    };
  }
}

function parsearLineasFormulario(mensaje: string): string[] {
  if (!mensaje) return [];
  return mensaje
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}
