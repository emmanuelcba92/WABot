import { Env, UserSession, MenuTreeConfig, StateType, DoctorItem, PendingOutgoingMsg } from '../types';
import { DEFAULT_MENU_TREE } from './firestoreService';

export class D1Service {
  private db: any;
  private env: any;

  private static inMemoryConsultas: Array<Record<string, any>> = [];

  constructor(env?: Env) {
    this.env = env;
    this.db = env?.DB;
  }

  private static tablesInitialized = false;

  private async initTables() {
    if (!this.db || D1Service.tablesInitialized) return;
    D1Service.tablesInitialized = true;

    const queries = [
      `CREATE TABLE IF NOT EXISTS consultas (id TEXT PRIMARY KEY, remitente TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente', opcion TEXT, datos TEXT, timestamp INTEGER NOT NULL, createdAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS bot_config (id TEXT PRIMARY KEY DEFAULT 'config', data TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS menu_tree (id TEXT PRIMARY KEY DEFAULT 'tree', data TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS vip_contacts (id TEXT PRIMARY KEY DEFAULT 'vip', data TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS quick_replies (id TEXT PRIMARY KEY DEFAULT 'replies', data TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS pdf_config (id TEXT PRIMARY KEY DEFAULT 'pdfs', data TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS tag_config (id TEXT PRIMARY KEY DEFAULT 'tags', data TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS heartbeat (id TEXT PRIMARY KEY DEFAULT 'ping', lastPing INTEGER NOT NULL)`
    ];

    for (const q of queries) {
      try {
        await this.db.prepare(q).run();
      } catch (e) {
        console.error('Error creating D1 table:', e);
      }
    }
  }

  public async getConsultas(estadoFilter?: string): Promise<Array<Record<string, any>>> {
    if (!this.db) {
      return D1Service.inMemoryConsultas;
    }

    await this.initTables();

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
    textoOrAlt?: string,
    imagenBase64OrPush?: string,
    pdfBase64OrTexto?: string,
    pdfNombreOrImg?: string,
    altRemitenteParam?: string,
    pushNameParam?: string
  ): Promise<boolean> {
    let texto: string | undefined = undefined;
    let imagenBase64: string | undefined = undefined;
    let pdfBase64: string | undefined = undefined;
    let pdfNombre: string | undefined = undefined;
    let altRemitente: string | undefined = undefined;
    let pushName: string | undefined = undefined;

    if (altRemitenteParam !== undefined || pushNameParam !== undefined || pdfNombreOrImg !== undefined) {
      texto = textoOrAlt;
      imagenBase64 = imagenBase64OrPush;
      pdfBase64 = pdfBase64OrTexto;
      pdfNombre = pdfNombreOrImg;
      altRemitente = altRemitenteParam;
      pushName = pushNameParam;
    } else {
      altRemitente = textoOrAlt;
      pushName = imagenBase64OrPush;
      texto = pdfBase64OrTexto;
    }

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
    opcionOrAltRemitente: string | undefined,
    datosOrPushName: any,
    opcionParam?: string,
    datosParam?: Record<string, any>,
    simulatedTime?: string,
    esVip: boolean = false
  ): Promise<string> {
    let opcion = opcionOrAltRemitente || 'Consulta';
    let datos: Record<string, any> = {};
    let altRemitente: string | undefined = undefined;
    let pushName: string | undefined = undefined;

    if (typeof datosOrPushName === 'object' && datosOrPushName !== null) {
      datos = datosOrPushName;
      altRemitente = datos.altRemitente;
      pushName = datos.pushName;
      esVip = datos.esVip || false;
    } else {
      altRemitente = opcionOrAltRemitente;
      pushName = datosOrPushName;
      opcion = opcionParam || 'Consulta';
      datos = datosParam || {};
    }

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
        altRemitente: altRemitente || datos.altRemitente || null,
        pushName: pushName || datos.pushName || null,
        esVip
      },
      timestamp: tsNum,
      createdAt: tsStr
    };

    D1Service.inMemoryConsultas.unshift(item);

    if (this.db) {
      try {
        await this.initTables();
        await this.db
          .prepare(
            'INSERT INTO consultas (id, remitente, estado, opcion, datos, timestamp, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(id, remitente, 'pendiente', opcion, JSON.stringify(item.datos), tsNum, tsStr)
          .run();
        console.log(`✅ [D1] Consulta creada exitosamente en Cloudflare D1: ${id} para ${remitente}`);
      } catch (e) {
        console.error('❌ Error inserting consulta into D1:', e);
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
        await this.initTables();
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
        await this.initTables();
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
      await this.initTables();
      await this.db
        .prepare('INSERT INTO heartbeat (id, lastPing) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET lastPing = ?')
        .bind('ping', now, now)
        .run();
      return true;
    } catch (e) {
      console.error('Error saving heartbeat to D1:', e);
      return false;
    }
  }

  public async getHeartbeatPing(): Promise<number> {
    if (D1Service.lastHeartbeatTs > 0 && Date.now() - D1Service.lastHeartbeatTs < 60000) {
      return D1Service.lastHeartbeatTs;
    }
    if (!this.db) return D1Service.lastHeartbeatTs;
    try {
      await this.initTables();
      const row = await this.db.prepare('SELECT lastPing FROM heartbeat WHERE id = ?').bind('ping').first();
      if (row && row.lastPing) {
        D1Service.lastHeartbeatTs = row.lastPing;
        return row.lastPing;
      }
    } catch (e) {}
    return D1Service.lastHeartbeatTs;
  }

  private static scheduleMode: string = 'auto';
  private static sessionsMap = new Map<string, UserSession>();
  private static pendingOutgoingQueue: PendingOutgoingMsg[] = [];

  public async getScheduleMode(): Promise<string> {
    if (this.db) {
      try {
        await this.initTables();
        const row = await this.db.prepare('SELECT data FROM bot_config WHERE id = ?').bind('schedule_mode').first();
        if (row && row.data) {
          const parsed = JSON.parse(row.data);
          if (parsed.mode) {
            D1Service.scheduleMode = parsed.mode;
            return parsed.mode;
          }
        }
      } catch (e) {}
    }
    return D1Service.scheduleMode;
  }

  public async saveScheduleMode(mode: string): Promise<void> {
    D1Service.scheduleMode = mode;
    if (!this.db) return;
    try {
      await this.initTables();
      await this.db
        .prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
        .bind('schedule_mode', JSON.stringify({ mode }), new Date().toISOString(), JSON.stringify({ mode }), new Date().toISOString())
        .run();
    } catch (e) {
      console.error('Error saving schedule mode to D1:', e);
    }
  }

  public async saveSesion(remitente: string, estado: string, datosTemporales?: Record<string, any>): Promise<void> {
    const cleanRem = remitente.toLowerCase().trim();
    let current = D1Service.sessionsMap.get(cleanRem) || {
      remitente: cleanRem,
      estado: 'inicio',
      datosTemporales: {},
      historialMensajes: [],
      updatedAt: new Date().toISOString()
    };
    current.estado = estado;
    if (datosTemporales) {
      current.datosTemporales = { ...current.datosTemporales, ...datosTemporales };
    }
    current.updatedAt = new Date().toISOString();
    D1Service.sessionsMap.set(cleanRem, current);

    if (this.db) {
      try {
        await this.initTables();
        await this.db
          .prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
          .bind(`session_${cleanRem}`, JSON.stringify(current), current.updatedAt, JSON.stringify(current), current.updatedAt)
          .run();
      } catch (e) {}
    }
  }

  public async getSesion(remitente: string, altRemitente?: string): Promise<UserSession> {
    const cleanRem = remitente.toLowerCase().trim();
    if (D1Service.sessionsMap.has(cleanRem)) {
      return D1Service.sessionsMap.get(cleanRem)!;
    }
    if (altRemitente) {
      const cleanAlt = altRemitente.toLowerCase().trim();
      if (D1Service.sessionsMap.has(cleanAlt)) {
        return D1Service.sessionsMap.get(cleanAlt)!;
      }
    }
    if (this.db) {
      try {
        await this.initTables();
        const row = await this.db.prepare('SELECT data FROM bot_config WHERE id = ?').bind(`session_${cleanRem}`).first();
        if (row && row.data) {
          const parsed = JSON.parse(row.data);
          D1Service.sessionsMap.set(cleanRem, parsed);
          return parsed;
        }
      } catch (e) {}
    }
    const defSession: UserSession = {
      remitente: cleanRem,
      estado: 'inicio',
      datosTemporales: {},
      historialMensajes: [],
      updatedAt: new Date().toISOString()
    };
    D1Service.sessionsMap.set(cleanRem, defSession);
    return defSession;
  }

  public async agregarMensajeHistorial(remitente: string, msg: any): Promise<void> {
    const sesion = await this.getSesion(remitente);
    if (!sesion.historialMensajes) sesion.historialMensajes = [];
    sesion.historialMensajes.push(msg);
    if (sesion.historialMensajes.length > 50) {
      sesion.historialMensajes = sesion.historialMensajes.slice(-50);
    }
    await this.saveSesion(remitente, sesion.estado, sesion.datosTemporales);
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
      const itemMem = D1Service.inMemoryConsultas.find(c => c.id === idConsulta);
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

    D1Service.pendingOutgoingQueue.push(item);

    if (this.db) {
      try {
        await this.initTables();
        await this.db
          .prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
          .bind('pending_queue', JSON.stringify(D1Service.pendingOutgoingQueue), new Date().toISOString(), JSON.stringify(D1Service.pendingOutgoingQueue), new Date().toISOString())
          .run();
      } catch (e) {}
    }
  }

  public async popPendingOutgoing(): Promise<PendingOutgoingMsg[]> {
    if (this.db) {
      try {
        await this.initTables();
        const row = await this.db.prepare('SELECT data FROM bot_config WHERE id = ?').bind('pending_queue').first();
        if (row && row.data) {
          const parsed = JSON.parse(row.data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            D1Service.pendingOutgoingQueue = [];
            await this.db
              .prepare('INSERT INTO bot_config (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = ?, updatedAt = ?')
              .bind('pending_queue', '[]', new Date().toISOString(), '[]', new Date().toISOString())
              .run();
            return parsed;
          }
        }
      } catch (e) {}
    }
    const result = [...D1Service.pendingOutgoingQueue];
    D1Service.pendingOutgoingQueue = [];
    return result;
  }
}
