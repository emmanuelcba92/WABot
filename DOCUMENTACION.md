# WhatsBot COAT - Documentación Técnica

## Índice

1. [Arquitectura General](#1-arquitectura-general)
2. [Qué corre en Local vs Cloudflare](#2-qué-corre-en-local-vs-cloudflare)
3. [Almacenamiento de Datos](#3-almacenamiento-de-datos)
4. [Endpoints API](#4-endpoints-api)
5. [Consumo de Requests/día](#5-consumo-de-requestsdía)
6. [Comunicación SSE (Server-Sent Events)](#6-comunicación-sse)
7. [Gateway de WhatsApp](#7-gateway-de-whatsapp)
8. [Máquina de Estados](#8-máquina-de-estados)
9. [Configuración y Variables](#9-configuración-y-variables)
10. [Despliegue y Mantenimiento](#10-despliegue-y-mantenimiento)

---

## 1. Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTERNET                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Cloudflare      │
                    │   Workers         │
                    │   (app.cpcoat...) │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────▼─────┐   ┌────▼────┐   ┌──────▼──────┐
        │    D1     │   │   SSE   │   │   Static    │
        │  (Base    │   │  Push   │   │   Assets    │
        │   Datos)  │   │         │   │   (HTML)    │
        └───────────┘   └────┬────┘   └─────────────┘
                              │
                              │ SSE Connection
                              │
                    ┌─────────▼─────────┐
                    │   Gateway Local   │
                    │   (PC Clínica)    │
                    └─────────┬─────────┘
                              │
                        Baileys API
                              │
                    ┌─────────▼─────────┐
                    │    WhatsApp       │
                    │    (Usuarios)     │
                    └───────────────────┘
```

### Flujo de Mensajes

**Mensaje entrante (Paciente → Bot):**
1. Paciente envía mensaje por WhatsApp
2. WhatsApp notifica al Gateway (Baileys)
3. Gateway envía webhook al Worker (`/webhook`)
4. Worker procesa con la máquina de estados
5. Worker guarda sesión en D1
6. Worker responde por WebSocket a WhatsApp
7. Worker notifica al Web App via SSE (para que aparezca en el panel)

**Mensaje saliente (Secretaría → Paciente):**
1. Secretaría escribe en el Web App
2. Web App envía POST a `/api/send-message`
3. Worker guarda mensaje pendiente en D1
4. Worker notifica al Gateway via SSE
5. Gateway envía mensaje por WhatsApp
6. Gateway confirma envío al Worker

---

## 2. Qué corre en Local vs Cloudflare

### ☁️ Cloudflare Workers (Producción)

| Componente | Descripción |
|------------|-------------|
| **URL** | `https://app.cpcoat.workers.dev` |
| **Worker** | Backend API con Hono.js |
| **D1** | Base de datos SQLite serverless |
| **Static Assets** | HTML, CSS, JS del panel web |
| **SSE** | Server-Sent Events para notificar gateways |
| **Cron** | Trigger cada minuto para tareas programadas |

**Archivos desplegados:**
- `src/index.ts` → Compilado a Worker
- `public/*.html` → Assets estáticos
- `wrangler.json` → Configuración del Worker

### 🖥️ Local (PC de la Clínica)

| Componente | Descripción |
|------------|-------------|
| **Gateway** | Conector WhatsApp via Baileys |
| **Node.js** | Runtime para el gateway |
| **Auth** | Credenciales de WhatsApp Web |
| **Media** | Archivos multimedia descargados |

**Archivos locales:**
- `gateway/whatsapp-web-gateway.js` → Gateway principal
- `gateway/auth_info_baileys/` → Sesión de WhatsApp (NO subir a git)
- `gateway/media/` → Archivos multimedia temporales
- `gateway/sent_history.json` → Historial de mensajes enviados
- `gateway/sent_keys.json` → Keys de mensajes para deduplicación

---

## 3. Almacenamiento de Datos

### 🗄️ Cloudflare D1 (Base de Datos)

| Tabla | Propósito | Datos Almacenados |
|-------|-----------|-------------------|
| `consultas` | Consultas de pacientes | ID, remitente, estado, opción, datos (JSON), timestamp |
| `bot_config` | Configuración del bot | Nombre operador, mark read, modo horario, etc. |
| `menu_tree` | Árbol de menú | Opciones del bot, submenús, respuestas |
| `vip_contacts` | Contactos VIP | Pacientes prioritarios |
| `quick_replies` | Respuestas rápidas | Textos predefinidos para secretaría |
| `pdf_config` | Configuración PDFs | PDFs predefinidos para enviar |
| `tag_config` | Etiquetas | Categorías para clasificar consultas |
| `schedule_mode` | Modo horario | Horario laboral del bot |
| `heartbeat` | Heartbeat | Último ping del gateway |
| `provider_config` | Proveedor DB | Proveedor activo (d1/firestore) |

### 💾 Memoria (In-Memory Cache)

El Worker mantiene caches en memoria para acceso rápido:

| Cache | Descripción | TTL |
|-------|-------------|-----|
| `D1Service.inMemoryConsultas` | Consultas activas | Persiste durante la vida del Worker |
| `D1Service.sessionsMap` | Sesiones de usuarios | Persiste durante la vida del Worker |
| `SSE connections` | Conexiones gateways activas | Mientras esté conectado |

**Nota:** El Worker se reinicia automáticamente, perdiendo estos caches. Se reconstruyen desde D1 al recibir la primera petición.

### 📁 Archivos Locales (Gateway)

| Archivo | Propósito |
|---------|-----------|
| `auth_info_baileys/` | Credenciales de sesión WhatsApp (CRÍTICO - NO borrar) |
| `sent_history.json` | IDs de mensajes ya enviados (deduplicación) |
| `sent_keys.json` | Keys de mensajes para edit/delete |
| `media/` | Imágenes, PDFs, documentos descargados (limpieza nocturna >60 días) |

---

## 4. Endpoints API

### Endpoints Principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Panel de Recepción / Secretaría |
| `GET` | `/health` | Health check del Worker |
| `GET` | `/sse` | Server-Sent Events (conexión gateways) |

### API de Consultas

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/consultas` | Obtener todas las consultas |
| `GET` | `/api/consultas/:id` | Obtener una consulta específica |
| `PATCH` | `/api/consultas/:id` | Actualizar estado/etiquetas |
| `GET` | `/api/patient-history/:remitente` | Historial de un paciente |
| `GET` | `/api/patients/search` | Buscar pacientes |

### API de Mensajería

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/send-message` | Enviar mensaje a paciente |
| `GET` | `/api/pending-outgoing` | Obtener mensajes pendientes |
| `POST` | `/api/sse-ack` | ACK de mensaje enviado por gateway |

### API de Dashboard

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/dashboard/metrics` | Métricas del dashboard |
| `GET` | `/api/dashboard/daily` | Estadísticas diarias |

### API de Configuración

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/config` | Obtener configuración del bot |
| `PUT` | `/api/config` | Actualizar configuración |
| `GET` | `/api/menu-tree` | Obtener árbol de menú |
| `PUT` | `/api/menu-tree` | Actualizar árbol de menú |
| `GET` | `/api/quick-replies` | Obtener respuestas rápidas |
| `PUT` | `/api/quick-replies` | Actualizar respuestas rápidas |

### Webhook

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/webhook` | Recibir mensajes de WhatsApp (desde gateway) |

---

## 5. Consumo de Requests/día

### Cloudflare Free Tier: 100,000 requests/día

### Desglose Estimado

| Componente | Requests/día | Descripción |
|------------|--------------|-------------|
| **Heartbeat gateway** | ~1,440 | Cada 60 segundos |
| **SSE keepalive** | ~0 | No consume requests (es parte de la conexión SSE) |
| **Polling gateway (SSE up)** | ~2,880 | Cada 30 segundos (safety net) |
| **Polling gateway (SSE down)** | ~17,280 | Cada 5 segundos (fallback) |
| **Web App (consultas)** | ~500-2,000 | Dependiendo del uso |
| **Web App (envío mensajes)** | ~100-500 | Dependiendo del volumen |
| **Webhooks entrantes** | ~100-1,000 | Mensajes de pacientes |
| **Total estimado (normal)** | ~5,000-10,000 | ~5-10% del límite |
| **Total estimado (SSE caído)** | ~20,000-25,000 | ~20-25% del límite |

### Optimizaciones Implementadas

1. **Cache en memoria**: Reduce lecturas a D1
2. **Merge D1 + memoria**: Previene stale reads
3. **Polling adaptativo**: 5s cuando SSE caído, 30s cuando SSE vivo
4. **Deduplicación**: Evita procesar mensajes dos veces
5. **SSE push**: Notificaciones instantáneas cuando SSE está conectado

### Umbrales de Alerta

| Nivel | Requests/día | Acción |
|-------|--------------|--------|
| 🟢 Normal | < 50,000 | Ninguna |
| 🟡 Alerta | 50,000 - 75,000 | Revisar uso |
| 🟠 Crítico | 75,000 - 90,000 | Reducir polling |
| 🔴 Peligro | > 90,000 | Suspender polling |

---

## 6. Comunicación SSE (Server-Sent Events)

### ¿Qué es SSE?

Server-Sent Events es un protocolo que permite al servidor enviar datos al cliente de forma unidireccional y en tiempo real sobre una conexión HTTP persistente.

### Conexión SSE

```
Worker (Cloudflare)                    Gateway (Local PC)
       │                                      │
       │  GET /sse?gateway=Emmanuel           │
       │─────────────────────────────────────→│
       │                                      │
       │  200 OK                              │
       │  Content-Type: text/event-stream     │
       │←─────────────────────────────────────│
       │                                      │
       │  data: {"type":"connected",...}      │
       │←─────────────────────────────────────│
       │                                      │
       │  : keepalive (cada 15s)              │
       │←─────────────────────────────────────│
       │                                      │
       │  data: {"type":"pending_outgoing"}   │
       │←─────────────────────────────────────│
       │                                      │
```

### Keepalive

El Worker envía keepalive comments (`: keepalive\n\n`) cada 15 segundos para mantener la conexión viva. Cloudflare edge tiene un "idle watchdog" de 5 minutos que cierra conexiones sin actividad.

**Importante:** El `setInterval` del keepalive está envuelto en `c.executionCtx.waitUntil()` para evitar que el Workers runtime lo cancele ~30s después del return.

### Fallback a Polling

Cuando SSE se desconecta:
1. Gateway detecta la desconexión (keepalive timeout de 30s)
2. Gateway reconecta automáticamente (cada 5 segundos)
3. Mientras tanto, polling corre cada 5 segundos para recoger mensajes pendientes
4. Al reconectar, `fetchPendingMessagesOnce()` procesa mensajes encolados

### Mensajes SSE

| Tipo | Dirección | Descripción |
|------|-----------|-------------|
| `connected` | Worker → Gateway | Confirmación de conexión |
| `pending_outgoing` | Worker → Gateway | Nuevo mensaje para enviar |
| `heartbeat` | Gateway → Worker | Ping de actividad |

---

## 7. Gateway de WhatsApp

### Tecnología

- **Baileys**: Biblioteca no oficial de WhatsApp Web
- **Node.js**: Runtime del gateway
- **Sharp**: Procesamiento de imágenes

### Funciones del Gateway

1. **Conexión WhatsApp**: Escaneo de QR code para autenticación
2. **Recepción de mensajes**: Webhook de WhatsApp → Worker
3. **Envío de mensajes**: Worker → Gateway → WhatsApp
4. **Multimedia**: Descarga y envío de imágenes, PDFs, documentos
5. **Heartbeat**: Ping cada 60 segundos al Worker
6. **Deduplicación**: Evita reenviar mensajes ya procesados

### Configuración del Gateway

```javascript
// whatsapp-web-gateway.js
const WORKER_WEBHOOK_URL = 'https://app.cpcoat.workers.dev/webhook';
const WORKER_PENDING_URL = 'https://app.cpcoat.workers.dev/api/pending-outgoing';
const WORKER_HEARTBEAT_URL = 'https://app.cpcoat.workers.dev/api/heartbeat';
const WORKER_SSE_URL = 'https://app.cpcoat.workers.dev/sse';
const GATEWAY_ID = require('os').hostname();
```

### Archivos del Gateway

| Archivo | Propósito |
|---------|-----------|
| `whatsapp-web-gateway.js` | Código principal del gateway |
| `auth_info_baileys/` | Credenciales de sesión (NO borrar) |
| `media/` | Archivos multimedia temporales |
| `sent_history.json` | IDs de mensajes enviados |
| `sent_keys.json` | Keys para edit/delete |
| `Iniciar_Bot.bat` | Script de inicio (Windows) |

### Comandos Útiles

```bash
# Iniciar gateway
npm start

# Cerrar sesión de WhatsApp
npm run logout

# Ver logs en tiempo real
# Los logs se muestran en la consola donde se ejecuta npm start
```

---

## 8. Máquina de Estados

### Estados del Bot

```
┌─────────────────────────────────────────────────────────────┐
│                     INICIO                                   │
│  (Mensaje "Hola" o primer contacto)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  ESPERANDO_OPCION                            │
│  (Menú principal: 1, 2, 3, 4)                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐
    │ Opción  │  │ Opción  │  │ Opción  │
    │   1     │  │   2     │  │   3     │
    └────┬────┘  └────┬────┘  └────┬────┘
         │            │            │
         ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│              ESPERANDO_SUB_A / SUB_B / SUB_C                 │
│  (Submenús de cada opción)                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            ESPERANDO_DATOS_A_1 / A_2 / etc.                 │
│  (Recolección de datos del paciente)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              ESPERANDO_CONFIRMACION                         │
│  (Confirmar datos ingresados)                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           ESPERANDO_ATENCION_HUMANA                         │
│  (Consulta derivada a secretaría)                           │
│  → Se crea registro en D1 (consultas)                       │
│  → Aparece en el panel web                                  │
└─────────────────────────────────────────────────────────────┘
```

### Transiciones de Estado

| Estado Actual | Entrada | Estado Siguiente | Acción |
|---------------|---------|------------------|--------|
| `inicio` | Cualquier mensaje | `esperando_opcion` | Mostrar menú |
| `esperando_opcion` | "1" | `esperando_sub_a` | Submenú ORL |
| `esperando_opcion` | "2" | `esperando_sub_b` | Submenú Alergista |
| `esperando_opcion` | "3" | `esperando_sub_c` | Submenú Estudios |
| `esperando_sub_a` | "1" | `esperando_datos_a_1` | Formulario |
| `esperando_datos_a_*` | Datos completos | `esperando_atencion_humana` | Crear consulta |
| `esperando_atencion_humana` | "Hola" | `inicio` | Reiniciar |

---

## 9. Configuración y Variables

### Variables de Entorno (wrangler.json)

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `DB_PROVIDER` | `d1` | Proveedor de base de datos |
| `ALERT_EMAIL` | `emmanuel.ag92@gmail.com` | Email para alertas |
| `TELEGRAM_BOT_TOKEN` | `8894208204:AAE...` | Token bot de Telegram |
| `TELEGRAM_CHAT_ID` | `-5112025915` | Chat ID de Telegram |
| `GOOGLE_SCRIPT_URL` | `https://script.google.com/...` | URL de Google Apps Script |
| `FIREBASE_PROJECT_ID` | `botwa-524e8` | ID proyecto Firebase (no usado) |
| `FIREBASE_API_KEY` | `AIzaSyAHi...` | API Key Firebase (no usado) |

### Configuración del Bot (en D1: `bot_config`)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `showOperatorName` | boolean | Mostrar nombre del operador en respuestas |
| `markReadOnReply` | boolean | Marcar mensajes como leídos al responder |
| `scheduleMode` | string | Modo horario (`business`, `24hs`, `custom`) |
| `businessHours` | object | Horario laboral personalizado |

### Cuenta Cloudflare

| Dato | Valor |
|------|-------|
| **Account ID** | `4bce52406e734e4cf4300b8d41024824` |
| **Subdominio** | `cpcoat.workers.dev` |
| **Worker** | `app` |
| **D1 Database** | `wabot_coat_db` |
| **D1 ID** | `fc66df83-cabf-4c06-8cd9-63b4855f1ce0` |

---

## 10. Despliegue y Mantenimiento

### Comandos de Despliegue

```bash
# Desplegar Worker a Cloudflare
npm run deploy

# Desarrollo local
npm run dev

# Build TypeScript
npm run build
```

### Actualizar Gateway (PC Local)

El gateway corre en la PC de la clínica y NO se despliega automáticamente. Para actualizar:

1. Copiar los cambios a la PC de la clínica
2. Ejecutar `npm install` si hay nuevas dependencias
3. Ejecutar `npm stop` para detener el gateway actual
4. Ejecutar `npm start` para iniciar el gateway actualizado

**Nota:** El gateway se reinicia automáticamente después de cada cambio del Worker (SSE reconnect).

### Monitoreo

**Logs del Worker:**
- En la consola de Cloudflare Dashboard → Workers → app → Logs

**Logs del Gateway:**
- En la consola donde se ejecuta `npm start`

**Métricas de Requests:**
- Cloudflare Dashboard → Workers → app → Metrics

### Backup

| Componente | Método | Frecuencia |
|------------|--------|------------|
| D1 Database | `wrangler d1 export` | Manual |
| Auth WhatsApp | Copiar `auth_info_baileys/` | Manual |
| Configuración | `wrangler.json` | En git |

### troubleshooting

| Problema | Solución |
|----------|----------|
| Gateway no conecta | Verificar que el Worker esté desplegado y accesible |
| QR code no aparece | Ejecutar `npm run logout` y reiniciar |
| Mensajes no llegan | Verificar logs del gateway, reiniciar si es necesario |
| SSE se desconecta | Verificar conexión a internet, revisar logs |
| Worker no responde | Verificar en Cloudflare Dashboard si hay errores |

---

## Enlaces Útiles

- **Panel Web:** https://app.cpcoat.workers.dev
- **Admin:** https://app.cpcoat.workers.dev/admin
- **GitHub:** https://github.com/emmanuelcba92/WABot
- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **Documentación Baileys:** https://github.com/WhiskeySockets/Baileys

---

*Última actualización: Agosto 2026*
