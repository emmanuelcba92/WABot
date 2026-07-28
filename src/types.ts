export interface Env {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  SUPABASE_BUCKET?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  GOOGLE_ACCESS_TOKEN?: string;
  ASSETS?: Fetcher;
}

export type StateType =
  | 'inicio'
  | 'esperando_opcion_principal'
  | 'esperando_opcion_a_sub'
  | 'esperando_datos_a1'
  | 'esperando_datos_a2'
  | 'esperando_datos_a3'
  | 'esperando_datos_opcion_b'
  | 'esperando_datos_opcion_c'
  | 'esperando_datos_opcion_d'
  | 'esperando_datos_opcion_e';

export interface ChatMessage {
  id: string;
  sender: 'paciente' | 'bot' | 'secretaria';
  text: string;
  timestamp: string;
  imageUrl?: string;
  interactive?: InteractiveMessage; // Mensaje con botones/lista interactiva
}

export interface UserSession {
  remitente: string;
  estado: StateType;
  datosTemporales?: Record<string, any>;
  historialMensajes?: ChatMessage[];
  updatedAt: string;
}

export interface WebhookPayload {
  remitente: string;
  mensaje: string;
  simulatedTime?: string;
  imagenBase64?: string;
  imagenNombre?: string;
}

// ─────────────────────────────────────────────────────────────────
// Tipos de Mensajes Interactivos (compatible Meta Cloud API)
// ─────────────────────────────────────────────────────────────────

export interface InteractiveButton {
  id: string;       // Valor que se envía al backend cuando el paciente lo toca
  title: string;    // Texto visible del botón (máx 20 chars en WhatsApp real)
  emoji?: string;   // Emoji opcional (solo para el simulador web)
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title: string;
  rows: InteractiveListRow[];
}

/** Mensaje con botones de respuesta rápida (máx 3 en WA real) */
export interface InteractiveButtonMessage {
  type: 'button';
  bodyText: string;
  buttons: InteractiveButton[];
}

/** Mensaje con lista desplegable (hasta 10 ítems agrupados en secciones) */
export interface InteractiveListMessage {
  type: 'list';
  bodyText: string;
  buttonLabel: string;  // Texto del botón que abre la lista ("Ver opciones")
  sections: InteractiveListSection[];
}

export type InteractiveMessage = InteractiveButtonMessage | InteractiveListMessage;

export interface WebhookResponse {
  remitente: string;
  respuesta: string;                  // Texto plano (fallback)
  interactive?: InteractiveMessage;   // Payload interactivo para WhatsApp API / simulador
  estadoActual: StateType;
  enHorario: boolean;
  timestamp: string;
  imagenSubidaUrl?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers: Convertir InteractiveMessage → payload Meta Cloud API
// ─────────────────────────────────────────────────────────────────

export function toMetaInteractivePayload(msg: InteractiveMessage, to: string): Record<string, any> {
  if (msg.type === 'button') {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: msg.bodyText },
        action: {
          buttons: msg.buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    };
  }

  // type === 'list'
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: msg.bodyText },
      action: {
        button: msg.buttonLabel,
        sections: msg.sections.map(s => ({
          title: s.title,
          rows: s.rows.map(r => ({
            id: r.id,
            title: r.title,
            description: r.description || ''
          }))
        }))
      }
    }
  };
}
