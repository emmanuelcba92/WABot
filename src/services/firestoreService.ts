import { Env, StateType, UserSession } from '../types';
import { CONFIG } from '../config';

/**
 * Servicio de Firestore ultra-ligero que utiliza la API REST oficial de Firestore.
 * Diseñado específicamente para ser 100% compatible con Cloudflare Workers (sin Node.js gRPC/fs).
 * Incluye almacenamiento en memoria como fallback si se ejecuta en modo demo o sin credenciales.
 */
export class FirestoreService {
  private projectId: string;
  private apiKey?: string;
  // Fallback en memoria para desarrollo local / demo sin credenciales
  private static inMemorySessions: Map<string, UserSession> = new Map();
  private static inMemoryConsultas: Array<Record<string, any>> = [];

  constructor(env?: Env) {
    this.projectId = env?.FIREBASE_PROJECT_ID || CONFIG.DEFAULT_FIREBASE_PROJECT_ID;
    this.apiKey = env?.FIREBASE_API_KEY;
  }

  /**
   * Helper para convertir un objeto JS simple a los campos requeridos por Firestore REST API.
   */
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
      } else if (typeof val === 'object') {
        fields[key] = { mapValue: { fields: this.toFirestoreFields(val) } };
      }
    }
    return fields;
  }

  /**
   * Helper para convertir los campos de Firestore REST API a un objeto JS plano.
   */
  private fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    if (!fields) return result;

    for (const [key, valueObj] of Object.entries(fields)) {
      if ('stringValue' in valueObj) result[key] = valueObj.stringValue;
      else if ('integerValue' in valueObj) result[key] = parseInt(valueObj.integerValue, 10);
      else if ('doubleValue' in valueObj) result[key] = parseFloat(valueObj.doubleValue);
      else if ('booleanValue' in valueObj) result[key] = valueObj.booleanValue;
      else if ('mapValue' in valueObj) result[key] = this.fromFirestoreFields(valueObj.mapValue.fields || {});
      else if ('nullValue' in valueObj) result[key] = null;
    }
    return result;
  }

  /**
   * Obtener sesión del usuario desde Firestore (colección 'sesiones').
   */
  public async getSesion(remitente: string): Promise<UserSession> {
    // Normalizar ID de documento sanitizando caracteres no permitidos en IDs de Firestore
    const docId = encodeURIComponent(remitente.trim());

    // Si estamos en modo demo sin API Key real o ID por defecto, usar memoria
    if (this.projectId === CONFIG.DEFAULT_FIREBASE_PROJECT_ID || !this.apiKey) {
      const sesionMem = FirestoreService.inMemorySessions.get(docId);
      if (sesionMem) return sesionMem;
      return {
        remitente,
        estado: 'inicio',
        datosTemporales: {},
        updatedAt: new Date().toISOString()
      };
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/sesiones/${docId}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
      const res = await fetch(url);

      if (res.status === 404) {
        return {
          remitente,
          estado: 'inicio',
          datosTemporales: {},
          updatedAt: new Date().toISOString()
        };
      }

      if (!res.ok) {
        console.warn(`Firestore GET error (${res.status}): Usando fallback en memoria`);
        return FirestoreService.inMemorySessions.get(docId) || {
          remitente,
          estado: 'inicio',
          datosTemporales: {},
          updatedAt: new Date().toISOString()
        };
      }

      const data: any = await res.json();
      const fields = this.fromFirestoreFields(data.fields || {});

      return {
        remitente,
        estado: (fields.estado as StateType) || 'inicio',
        datosTemporales: fields.datosTemporales || {},
        updatedAt: fields.updatedAt || new Date().toISOString()
      };
    } catch (err) {
      console.error('Error al conectar con Firestore GET:', err);
      return FirestoreService.inMemorySessions.get(docId) || {
        remitente,
        estado: 'inicio',
        datosTemporales: {},
        updatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Guardar / actualizar estado de la sesión del usuario en Firestore.
   */
  public async saveSesion(remitente: string, estado: StateType, datosTemporales: Record<string, any> = {}): Promise<void> {
    const docId = encodeURIComponent(remitente.trim());
    const updatedAt = new Date().toISOString();
    const sesionData: UserSession = {
      remitente,
      estado,
      datosTemporales,
      updatedAt
    };

    // Actualizar siempre en memoria como respaldo instantáneo
    FirestoreService.inMemorySessions.set(docId, sesionData);

    if (this.projectId === CONFIG.DEFAULT_FIREBASE_PROJECT_ID || !this.apiKey) {
      return;
    }

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

  /**
   * Guardar la consulta finalizada en la colección "consultas" marcándola con estado "pendiente".
   */
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

    // Guardar en memoria
    FirestoreService.inMemoryConsultas.push(payload);

    if (this.projectId === CONFIG.DEFAULT_FIREBASE_PROJECT_ID || !this.apiKey) {
      console.log(`[Firestore Demo] Consulta guardada en colección 'consultas':`, payload);
      return consultaId;
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas?documentId=${consultaId}${this.apiKey ? `&key=${this.apiKey}` : ''}`;
      const firestoreBody = {
        fields: this.toFirestoreFields(payload)
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firestoreBody)
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`Firestore POST error (${res.status}): ${errorText}`);
      }
    } catch (err) {
      console.error('Error al crear consulta en Firestore:', err);
    }

    return consultaId;
  }

  /**
   * Método de utilidad para el panel de pruebas: listar consultas guardadas (memoria / cloud)
   */
  public static getConsultasGuardadasMemoria(): Array<Record<string, any>> {
    return [...this.inMemoryConsultas];
  }
}
