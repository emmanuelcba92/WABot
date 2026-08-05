-- TABLAS SQL PARA CLOUDFLARE D1 EN LA CLÍNICA COAT

CREATE TABLE IF NOT EXISTS consultas (
  id TEXT PRIMARY KEY,
  remitente TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  opcion TEXT,
  datos TEXT,
  timestamp INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_config (
  id TEXT PRIMARY KEY DEFAULT 'config',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_tree (
  id TEXT PRIMARY KEY DEFAULT 'tree',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vip_contacts (
  id TEXT PRIMARY KEY DEFAULT 'vip',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quick_replies (
  id TEXT PRIMARY KEY DEFAULT 'replies',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pdf_config (
  id TEXT PRIMARY KEY DEFAULT 'pdfs',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_config (
  id TEXT PRIMARY KEY DEFAULT 'tags',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_mode (
  id TEXT PRIMARY KEY DEFAULT 'schedule',
  mode TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeat (
  id TEXT PRIMARY KEY DEFAULT 'ping',
  lastPing INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_config (
  id TEXT PRIMARY KEY DEFAULT 'current',
  provider TEXT NOT NULL DEFAULT 'd1'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  userRole TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  targetRemitente TEXT,
  timestamp INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);
