export interface Env {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  DB_PROVIDER?: string;
  DB?: any;
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  SUPABASE_BUCKET?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  GOOGLE_ACCESS_TOKEN?: string;
  JWT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  ASSETS?: Fetcher;
}

export interface AppUser {
  username: string;
  displayName?: string;
  email?: string;
  role: 'admin' | 'secretaria';
  passwordHash?: string;
  salt?: string;
  createdAt: string;
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
  | 'esperando_datos_opcion_e'
  | 'esperando_atencion_humana'; // Bot silenciado en atención por secretaría

export interface ChatMessage {
  id: string;
  sender: 'paciente' | 'bot' | 'secretaria';
  text: string;
  timestamp: string;
  imageUrl?: string;
  interactive?: InteractiveMessage;
  status?: 'sent' | 'delivered' | 'read';
  edited?: boolean;
  deleted?: boolean;
  baileysId?: string;
  key?: any;
}

export interface UserSession {
  remitente: string;
  estado: StateType | string;
  datosTemporales?: Record<string, any>;
  historialMensajes?: ChatMessage[];
  updatedAt: string;
}

export interface PendingOutgoingMsg {
  id: string;
  remitente: string;
  altRemitente?: string;
  targetJid?: string;
  text: string;
  pdfUrl?: string;
  pdfNombre?: string;
  pdfBase64?: string;
  imagenBase64?: string;
  timestamp: string;
  action?: 'send' | 'delete' | 'edit';
  targetMsgId?: string;
  targetMsgKey?: any;
  internalMsgId?: string;
}

export interface WebhookPayload {
  remitente: string;
  altRemitente?: string;
  pushName?: string;
  mensaje: string;
  simulatedTime?: string;
  imagenBase64?: string;
  imagenNombre?: string;
  pdfBase64?: string;
  pdfNombre?: string;
}

export interface DoctorItem {
  id: string;
  name: string;
  specialty: string;
  phone: string;
}

export interface InteractiveButton {
  id: string;
  title: string;
  emoji?: string;
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

export interface InteractiveMessage {
  type: 'button' | 'list';
  header?: string;
  body?: string;
  bodyText?: string;
  footer?: string;
  buttonLabel?: string;
  buttonText?: string;
  buttons?: InteractiveButton[];
  sections?: InteractiveListSection[];
}

export type InteractiveButtonMessage = InteractiveMessage;
export type InteractiveListMessage = InteractiveMessage;

export interface WebhookResponse {
  remitente?: string;
  respuesta: string;
  interactive?: InteractiveMessage;
  estadoActual?: StateType | string;
  siguienteEstado?: StateType | string;
  enHorario?: boolean;
  timestamp?: string;
  guardarEnBD?: boolean;
  datosRecolectados?: Record<string, any>;
  imagenSubidaUrl?: string;
}

export interface MenuItemOption {
  key: string;
  label: string;
  type: 'form' | 'submenu' | 'info';
  responseTemplate?: string;
  subItems?: MenuItemOption[];
}

export interface MenuTreeConfig {
  welcomeMessage: string;
  items: MenuItemOption[];
}
