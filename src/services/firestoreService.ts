import { Env, StateType, UserSession, ChatMessage, MenuTreeConfig, MenuItemOption, DoctorItem } from '../types';
import { CONFIG } from '../config';
import { ScheduleMode } from './scheduleService';
import { MESSAGES } from '../templates/messages';

export interface PendingOutgoingMsg {
  id: string;
  remitente: string;
  altRemitente?: string;
  targetJid?: string;
  text: string;
  timestamp: string;
  pdfUrl?: string;
  pdfNombre?: string;
  pdfBase64?: string;
  imagenBase64?: string;
}

export interface BotConfigMessages {
  saludoBienvenida?: string;
  fueraDeHorario?: string;
  plantillaA1?: string;
  plantillaA2?: string;
  plantillaB?: string;
  confirmacionCierre?: string;
}

export interface TagDefinition {
  key: string;
  label: string;
  color: string;
}

export interface QuickReplyItem {
  id: string;
  title: string;
  text: string;
}

export interface PredefinedPdfItem {
  id: string;
  title: string;
  name: string;
  base64?: string;
}

export interface VipContactItem {
  id: string;
  phone: string;
  name: string;
  role: string;
  priority: 'vip' | 'urgente';
}

export const DEFAULT_DOCTORS: DoctorItem[] = [
  { id: 'doc_1', name: 'Dra. Venier', specialty: 'Otorrinolaringología (ORL)', phone: '3510000000' },
  { id: 'doc_2', name: 'Dr. López', specialty: 'Cirugía General / Telemedicina', phone: '3510000001' }
];

export const DEFAULT_QUICK_REPLIES: QuickReplyItem[] = [
  { id: 'qr_1', title: '✅ Confirmar Turno', text: '✅ ¡Hola! Tu turno fue agendado con éxito.' },
  { id: 'qr_2', title: '📷 Pedir Foto Legible', text: '📸 La foto enviada no es legible. Por favor enviá una foto bien nítida.' },
  { id: 'qr_3', title: '🩺 Estado PAMI', text: '⚕️ Tu solicitud de PAMI fue recibida y enviada a auditoría médica.' }
];

export const DEFAULT_PREDEFINED_PDFS: PredefinedPdfItem[] = [
  { id: 'sangre', title: '📄 Preparación Análisis de Sangre (Laboratorio)', name: 'Indicaciones_Analisis_Sangre_Laboratorio.pdf' },
  { id: 'ecografia', title: '📄 Preparación Ecografía / Tomografía (Ayuno 8hs)', name: 'Indicaciones_Ecografia_Tomografia_Ayuno.pdf' },
  { id: 'cirugia', title: '📄 Cuidados Post-Cirugía y Reposo', name: 'Indicaciones_Post_Cirugia_Cuidados.pdf' },
  { id: 'orl', title: '📄 Instructivo Estudios ORL', name: 'Instructivo_Estudios_ORL.pdf' }
];

export const DEFAULT_TAGS: Record<string, TagDefinition> = {
  'turno_confirmado': { key: 'turno_confirmado', label: '🟢 Turno Dado', color: '#059669' },
  'falta_foto': { key: 'falta_foto', label: '🟡 Falta Foto', color: '#d97706' },
  'urgente': { key: 'urgente', label: '🔴 Urgente', color: '#dc2626' },
  'pami': { key: 'pami', label: '🟣 PAMI', color: '#7c3aed' },
  'en_revision': { key: 'en_revision', label: '🔵 En Revisión', color: '#2563eb' }
};

export const DEFAULT_MENU_TREE: MenuTreeConfig = {
  welcomeMessage: `🟢 *Bienvenido al canal digital de COAT*\n\nHorario Lunes a Viernes de 8:00 a 20:00 hs. Guardia de ORL de 9:00 a 18:00 hs.\nSábados y Domingos cerrado.\n\n🚩 *Este número solo recibe mensajes escritos.*\n\nSu consulta será respondida dentro de las 48 hs hábiles.\n\nPor favor, responda con la letra de la opción que necesite:`,
  items: [
    {
      key: 'a',
      label: 'Si necesita solicitar turno',
      type: 'submenu',
      subItems: [
        { key: '1', label: 'Médico ORL (Otorrinolaringología)', type: 'form', responseTemplate: MESSAGES.PLANTILLA_A1_ORL },
        { key: '2', label: 'Estudios Médicos', type: 'form', responseTemplate: MESSAGES.PLANTILLA_A2_ESTUDIOS },
        { key: '3', label: 'Cirugías', type: 'form', responseTemplate: MESSAGES.PLANTILLA_A3_CIRUGIAS }
      ]
    },
    { key: 'b', label: 'Si necesita autorización de estudios', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_B },
    { key: 'c', label: 'Consultas Generales / Ayuda', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_C },
    { key: 'd', label: 'Consulta sobre cirugías programadas', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_D },
    { key: 'e', label: 'Reprogramación o Cancelación de Turno', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_E },
    { key: 'f', label: 'Si es afiliado de PAMI y quiere que lo contacten', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_F }
  ]
};

export class FirestoreService {
  private projectId: string;
  private apiKey?: string;

  private static inMemorySessions: Map<string, UserSession> = new Map();
  private static inMemoryConsultas: Array<Record<string, any>> = [];
  private static pendingOutgoingMemory: PendingOutgoingMsg[] = [];
  private static globalScheduleMode: ScheduleMode = 'auto';
  private static globalBotConfig: BotConfigMessages = {};
  private static globalMenuTree: MenuTreeConfig | null = null;
  private static globalTags: Record<string, TagDefinition> | null = null;
  private static globalQuickReplies: QuickReplyItem[] | null = null;
  private static globalPdfConfig: PredefinedPdfItem[] | null = null;
  private static globalVipContacts: VipContactItem[] | null = null;
  private static globalDoctors: DoctorItem[] | null = null;

  constructor(env?: Env) {
    this.projectId = env?.FIREBASE_PROJECT_ID || 'wabot-cc80f';
    this.apiKey = env?.FIREBASE_API_KEY;
  }

  private toFirestoreFields(obj: Record<string, any>): Record<string, any> {
    const fields: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val === undefined || val === null) {
        fields[key] = { nullValue: null };
      } else if (typeof val === 'string') {
        fields[key] = { stringValue: val };
      } else if (typeof val === 'number') {
        fields[key] = Number.isInteger(val) ? { integerValue: val.toString() } : { doubleValue: val };
      } else if (typeof val === 'boolean') {
        fields[key] = { booleanValue: val };
      } else if (Array.isArray(val)) {
        fields[key] = { arrayValue: { values: val.map(item => typeof item === 'object' ? { mapValue: { fields: this.toFirestoreFields(item) } } : { stringValue: String(item) }) } };
      } else if (typeof val === 'object') {
        fields[key] = { mapValue: { fields: this.toFirestoreFields(val) } };
      }
    }
    return fields;
  }

  private fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    if (!fields) return result;

    for (const [key, valueObj] of Object.entries(fields)) {
      if ('stringValue' in valueObj) result[key] = valueObj.stringValue;
      else if ('integerValue' in valueObj) result[key] = parseInt(valueObj.integerValue, 10);
      else if ('doubleValue' in valueObj) result[key] = parseFloat(valueObj.doubleValue);
      else if ('booleanValue' in valueObj) result[key] = valueObj.booleanValue;
      else if ('mapValue' in valueObj) result[key] = this.fromFirestoreFields(valueObj.mapValue.fields || {});
      else if ('arrayValue' in valueObj) {
        result[key] = (valueObj.arrayValue.values || []).map((v: any) => {
          if ('mapValue' in v) return this.fromFirestoreFields(v.mapValue.fields || {});
          if ('stringValue' in v) return v.stringValue;
          return v;
        });
      }
      else if ('nullValue' in valueObj) result[key] = null;
    }
    return result;
  }

  private async getPendingQueueFromFirestore(): Promise<PendingOutgoingMsg[]> {
    if (!this.projectId) return [];
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/pending_queue${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          return fields.items as PendingOutgoingMsg[];
        }
      }
    } catch (e) {}
    return [];
  }

  public async getDoctors(): Promise<DoctorItem[]> {
    if (FirestoreService.globalDoctors) return FirestoreService.globalDoctors;
    if (!this.projectId) return DEFAULT_DOCTORS;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/doctor_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          FirestoreService.globalDoctors = fields.items as DoctorItem[];
          return fields.items as DoctorItem[];
        }
      }
    } catch (e) {}

    return DEFAULT_DOCTORS;
  }

  public async saveDoctors(items: DoctorItem[]): Promise<void> {
    FirestoreService.globalDoctors = items;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/doctor_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ items, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar doctor_config en Firestore:', e);
    }
  }

  public async getVipContacts(): Promise<VipContactItem[]> {
    if (FirestoreService.globalVipContacts) return FirestoreService.globalVipContacts;
    if (!this.projectId) return [];

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/vip_contacts${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          FirestoreService.globalVipContacts = fields.items as VipContactItem[];
          return fields.items as VipContactItem[];
        }
      }
    } catch (e) {}

    return [];
  }

  public async saveVipContacts(items: VipContactItem[]): Promise<void> {
    FirestoreService.globalVipContacts = items;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/vip_contacts${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ items, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar vip_contacts en Firestore:', e);
    }
  }

  public async getQuickReplies(): Promise<QuickReplyItem[]> {
    if (FirestoreService.globalQuickReplies) return FirestoreService.globalQuickReplies;
    if (!this.projectId) return DEFAULT_QUICK_REPLIES;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/quick_replies${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          FirestoreService.globalQuickReplies = fields.items as QuickReplyItem[];
          return fields.items as QuickReplyItem[];
        }
      }
    } catch (e) {}

    return DEFAULT_QUICK_REPLIES;
  }

  public async saveQuickReplies(items: QuickReplyItem[]): Promise<void> {
    FirestoreService.globalQuickReplies = items;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/quick_replies${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ items, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar quick_replies en Firestore:', e);
    }
  }

  public async getPdfConfig(): Promise<PredefinedPdfItem[]> {
    if (FirestoreService.globalPdfConfig) return FirestoreService.globalPdfConfig;
    if (!this.projectId) return DEFAULT_PREDEFINED_PDFS;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/pdf_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          FirestoreService.globalPdfConfig = fields.items as PredefinedPdfItem[];
          return fields.items as PredefinedPdfItem[];
        }
      }
    } catch (e) {}

    return DEFAULT_PREDEFINED_PDFS;
  }

  public async savePdfConfig(items: PredefinedPdfItem[]): Promise<void> {
    FirestoreService.globalPdfConfig = items;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/pdf_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ items, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar pdf_config en Firestore:', e);
    }
  }

  public async getTagConfig(): Promise<Record<string, TagDefinition>> {
    if (FirestoreService.globalTags) return FirestoreService.globalTags;
    if (!this.projectId) return DEFAULT_TAGS;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/tag_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.tags) {
          FirestoreService.globalTags = fields.tags as Record<string, TagDefinition>;
          return fields.tags as Record<string, TagDefinition>;
        }
      }
    } catch (e) {}

    return DEFAULT_TAGS;
  }

  public async saveTagConfig(tags: Record<string, TagDefinition>): Promise<void> {
    FirestoreService.globalTags = tags;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/tag_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ tags, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar tag_config en Firestore:', e);
    }
  }

  public async getScheduleMode(): Promise<ScheduleMode> {
    if (!this.projectId) return FirestoreService.globalScheduleMode;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/global_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.mode) {
          FirestoreService.globalScheduleMode = fields.mode as ScheduleMode;
          return fields.mode as ScheduleMode;
        }
      }
    } catch (e) {}

    return FirestoreService.globalScheduleMode;
  }

  public async saveScheduleMode(mode: ScheduleMode): Promise<void> {
    FirestoreService.globalScheduleMode = mode;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/global_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ mode, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar scheduleMode en Firestore:', e);
    }
  }

  public async getMenuTree(): Promise<MenuTreeConfig> {
    if (!this.projectId) return DEFAULT_MENU_TREE;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/bot_menu_tree${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          return fields as unknown as MenuTreeConfig;
        }
      }
    } catch (e) {}

    return DEFAULT_MENU_TREE;
  }

  public async saveMenuTree(tree: MenuTreeConfig): Promise<void> {
    FirestoreService.globalMenuTree = tree;
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/bot_menu_tree${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ ...tree, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar bot_menu_tree en Firestore:', e);
    }
  }

  public async getBotConfig(): Promise<BotConfigMessages> {
    if (!this.projectId) return FirestoreService.globalBotConfig;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/bot_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields) {
          FirestoreService.globalBotConfig = fields as BotConfigMessages;
          return fields as BotConfigMessages;
        }
      }
    } catch (e) {}

    return FirestoreService.globalBotConfig;
  }

  public async saveBotConfig(config: BotConfigMessages): Promise<void> {
    FirestoreService.globalBotConfig = { ...FirestoreService.globalBotConfig, ...config };
    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/bot_config${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: this.toFirestoreFields({ ...config, updatedAt: new Date().toISOString() })
        })
      });
    } catch (e) {
      console.error('Error al guardar bot_config en Firestore:', e);
    }
  }

  public async getSesion(remitente: string, altRemitente?: string): Promise<UserSession> {
    const docId = encodeURIComponent(remitente.trim());

    let sesionMem = FirestoreService.inMemorySessions.get(docId);

    if (!sesionMem && altRemitente) {
      const altId = encodeURIComponent(altRemitente.trim());
      sesionMem = FirestoreService.inMemorySessions.get(altId);
    }

    if (!sesionMem) {
      const rDigits = remitente.replace(/[^0-9]/g, '');
      const altDigits = (altRemitente || '').replace(/[^0-9]/g, '');

      for (const [key, sess] of FirestoreService.inMemorySessions.entries()) {
        const kDigits = key.replace(/[^0-9]/g, '');
        if (kDigits.length >= 7) {
          if (rDigits.length >= 7 && rDigits.slice(-8) === kDigits.slice(-8)) return sess;
          if (altDigits.length >= 7 && altDigits.slice(-8) === kDigits.slice(-8)) return sess;
        }
      }
    }

    if (sesionMem) {
      return sesionMem;
    }

    if (!this.projectId) {
      return {
        remitente,
        estado: 'inicio',
        datosTemporales: {},
        historialMensajes: [],
        updatedAt: new Date().toISOString()
      };
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/${docId}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);

      if (!res.ok && altRemitente) {
        const altId = encodeURIComponent(altRemitente.trim());
        const altUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/${altId}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
        const altRes = await fetch(altUrl);
        if (altRes.ok) {
          const dataAlt: any = await altRes.json();
          const fieldsAlt = this.fromFirestoreFields(dataAlt.fields || {});
          const sesionAlt: UserSession = {
            remitente: altRemitente,
            estado: (fieldsAlt.estado as StateType) || 'inicio',
            datosTemporales: fieldsAlt.datosTemporales || {},
            historialMensajes: fieldsAlt.historialMensajes || [],
            updatedAt: fieldsAlt.updatedAt || new Date().toISOString()
          };
          FirestoreService.inMemorySessions.set(docId, sesionAlt);
          return sesionAlt;
        }
      }

      if (!res.ok) {
        return {
          remitente,
          estado: 'inicio',
          datosTemporales: {},
          historialMensajes: [],
          updatedAt: new Date().toISOString()
        };
      }

      const data: any = await res.json();
      const fields = this.fromFirestoreFields(data.fields || {});

      const sesionRecuperada: UserSession = {
        remitente,
        estado: (fields.estado as StateType) || 'inicio',
        datosTemporales: fields.datosTemporales || {},
        historialMensajes: fields.historialMensajes || [],
        updatedAt: fields.updatedAt || new Date().toISOString()
      };

      FirestoreService.inMemorySessions.set(docId, sesionRecuperada);
      return sesionRecuperada;
    } catch (err) {
      return {
        remitente,
        estado: 'inicio',
        datosTemporales: {},
        historialMensajes: [],
        updatedAt: new Date().toISOString()
      };
    }
  }

  public async saveSesion(remitente: string, estado: StateType | string, datosTemporales: Record<string, any> = {}, historialMensajes: ChatMessage[] = []): Promise<void> {
    const docId = encodeURIComponent(remitente.trim());
    const updatedAt = new Date().toISOString();

    const sesionMem = FirestoreService.inMemorySessions.get(docId);
    const historialFinal = historialMensajes.length > 0 ? historialMensajes : (sesionMem?.historialMensajes || []);

    const sesionData: UserSession = {
      remitente,
      estado: estado as StateType,
      datosTemporales,
      historialMensajes: historialFinal,
      updatedAt
    };

    FirestoreService.inMemorySessions.set(docId, sesionData);

    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/${docId}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const firestoreBody = {
        fields: this.toFirestoreFields(sesionData)
      };

      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firestoreBody)
      });
    } catch (err) {
      console.error('Error al guardar sesión en Firestore:', err);
    }
  }

  public async agregarMensajeHistorial(remitente: string, msg: ChatMessage): Promise<void> {
    const sesion = await this.getSesion(remitente);
    const historial = [...(sesion.historialMensajes || []), msg];
    await this.saveSesion(remitente, sesion.estado, sesion.datosTemporales, historial);
  }

  public async appendPacienteMensajeAConsulta(
    remitente: string,
    textoMensaje: string,
    imagenBase64?: string,
    pdfBase64?: string,
    pdfNombre?: string,
    altRemitente?: string,
    pushName?: string
  ): Promise<boolean> {
    const consultas = await this.getConsultas();

    const rDigits = remitente.replace(/[^0-9]/g, '');
    const altDigits = (altRemitente || '').replace(/[^0-9]/g, '');

    const consultaPaciente = consultas.find(c => {
      if (c.estado !== 'pendiente') return false;

      if (c.remitente === remitente) return true;
      if (altRemitente && (c.remitente === altRemitente || c.datos?.altRemitente === altRemitente)) return true;
      if (c.datos?.altRemitente === remitente) return true;

      const cDigits = (c.remitente || '').replace(/[^0-9]/g, '');
      const cAltDigits = (c.datos?.altRemitente || '').replace(/[^0-9]/g, '');

      if (cDigits.length >= 7) {
        if (rDigits.length >= 7 && rDigits.slice(-8) === cDigits.slice(-8)) return true;
        if (altDigits.length >= 7 && altDigits.slice(-8) === cDigits.slice(-8)) return true;
      }

      if (cAltDigits.length >= 7) {
        if (rDigits.length >= 7 && rDigits.slice(-8) === cAltDigits.slice(-8)) return true;
        if (altDigits.length >= 7 && altDigits.slice(-8) === cAltDigits.slice(-8)) return true;
      }

      if (pushName && c.datos?.pushName && pushName.toLowerCase() === c.datos.pushName.toLowerCase()) return true;

      return false;
    });

    if (consultaPaciente) {
      const datos = consultaPaciente.datos || {};

      if (remitente.includes('@lid')) {
        datos.altRemitente = remitente;
      } else if (altRemitente && altRemitente.includes('@lid')) {
        datos.altRemitente = altRemitente;
      }

      const respAnteriores = datos.respuestasPaciente || [];

      let imagenesAdjuntas = Array.isArray(datos.imagenesAdjuntas) ? [...datos.imagenesAdjuntas] : [];
      if (datos.imagenBase64 && imagenesAdjuntas.length === 0) {
        imagenesAdjuntas.push(datos.imagenBase64);
      }

      if (imagenBase64 && !imagenesAdjuntas.includes(imagenBase64)) {
        imagenesAdjuntas.push(imagenBase64);
      }

      if (imagenesAdjuntas.length > 10) {
        imagenesAdjuntas = imagenesAdjuntas.slice(-10);
      }

      datos.imagenesAdjuntas = imagenesAdjuntas;

      let pdfsAdjuntos = Array.isArray(datos.pdfsAdjuntos) ? [...datos.pdfsAdjuntos] : [];
      if (pdfBase64 && !pdfsAdjuntos.some((p: any) => p.base64 === pdfBase64)) {
        pdfsAdjuntos.push({
          nombre: pdfNombre || 'documento.pdf',
          base64: pdfBase64,
          timestamp: new Date().toISOString()
        });
      }
      datos.pdfsAdjuntos = pdfsAdjuntos;

      const tagDesc = pdfBase64 ? `📄 (PDF: ${pdfNombre || 'documento.pdf'})` : (imagenBase64 ? '📷 (Foto de pedido médico)' : '');
      const nuevaResp = {
        texto: `${textoMensaje} ${tagDesc}`.trim(),
        pdfBase64: pdfBase64 || null,
        pdfNombre: pdfNombre || null,
        imagenBase64: imagenBase64 || null,
        timestamp: new Date().toISOString()
      };
      datos.respuestasPaciente = [...respAnteriores, nuevaResp];
      consultaPaciente.datos = datos;

      consultaPaciente.estado = 'pendiente';
      consultaPaciente.timestamp = new Date().toISOString();

      const targetMem = FirestoreService.inMemoryConsultas.find(c => c.id === consultaPaciente.id);
      if (targetMem) {
        targetMem.datos = datos;
        targetMem.timestamp = consultaPaciente.timestamp;
        targetMem.estado = 'pendiente';
      }

      if (this.projectId) {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${consultaPaciente.id}?updateMask.fieldPaths=datos&updateMask.fieldPaths=estado&updateMask.fieldPaths=timestamp${this.apiKey ? `&key=${this.apiKey}` : ''}`;
          await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                datos: { mapValue: { fields: this.toFirestoreFields(datos) } },
                estado: { stringValue: 'pendiente' },
                timestamp: { stringValue: consultaPaciente.timestamp }
              }
            })
          });
        } catch (e) {
          console.error('Error al actualizar consulta en Firestore:', e);
        }
      }
      return true; // Éxito: consulta pendiente encontrada y mensaje adjuntado
    }
    return false; // No hay ninguna consulta pendiente activa para este paciente
  }

  public async actualizarEtiquetasConsulta(id: string, etiquetas: string[]): Promise<boolean> {
    const consultas = await this.getConsultas();
    const target = consultas.find(c => c.id === id);
    if (target) {
      const datos = target.datos || {};
      datos.etiquetas = etiquetas;
      target.datos = datos;

      const targetMem = FirestoreService.inMemoryConsultas.find(c => c.id === id);
      if (targetMem) {
        targetMem.datos = datos;
      }

      if (this.projectId) {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${id}?updateMask.fieldPaths=datos${this.apiKey ? `&key=${this.apiKey}` : ''}`;
          const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { datos: { mapValue: { fields: this.toFirestoreFields(datos) } } } })
          });
          return res.ok;
        } catch (e) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  public async registrarRespuestaSecretaria(idConsulta: string, respuestaTexto: string): Promise<void> {
    const nuevaRespuesta = {
      texto: respuestaTexto,
      timestamp: new Date().toISOString()
    };

    // Actualizar en memoria si existe
    const targetMem = FirestoreService.inMemoryConsultas.find(c => c.id === idConsulta);
    if (targetMem) {
      const datos = targetMem.datos || {};
      const respuestasSec = datos.respuestasSecretaria || [];
      datos.respuestasSecretaria = [...respuestasSec, nuevaRespuesta];
      targetMem.datos = datos;
    }

    // Siempre guardar directo en Firestore usando GET+PATCH para no perder datos
    if (this.projectId) {
      try {
        // 1. Leer el documento actual de Firestore
        const getUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${idConsulta}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
        const getRes = await fetch(getUrl);
        let datos: any = {};
        if (getRes.ok) {
          const json: any = await getRes.json();
          const rawDatos = json.fields?.datos?.mapValue?.fields;
          if (rawDatos) {
            datos = this.fromFirestoreFields(rawDatos);
          }
        }

        // 2. Agregar la nueva respuesta
        const respuestasSec = datos.respuestasSecretaria || [];
        datos.respuestasSecretaria = [...respuestasSec, nuevaRespuesta];

        // 3. Actualizar en memoria también
        if (targetMem) targetMem.datos = datos;

        // 4. Guardar en Firestore
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${idConsulta}?updateMask.fieldPaths=datos${this.apiKey ? `&key=${this.apiKey}` : ''}`;
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { datos: { mapValue: { fields: this.toFirestoreFields(datos) } } } })
        });

        // 5. Invalidar la caché para que el próximo GET traiga datos frescos
        FirestoreService.consultasCache.lastFetch = 0;
      } catch (e) {
        console.error('Error registrando respuesta secretaria en Firestore:', e);
      }
    }
  }

  public async addPendingOutgoing(
    remitente: string,
    text: string,
    idConsulta?: string,
    pdfUrl?: string,
    pdfNombre?: string,
    pdfBase64?: string,
    imagenBase64?: string,
    altRemitente?: string,
    isForwardToDoctor: boolean = false
  ): Promise<void> {
    let targetJid = remitente;
    let computedAlt = altRemitente;

    if (idConsulta && !isForwardToDoctor) {
      const itemMem = FirestoreService.inMemoryConsultas.find(c => c.id === idConsulta);
      if (itemMem && itemMem.datos?.altRemitente) {
        computedAlt = itemMem.datos.altRemitente;
        if (computedAlt && computedAlt.includes('@lid')) {
          targetJid = computedAlt;
        }
      }
    }

    const item: PendingOutgoingMsg = {
      id: `out_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      remitente,
      altRemitente: computedAlt,
      targetJid,
      text,
      pdfUrl,
      pdfNombre,
      pdfBase64,
      imagenBase64,
      timestamp: new Date().toISOString()
    };

    if (this.projectId) {
      try {
        const existing = await this.getPendingQueueFromFirestore();
        existing.push(item);
        const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/pending_queue${this.apiKey ? `?key=${this.apiKey}` : ''}`;
        await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: this.toFirestoreFields({ items: existing, updatedAt: new Date().toISOString() })
          })
        });
      } catch (e) {
        console.error('Error al persitir pending_queue en Firestore:', e);
      }
    } else {
      FirestoreService.pendingOutgoingMemory.push(item);
    }
  }

  public async popPendingOutgoing(): Promise<PendingOutgoingMsg[]> {
    const result: PendingOutgoingMsg[] = [];

    if (this.projectId) {
      try {
        const fsItems = await this.getPendingQueueFromFirestore();
        if (fsItems.length > 0) {
          result.push(...fsItems);

          const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/pending_queue${this.apiKey ? `?key=${this.apiKey}` : ''}`;
          await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: this.toFirestoreFields({ items: [], updatedAt: new Date().toISOString() })
            })
          });
        }
      } catch (e) {
        console.error('Error al limpiar pending_queue en Firestore:', e);
      }
    } else {
      result.push(...FirestoreService.pendingOutgoingMemory);
      FirestoreService.pendingOutgoingMemory = [];
    }

    return result;
  }

  public async crearConsulta(
    remitente: string,
    opcionElegida: string,
    datosRecolectados: Record<string, any> | string
  ): Promise<string> {
    const consultaId = `consulta_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = new Date().toISOString();

    const payload = {
      id: consultaId,
      remitente,
      opcion: opcionElegida,
      estado: 'pendiente',
      datos: typeof datosRecolectados === 'string' ? { mensajeRaw: datosRecolectados } : datosRecolectados,
      timestamp,
      createdAt: timestamp
    };

    FirestoreService.inMemoryConsultas.unshift(payload);
    FirestoreService.consultasCache.lastFetch = 0;

    if (!this.projectId) return consultaId;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas?documentId=${consultaId}${this.apiKey ? `&key=${this.apiKey}` : ''}`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: this.toFirestoreFields(payload) })
      });
    } catch (err) {
      console.error('Error al crear consulta en Firestore:', err);
    }

    return consultaId;
  }

  private static consultasCache: { items: Array<Record<string, any>>; lastFetch: number } = { items: [], lastFetch: 0 };
  public static lastHeartbeatFirestoreWrite = 0;

  public async getConsultas(estadoFilter?: string): Promise<Array<Record<string, any>>> {
    const nowMs = Date.now();
    if (nowMs - FirestoreService.consultasCache.lastFetch < 3000 && FirestoreService.consultasCache.items.length > 0) {
      let filtered = FirestoreService.consultasCache.items;
      if (estadoFilter && estadoFilter !== 'todas') {
        filtered = filtered.filter(c => c.estado === estadoFilter);
      }
      return filtered;
    }

    let items: Array<Record<string, any>> = [];

    if (this.projectId) {
      try {
        let pageToken: string | undefined = undefined;
        let hasMore = true;
        const allFetched: Array<Record<string, any>> = [];

        while (hasMore) {
          let url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas?pageSize=300${this.apiKey ? `&key=${this.apiKey}` : ''}`;
          if (pageToken) {
            url += `&pageToken=${encodeURIComponent(pageToken)}`;
          }
          const res = await fetch(url);
          if (res.ok) {
            const json: any = await res.json();
            if (json.documents) {
              const pageItems = json.documents.map((doc: any) => this.fromFirestoreFields(doc.fields || {}));
              allFetched.push(...pageItems);
            }
            if (json.nextPageToken) {
              pageToken = json.nextPageToken;
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }

        if (allFetched.length > 0) {
          items = allFetched;
          FirestoreService.inMemoryConsultas = items;
          FirestoreService.consultasCache = { items, lastFetch: nowMs };
        }
      } catch (e) {
        items = [...FirestoreService.inMemoryConsultas];
      }
    }

    if (items.length === 0 && FirestoreService.inMemoryConsultas.length > 0) {
      items = [...FirestoreService.inMemoryConsultas];
    }

    if (estadoFilter && estadoFilter !== 'todas') {
      items = items.filter(c => (c.estado || 'pendiente') === estadoFilter);
    }

    return items;
  }

  public async actualizarEstadoConsulta(id: string, nuevoEstado: string): Promise<boolean> {
    const itemMem = FirestoreService.inMemoryConsultas.find(c => c.id === id);
    if (itemMem) {
      itemMem.estado = nuevoEstado;
    }

    if (!this.projectId) return true;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${id}?updateMask.fieldPaths=estado${this.apiKey ? `&key=${this.apiKey}` : ''}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { estado: { stringValue: nuevoEstado } } })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  public async actualizarGestionConsulta(id: string, operador: string | null): Promise<boolean> {
    const itemMem = FirestoreService.inMemoryConsultas.find(c => c.id === id);
    if (itemMem) {
      const datos = itemMem.datos || {};
      if (operador) {
        datos.enGestionPor = operador;
        datos.enGestionAt = Date.now();
      } else {
        delete datos.enGestionPor;
        delete datos.enGestionAt;
      }
      itemMem.datos = datos;
    }

    if (!this.projectId) return true;

    try {
      const target = FirestoreService.inMemoryConsultas.find(c => c.id === id);
      const datosUpdate = target?.datos || {};
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${id}?updateMask.fieldPaths=datos${this.apiKey ? `&key=${this.apiKey}` : ''}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { datos: { mapValue: { fields: this.toFirestoreFields(datosUpdate) } } } })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  public static lastHeartbeatTimestamp = 0;

  public async saveHeartbeatPing(): Promise<boolean> {
    const now = Date.now();
    FirestoreService.lastHeartbeatTimestamp = now;
    if (!this.projectId) return true;

    // Actualiza Firestore cada 30 segundos (2.880 escrituras/día, muy por debajo del límite de 20.000)
    if (now - FirestoreService.lastHeartbeatFirestoreWrite < 30000) {
      return true;
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/botConfig/heartbeat${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            lastPing: { integerValue: String(now) }
          }
        })
      });
      if (res.ok) {
        FirestoreService.lastHeartbeatFirestoreWrite = now;
      }
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  public async getHeartbeatPing(): Promise<number> {
    if (FirestoreService.lastHeartbeatTimestamp > 0 && Date.now() - FirestoreService.lastHeartbeatTimestamp < 60000) {
      return FirestoreService.lastHeartbeatTimestamp;
    }

    if (!this.projectId) return FirestoreService.lastHeartbeatTimestamp;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/botConfig/heartbeat${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const json: any = await res.json();
        const pingVal = json.fields?.lastPing?.integerValue;
        if (pingVal) {
          const ts = parseInt(pingVal, 10);
          FirestoreService.lastHeartbeatTimestamp = ts;
          return ts;
        }
      }
    } catch (e) {}

    return FirestoreService.lastHeartbeatTimestamp;
  }

  public async clearAllConsultas(): Promise<void> {
    FirestoreService.inMemoryConsultas = [];
    FirestoreService.inMemorySessions.clear();

    if (!this.projectId) return;

    try {
      // 1. Borrar todas las consultas de /consultas (paginación completa)
      let hasMoreC = true;
      while (hasMoreC) {
        const urlC = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas?pageSize=300${this.apiKey ? `&key=${this.apiKey}` : ''}`;
        const resC = await fetch(urlC);
        if (resC.ok) {
          const jsonC: any = await resC.json();
          if (jsonC.documents && jsonC.documents.length > 0) {
            for (const doc of jsonC.documents) {
              await fetch(`https://firestore.googleapis.com/v1/${doc.name}${this.apiKey ? `?key=${this.apiKey}` : ''}`, { method: 'DELETE' });
            }
          } else {
            hasMoreC = false;
          }
        } else {
          hasMoreC = false;
        }
      }

      // 2. Borrar todas las sesiones activas de usuarios en /sesiones (conservando las configuraciones)
      let hasMoreS = true;
      while (hasMoreS) {
        const urlS = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones?pageSize=300${this.apiKey ? `&key=${this.apiKey}` : ''}`;
        const resS = await fetch(urlS);
        if (resS.ok) {
          const jsonS: any = await resS.json();
          let deletedInThisPage = 0;
          if (jsonS.documents && jsonS.documents.length > 0) {
            for (const doc of jsonS.documents) {
              if (
                !doc.name.includes('/sesiones/bot_') &&
                !doc.name.includes('/sesiones/global_') &&
                !doc.name.includes('/sesiones/tag_') &&
                !doc.name.includes('/sesiones/quick_') &&
                !doc.name.includes('/sesiones/pdf_') &&
                !doc.name.includes('/sesiones/vip_') &&
                !doc.name.includes('/sesiones/doctor_') &&
                !doc.name.includes('/sesiones/pending_')
              ) {
                await fetch(`https://firestore.googleapis.com/v1/${doc.name}${this.apiKey ? `?key=${this.apiKey}` : ''}`, { method: 'DELETE' });
                deletedInThisPage++;
              }
            }
          }
          if (deletedInThisPage === 0) {
            hasMoreS = false;
          }
        } else {
          hasMoreS = false;
        }
      }
    } catch (e) {
      console.error('Error al vaciar consultas y sesiones en Firestore:', e);
    }
  }

  public async seedConsultas(): Promise<number> {
    const nombres = [
      "María Elena Rossi", "Carlos Gómez", "Lucía Fernández", "Santiago Peralta", "Florencia Benítez",
      "Gonzalo Martínez", "Valentina Soria", "Joaquín Almada", "Camila Bustos", "Agustín Quiroga",
      "Sofia Domínguez", "Mateo Carrizo", "Isabella Mansilla", "Lucas Maidana", "Martina Herrera",
      "Facundo Godoy", "Victoria Olmos", "Nico Romero", "Delfina Ferreyra", "Enzo Navarro",
      "Paula Villalba", "Tomas Agüero", "Micaela Paz", "Lautaro Acosta", "Rocío Ledesma",
      "Gabriel Moyano", "Juana Mercado", "Mariano Toledo", "Abril Ibáñez", "Julian Cabrera",
      "Josefina Lucero", "Ramiro Ojeda", "Constanza Miranda", "Bautista Silva", "Candela Funes",
      "Ignacio Varela", "Milagros Ponce", "Thiago Coronel", "Zoe Duarte", "Santino Luque",
      "Melina Bravo", "Ezequiel Juárez", "Clara Morales", "Manuel Castillo", "Lourdes Sosa",
      "Maximiliano Nieva", "Ana Laura Giménez", "Federico Roldán", "Griselda Páez", "Esteban Peralta"
    ];

    const opciones = [
      "Solicitar Turno - ORL (Otorrinolaringología)",
      "Solicitar Turno - Estudios Médicos",
      "Solicitar Turno - Cirugías",
      "Autorización de Estudios / Órdenes Médicas",
      "Consultas Generales / Ayuda",
      "Atenciones Afiliados PAMI",
      "Reprogramación o Cancelación de Turno",
      "Contacto Directo Secretaría"
    ];

    const obrasSociales = ["OSDE 210", "Swiss Medical", "PAMI", "Apross", "Medifé", "Galeno", "Sancor Salud", "Particular", "OSPAC", "Unión Personal"];
    const especialidades = ["Otorrinolaringología (ORL)", "Cirugía Cabeza y Cuello", "Estudios ORL", "Audiometría", "Rinofibroscopía"];
    const medicos = ["Dra. Venier", "Dr. López", "Dra. Rodríguez", "Dr. Sánchez"];

    const now = Date.now();
    const seeded: Array<Record<string, any>> = [];

    for (let i = 0; i < 50; i++) {
      const name = nombres[i % nombres.length];
      const phoneDigits = `549351${Math.floor(1000000 + Math.random() * 9000000)}`;
      const opcion = opciones[i % opciones.length];
      const obra = obrasSociales[i % obrasSociales.length];
      const dni = `${Math.floor(28000000 + Math.random() * 15000000)}`;
      const timestamp = new Date(now - (i * 12 * 60 * 1000) - Math.floor(Math.random() * 300000)).toISOString();
      const consultaId = `seed_${now}_${i + 1}`;

      let etiquetas: string[] = [];
      if (opcion.includes("PAMI") || obra === "PAMI") etiquetas.push("pami");
      if (i % 7 === 0) etiquetas.push("urgente");
      if (i % 5 === 0) etiquetas.push("falta_foto");
      if (i % 4 === 0) etiquetas.push("en_revision");
      if (i % 9 === 0) etiquetas.push("turno_confirmado");

      let datos: Record<string, any> = {
        pushName: name,
        dni,
        obraSocial: obra,
        etiquetas,
        respuestasPaciente: [],
        respuestasSecretaria: []
      };

      if (opcion.includes("ORL")) {
        datos.tipoSolicitud = "Turno ORL";
        datos.especialidad = especialidades[0];
        datos.medicoPreferido = medicos[i % medicos.length];
        datos.contenidoMensaje = `📌 Solicitud de Turno ORL para ${name}.\nDNI: ${dni}\nObra Social: ${obra}\nDoctor/a: ${datos.medicoPreferido}`;
      } else if (opcion.includes("Estudios")) {
        datos.tipoSolicitud = "Estudios Médicos";
        datos.estudioDeseado = (i % 2 === 0) ? "Audiometría + Tonal" : "Rinofibroscopía Laringea";
        datos.contenidoMensaje = `🔬 Solicitud de Estudio: ${datos.estudioDeseado}\nPaciente: ${name} (DNI ${dni})\nObra Social: ${obra}`;
      } else if (opcion.includes("Cirugías")) {
        datos.tipoSolicitud = "Cirugía Programada";
        datos.cirugiaPropuesta = (i % 2 === 0) ? "Septoplastia Funcional" : "Amigdalectomía";
        datos.contenidoMensaje = `🏥 Consulta sobre Cirugía: ${datos.cirugiaPropuesta}\nPaciente: ${name} - Obra Social: ${obra}`;
      } else if (opcion.includes("PAMI")) {
        datos.tipoSolicitud = "Atención PAMI";
        datos.numeroAfiliadoPami = `150${Math.floor(1000000000 + Math.random() * 9000000000)}`;
        datos.contenidoMensaje = `👵 Solicitud PAMI - N° Afiliado: ${datos.numeroAfiliadoPami}\nPaciente: ${name} - DNI: ${dni}`;
      } else if (opcion.includes("Autorización")) {
        datos.tipoSolicitud = "Autorización Orden Médica";
        datos.contenidoMensaje = `📋 Adjunto orden médica para autorizar por ${obra}.\nPaciente: ${name}`;
      } else if (opcion.includes("Reprogramación")) {
        datos.tipoSolicitud = "Reprogramación de Turno";
        datos.motivo = "Motivos personales de trabajo";
        datos.contenidoMensaje = `🔄 Solicito reprogramar mi turno del día viernes.\nPaciente: ${name}`;
      } else {
        datos.tipoSolicitud = "Contacto Directo / Consulta";
        datos.contenidoMensaje = `💬 Consulta general de ${name}: "Hola, quería consultar horarios de guardia este fin de semana."`;
      }

      const item = {
        id: consultaId,
        remitente: phoneDigits,
        opcion,
        estado: "pendiente",
        datos,
        timestamp,
        createdAt: timestamp
      };

      FirestoreService.inMemoryConsultas.push(item);
      seeded.push(item);
    }

    if (this.projectId) {
      try {
        for (const item of seeded) {
          const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas?documentId=${item.id}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: this.toFirestoreFields(item) })
          });
        }
      } catch (e) {
        console.error("Error al sembrar consultas en Firestore:", e);
      }
    }

    return seeded.length;
  }

  public static getConsultasGuardadasMemoria(): Array<Record<string, any>> {
    return [...this.inMemoryConsultas];
  }
}
