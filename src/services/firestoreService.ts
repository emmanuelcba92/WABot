import { Env, StateType, UserSession, ChatMessage } from '../types';
import { CONFIG } from '../config';

export interface PendingOutgoingMsg {
  id: string;
  remitente: string;
  text: string;
  timestamp: string;
  pdfUrl?: string;
  pdfNombre?: string;
  pdfBase64?: string;
}

export class FirestoreService {
  private projectId: string;
  private apiKey?: string;

  private static inMemorySessions: Map<string, UserSession> = new Map();
  private static inMemoryConsultas: Array<Record<string, any>> = [];
  private static pendingOutgoingMemory: PendingOutgoingMsg[] = [];

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

  public async getSesion(remitente: string): Promise<UserSession> {
    const docId = encodeURIComponent(remitente.trim());

    const sesionMem = FirestoreService.inMemorySessions.get(docId);
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

  public async saveSesion(remitente: string, estado: StateType, datosTemporales: Record<string, any> = {}, historialMensajes: ChatMessage[] = []): Promise<void> {
    const docId = encodeURIComponent(remitente.trim());
    const updatedAt = new Date().toISOString();

    const sesionMem = FirestoreService.inMemorySessions.get(docId);
    const historialFinal = historialMensajes.length > 0 ? historialMensajes : (sesionMem?.historialMensajes || []);

    const sesionData: UserSession = {
      remitente,
      estado,
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

  public async appendPacienteMensajeAConsulta(remitente: string, textoMensaje: string): Promise<void> {
    const consultas = await this.getConsultas();
    const consultaPaciente = consultas.find(c => c.remitente === remitente && c.estado !== 'atendido') || consultas.find(c => c.remitente === remitente);

    if (consultaPaciente) {
      const datos = consultaPaciente.datos || {};
      const respAnteriores = datos.respuestasPaciente || [];
      const nuevaResp = {
        texto: textoMensaje,
        timestamp: new Date().toISOString()
      };
      datos.respuestasPaciente = [...respAnteriores, nuevaResp];
      consultaPaciente.datos = datos;

      consultaPaciente.estado = 'pendiente';
      consultaPaciente.timestamp = new Date().toISOString();

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
          console.error('Error al reabrir consulta en Firestore:', e);
        }
      }
    }
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
    pdfBase64?: string
  ): Promise<void> {
    const item: PendingOutgoingMsg = {
      id: `out_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      remitente,
      text,
      pdfUrl,
      pdfNombre,
      pdfBase64,
      timestamp: new Date().toISOString()
    };

    FirestoreService.pendingOutgoingMemory.push(item);

    if (this.projectId && idConsulta) {
      try {
        const consultas = await this.getConsultas();
        const target = consultas.find(c => c.id === idConsulta);
        if (target) {
          const datos = target.datos || {};
          const pendientes = datos.pendientesSalida || [];
          datos.pendientesSalida = [...pendientes, item];
          target.datos = datos;

          const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${idConsulta}?updateMask.fieldPaths=datos${this.apiKey ? `&key=${this.apiKey}` : ''}`;
          await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { datos: { mapValue: { fields: this.toFirestoreFields(datos) } } } })
          });
        }
      } catch (e) {
        console.error('Error al guardar pendienteSalida en consulta:', e);
      }
    }
  }

  public async popPendingOutgoing(): Promise<PendingOutgoingMsg[]> {
    const result: PendingOutgoingMsg[] = [...FirestoreService.pendingOutgoingMemory];
    FirestoreService.pendingOutgoingMemory = [];

    if (this.projectId) {
      try {
        const consultas = await this.getConsultas();
        for (const c of consultas) {
          const datos = c.datos || {};
          const pendientes: PendingOutgoingMsg[] = datos.pendientesSalida || [];
          if (pendientes.length > 0) {
            result.push(...pendientes);
            datos.pendientesSalida = [];
            c.datos = datos;

            const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/consultas/${c.id}?updateMask.fieldPaths=datos${this.apiKey ? `&key=${this.apiKey}` : ''}`;
            await fetch(url, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { datos: { mapValue: { fields: this.toFirestoreFields(datos) } } } })
            });
          }
        }
      } catch (e) {}
    }

    const uniqueMap = new Map();
    result.forEach(item => uniqueMap.set(item.id || (item.remitente + item.timestamp), item));
    return Array.from(uniqueMap.values());
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
      const firestoreBody = {
        fields: this.toFirestoreFields(payload)
      };

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firestoreBody)
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
      const firestoreBody = {
        fields: { estado: { stringValue: nuevoEstado } }
      };

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
