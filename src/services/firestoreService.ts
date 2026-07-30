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
  welcomeMessage: `🏥 *¡Hola! Bienvenido/a a la Clínica Médica.*\nPor favor, responde con la letra de la opción que necesitas:`,
  items: [
    {
      key: 'a',
      label: 'Solicitar Turno (Consultas, Estudios o Cirugías)',
      type: 'submenu',
      subItems: [
        { key: '1', label: 'Médico ORL (Otorrinolaringología)', type: 'form', responseTemplate: MESSAGES.PLANTILLA_A1_ORL },
        { key: '2', label: 'Estudios Médicos', type: 'form', responseTemplate: MESSAGES.PLANTILLA_A2_ESTUDIOS },
        { key: '3', label: 'Cirugías', type: 'form', responseTemplate: MESSAGES.PLANTILLA_A3_CIRUGIAS }
      ]
    },
    { key: 'b', label: 'Autorización de Estudios / Órdenes Médicas', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_B },
    { key: 'c', label: 'Consultas Generales / Ayuda', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_C },
    { key: 'd', label: 'Atenciones Afiliados PAMI', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_D },
    { key: 'e', label: 'Reprogramación o Cancelación de Turno', type: 'form', responseTemplate: MESSAGES.PLANTILLA_OPCION_E }
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
    if (FirestoreService.globalMenuTree) return FirestoreService.globalMenuTree;
    if (!this.projectId) return DEFAULT_MENU_TREE;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/bot_menu_tree${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const fields = this.fromFirestoreFields(data.fields || {});
        if (fields && fields.items && Array.isArray(fields.items)) {
          const config = fields as unknown as MenuTreeConfig;
          FirestoreService.globalMenuTree = config;
          return config;
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

    // 1. Probar por remitente directo en RAM
    let sesionMem = FirestoreService.inMemorySessions.get(docId);

    // 2. Probar por altRemitente directo en RAM
    if (!sesionMem && altRemitente) {
      const altId = encodeURIComponent(altRemitente.trim());
      sesionMem = FirestoreService.inMemorySessions.get(altId);
    }

    // 3. Probar por coincidencia de dígitos de teléfono en RAM
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
  ): Promise<void> {
    const consultas = await this.getConsultas();

    const rDigits = remitente.replace(/[^0-9]/g, '');
    const altDigits = (altRemitente || '').replace(/[^0-9]/g, '');

    // BÚSQUEDA EXHAUSTIVA DE CONSULTA PENDIENTE CON SOPORTE LID Y TELÉFONO
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

      // Guardar el LID para poder responder al usuario por su ID de WhatsApp
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

      if (imagenBase64) {
        imagenesAdjuntas.push(imagenBase64);
      }

      if (imagenesAdjuntas.length > 10) {
        imagenesAdjuntas = imagenesAdjuntas.slice(-10);
      }

      datos.imagenesAdjuntas = imagenesAdjuntas;

      let pdfsAdjuntos = Array.isArray(datos.pdfsAdjuntos) ? [...datos.pdfsAdjuntos] : [];
      if (pdfBase64) {
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

      // ACTUALIZAR MEMORIA ESTÁTICA LOCAL INSTANTÁNEAMENTE
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
    }
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
    const consultas = await this.getConsultas();
    const target = consultas.find(c => c.id === idConsulta);
    if (target) {
      const datos = target.datos || {};
      const respuestasSec = datos.respuestasSecretaria || [];
      datos.respuestasSecretaria = [...respuestasSec, {
        texto: respuestaTexto,
        timestamp: new Date().toISOString()
      }];
      target.datos = datos;

      const targetMem = FirestoreService.inMemoryConsultas.find(c => c.id === idConsulta);
      if (targetMem) {
        targetMem.datos = datos;
      }

      if (this.projectId) {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${idConsulta}?updateMask.fieldPaths=datos${this.apiKey ? `&key=${this.apiKey}` : ''}`;
          await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { datos: { mapValue: { fields: this.toFirestoreFields(datos) } } } })
          });
        } catch (e) {}
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
    altRemitente?: string
  ): Promise<void> {
    let targetJid = remitente;
    let computedAlt = altRemitente;

    if (idConsulta) {
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

    // 1. Guardar en memoria RAM local
    FirestoreService.pendingOutgoingMemory.push(item);

    // 2. Persistir en Firestore /sesiones/pending_queue para compartir con TODOS los Cloudflare Worker Isolates
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
    }
  }

  public async popPendingOutgoing(): Promise<PendingOutgoingMsg[]> {
    const result: PendingOutgoingMsg[] = [];
    const seenIds = new Set<string>();

    // 1. Recolectar RAM local
    for (const item of FirestoreService.pendingOutgoingMemory) {
      const key = item.id || `${item.remitente}_${item.timestamp}_${item.text}`;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        result.push(item);
      }
    }
    FirestoreService.pendingOutgoingMemory = [];

    // 2. Recolectar Firestore persitente (soporte multi-isolate Cloudflare Workers)
    if (this.projectId) {
      try {
        const fsItems = await this.getPendingQueueFromFirestore();
        for (const item of fsItems) {
          const key = item.id || `${item.remitente}_${item.timestamp}_${item.text}`;
          if (!seenIds.has(key)) {
            seenIds.add(key);
            result.push(item);
          }
        }

        // Vaciar la cola en Firestore una vez recolectada
        if (fsItems.length > 0) {
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

    FirestoreService.inMemoryConsultas.push(payload);

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

  public async getConsultas(estadoFilter?: string): Promise<Array<Record<string, any>>> {
    let items: Array<Record<string, any>> = [];

    if (this.projectId) {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas${this.apiKey ? `?key=${this.apiKey}` : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const json: any = await res.json();
          if (json.documents) {
            items = json.documents.map((doc: any) => this.fromFirestoreFields(doc.fields || {}));
            FirestoreService.inMemoryConsultas = items;
          }
        }
      } catch (e) {
        items = [...FirestoreService.inMemoryConsultas];
      }
    }

    if (items.length === 0 && FirestoreService.inMemoryConsultas.length > 0) {
      items = [...FirestoreService.inMemoryConsultas];
    }

    if (estadoFilter && estadoFilter !== 'todos') {
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

  public async clearAllConsultas(): Promise<void> {
    FirestoreService.inMemoryConsultas = [];
    FirestoreService.inMemorySessions.clear();

    if (!this.projectId) return;

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const json: any = await res.json();
        if (json.documents) {
          for (const doc of json.documents) {
            await fetch(`https://firestore.googleapis.com/v1/${doc.name}${this.apiKey ? `?key=${this.apiKey}` : ''}`, { method: 'DELETE' });
          }
        }
      }
    } catch (e) {
      console.error('Error al vaciar consultas en Firestore:', e);
    }
  }

  public static getConsultasGuardadasMemoria(): Array<Record<string, any>> {
    return [...this.inMemoryConsultas];
  }
}
