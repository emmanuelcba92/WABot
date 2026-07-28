export interface Env {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  // Supabase credentials (opcional)
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  SUPABASE_BUCKET?: string;
  // Google Drive credentials (opcional)
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

export interface UserSession {
  remitente: string;
  estado: StateType;
  datosTemporales?: Record<string, any>;
  updatedAt: string;
}

export interface WebhookPayload {
  remitente: string;
  mensaje: string;
  simulatedTime?: string; // Ej: "2026-07-27T14:30:00-03:00"
  imagenBase64?: string;  // Data URL base64 o string base64 de la imagen enviada
  imagenNombre?: string;  // Nombre opcional del archivo (ej: "pedido_medico.jpg")
}

export interface WebhookResponse {
  remitente: string;
  respuesta: string;
  estadoActual: StateType;
  enHorario: boolean;
  timestamp: string;
  imagenSubidaUrl?: string; // URL de la imagen subida en Google Drive o Supabase
}
