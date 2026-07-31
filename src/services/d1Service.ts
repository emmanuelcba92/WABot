import { Env, UserSession, MenuTreeConfig, StateType, DoctorItem } from '../types';
import { DEFAULT_MENU_TREE } from './firestoreService';

export class D1Service {
  private db: any;

  private static inMemoryConsultas: Array<Record<string, any>> = [];

  constructor(env?: Env) {
    this.db = env?.DB;
  }

  public async getConsultas(estadoFilter?: string): Promise<Array<Record<string, any>>> {
    if (!this.db) {
      return D1Service.inMemoryConsultas;
    }

    try {
      let query = 'SELECT * FROM consultas ORDER BY timestamp DESC';
      const { results } = await this.db.prepare(query).all();

      const items = (results || []).map((row: any) => {
        let datosParsed = {};
        try {
          datosParsed = typeof row.datos === 'string' ? JSON.parse(row.datos) : (row.datos || {});
        } catch (e) {}

        return {
          id: row.id,
          remitente: row.remitente,
          estado: row.estado,
          opcion: row.opcion,
          datos: datosParsed,
          timestamp: row.timestamp,
          createdAt: row.createdAt
        };
      });

      D1Service.inMemoryConsultas = items;

      if (estadoFilter && estadoFilter !== 'todas') {
        return items.filter((c: any) => c.estado === estadoFilter);
      }
      return items;
    } catch (e) {
      console.error('Error fetching consultas from D1:', e);
      return D1Service.inMemoryConsultas;
    }
  }

  public async appendPacienteMensajeAConsulta(
    remitente: string,
    altRemitente?: string,
    pushName?: string,
    texto?: string,
    imagenBase64?: string,
    imagenNombre?: string,
    pdfBase64?: string,
    pdfNombre?: string
  ): Promise<boolean> {
    const consultas = await this.getConsultas();
    const cleanRem = remitente.toLowerCase().trim();
    const cleanAlt = (altRemitente || '').toLowerCase().trim();

    const actual = consultas.find((c: any) => {
      const cRem = (c.remitente || '').toLowerCase().trim();
      const cAlt = (c.datos?.altRemitente || '').toLowerCase().trim();
      return (cRem === cleanRem || cRem === cleanAlt || (cleanAlt && cAlt === cleanAlt)) && c.estado === 'pendiente';
    });

    if (!actual) return false;

    const datos = actual.datos || {};
    const respuestasPaciente = datos.respuestasPaciente || [];

    respuestasPaciente.push({
      texto: texto || '',
      imagenBase64: imagenBase64 || null,
      imagenNombre: imagenNombre || null,
      pdfBase64: pdfBase64 || null,
      pdfNombre: pdfNombre || null,
      timestamp: new Date().toISOString()
    });

    datos.respuestasPaciente = respuestasPaciente;
    if (pushName) datos.pushName = pushName;
    if (altRemitente) datos.altRemitente = altRemitente;

    await this.actualizarDatosConsulta(actual.id, datos);
    return true;
  }

  public async crearConsulta(
    remitente: string,
    altRemitente: string | undefined,
    pushName: string | undefined,
    opcion: string,
    datos: Record<string, any>,
    simulatedTime?: string,
    esVip: boolean = false
  ): Promise<string> {
    const id = `cons_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tsStr = simulatedTime || new Date().toISOString();
    const tsNum = new Date(tsStr).getTime();

    const item = {
      id,
      remitente,
      estado: 'pendiente',
      opcion,
      datos: {
        ...datos,
        altRemitente,
        pushName,
        esVip
      },
      timestamp: tsNum,
      createdAt: tsStr
    };

    D1Service.inMemoryConsultas.push(item);

    if (this.db) {
      try {
        await this.db
          .prepare(
            'INSERT INTO consultas (id, remitente, estado, opcion, datos, timestamp, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(id, remitente, 'pendiente', opcion, JSON.stringify(item.datos), tsNum, tsStr)
          .run();
      } catch (e) {
        console.error('Error inserting consulta into D1:', e);
      }
    }

    return id;
  }

  public async actualizarDatosConsulta(id: string, nuevosDatos: Record<string, any>): Promise<boolean> {
    const consultas = await this.getConsultas();
    const target = consultas.find((c: any) => c.id === id);
    if (target) {
      target.datos = { ...target.datos, ...nuevosDatos };
    }

    if (this.db) {
      try {
        await this.db
          .prepare('UPDATE consultas SET datos = ? WHERE id = ?')
          .bind(JSON.stringify(target?.datos || nuevosDatos), id)
          .run();
        return true;
      } catch (e) {
        console.error('Error updating consulta datos in D1:', e);
      }
    }
    return true;
  }

  public async marcarEstadoConsulta(id: string, nuevoEstado: string): Promise<boolean> {
    const consultas = await this.getConsultas();
    const target = consultas.find((c: any) => c.id === id);
    if (target) {
      target.estado = nuevoEstado;
    }

    if (this.db) {
      try {
        await this.db
          .prepare('UPDATE consultas SET estado = ? WHERE id = ?')
          .bind(nuevoEstado, id)
          .run();
        return true;
      } catch (e) {
        console.error('Error updating consulta estado in D1:', e);
      }
    }
    return true;
  }

  public async responderConsulta(idConsulta: string, texto: string, usuario: string, pdfBase64?: string, pdfNombre?: string): Promise<boolean> {
    const consultas = await this.getConsultas();
    const target = consultas.find((c: any) => c.id === idConsulta);
    if (!target) return false;

    const datos = target.datos || {};
    const respuestasSecretaria = datos.respuestasSecretaria || [];

    respuestasSecretaria.push({
      texto,
      usuario,
      pdfBase64: pdfBase64 || null,
      pdfNombre: pdfNombre || null,
      timestamp: new Date().toISOString()
    });

    datos.respuestasSecretaria = respuestasSecretaria;
    datos.ultimaRespuestaSecretaria = texto;
    datos.ultimaRespuestaTimestamp = new Date().toISOString();

    return await this.actualizarDatosConsulta(idConsulta, datos);
  }

  public async getMenuTree(): Promise<MenuTreeConfig> {
    if (!this.db) return DEFAULT_MENU_TREE;
    try {
      const row = await this.db.prepare('SELECT data FROM menu_tree WHERE id = ?').bind('tree').first();
      if (row && row.data) {
        return JSON.parse(row.data);
      }
    } catch (e) {}
    return DEFAULT_MENU_TREE;
  }

  public async saveMenuTree(tree: MenuTreeConfig): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .prepare('INSERT INTO menu_tree (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('tree', JSON.stringify(tree), new Date().toISOString(), JSON.stringify(tree), new Date().toISOString())
        .run();
    } catch (e) {
      console.error('Error saving menu_tree to D1:', e);
    }
  }

  public async getBotConfig(): Promise<Record<string, any>> {
    if (!this.db) return {};
    try {
      const row = await this.db.prepare('SELECT data FROM bot_config WHERE id = ?').bind('config').first();
      if (row && row.data) {
        return JSON.parse(row.data);
      }
    } catch (e) {}
    return {};
  }

  public async saveBotConfig(config: Record<string, any>): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('config', JSON.stringify(config), new Date().toISOString(), JSON.stringify(config), new Date().toISOString())
        .run();
    } catch (e) {
      console.error('Error saving bot_config to D1:', e);
    }
  }

  public async getVipContacts(): Promise<any[]> {
    if (!this.db) return [];
    try {
      const row = await this.db.prepare('SELECT data FROM vip_contacts WHERE id = ?').bind('vip').first();
      if (row && row.data) {
        return JSON.parse(row.data);
      }
    } catch (e) {}
    return [];
  }

  public async saveVipContacts(items: any[]): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .prepare('INSERT INTO vip_contacts (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('vip', JSON.stringify(items), new Date().toISOString(), JSON.stringify(items), new Date().toISOString())
        .run();
    } catch (e) {}
  }

  public async getQuickReplies(): Promise<any[]> {
    if (!this.db) return [];
    try {
      const row = await this.db.prepare('SELECT data FROM quick_replies WHERE id = ?').bind('replies').first();
      if (row && row.data) {
        return JSON.parse(row.data);
      }
    } catch (e) {}
    return [];
  }

  public async saveQuickReplies(items: any[]): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .prepare('INSERT INTO quick_replies (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('replies', JSON.stringify(items), new Date().toISOString(), JSON.stringify(items), new Date().toISOString())
        .run();
    } catch (e) {}
  }

  public async getPdfConfig(): Promise<any[]> {
    if (!this.db) return [];
    try {
      const row = await this.db.prepare('SELECT data FROM pdf_config WHERE id = ?').bind('pdfs').first();
      if (row && row.data) {
        return JSON.parse(row.data);
      }
    } catch (e) {}
    return [];
  }

  public async savePdfConfig(items: any[]): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .prepare('INSERT INTO pdf_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('pdfs', JSON.stringify(items), new Date().toISOString(), JSON.stringify(items), new Date().toISOString())
        .run();
    } catch (e) {}
  }

  public async getTagConfig(): Promise<Record<string, any>> {
    if (!this.db) return {};
    try {
      const row = await this.db.prepare('SELECT data FROM tag_config WHERE id = ?').bind('tags').first();
      if (row && row.data) {
        return JSON.parse(row.data);
      }
    } catch (e) {}
    return {};
  }

  public async saveTagConfig(tags: Record<string, any>): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .prepare('INSERT INTO tag_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('tags', JSON.stringify(tags), new Date().toISOString(), JSON.stringify(tags), new Date().toISOString())
        .run();
    } catch (e) {}
  }

  private static lastHeartbeatTs = 0;

  public async saveHeartbeatPing(): Promise<boolean> {
    const now = Date.now();
    D1Service.lastHeartbeatTs = now;
    if (!this.db) return true;
    try {
      await this.db
        .prepare('INSERT INTO heartbeat (id, lastPing) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET lastPing = ?')
        .bind('ping', now, now)
        .run();
      return true;
    } catch (e) {
      return false;
    }
  }

  public async getHeartbeatPing(): Promise<number> {
    if (D1Service.lastHeartbeatTs > 0 && Date.now() - D1Service.lastHeartbeatTs < 60000) {
      return D1Service.lastHeartbeatTs;
    }
    if (!this.db) return D1Service.lastHeartbeatTs;
    try {
      const row = await this.db.prepare('SELECT lastPing FROM heartbeat WHERE id = ?').bind('ping').first();
      if (row && row.lastPing) {
        D1Service.lastHeartbeatTs = row.lastPing;
        return row.lastPing;
      }
    } catch (e) {}
    return D1Service.lastHeartbeatTs;
  }

  public async saveSesion(remitente: string, estado: string, datosTemporales?: Record<string, any>): Promise<void> {}
  public async getSesion(remitente: string): Promise<UserSession> {
    return {
      remitente,
      estado: 'inicio',
      datosTemporales: {},
      historialMensajes: [],
      updatedAt: new Date().toISOString()
    };
  }
  public async agregarMensajeHistorial(remitente: string, msg: any): Promise<void> {}
  public async getScheduleMode(): Promise<any> { return 'auto'; }
  public async saveScheduleMode(mode: string): Promise<void> {}
}
