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

export interface WebhookResponse {
  remitente: string;
  respuesta: string;
  estadoActual: StateType;
  enHorario: boolean;
  timestamp: string;
  imagenSubidaUrl?: string;
}
