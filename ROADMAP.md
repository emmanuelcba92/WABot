# 📌 Hoja de Ruta - WhatsBot COAT

Documento de seguimiento del desarrollo. Última actualización: 3 de Agosto de 2026.

---

## ✅ Completado

- [x] Conexión Multidispositivo y Deduplicación Atómica
- [x] Emparejamiento por @lid / Número Limpio
- [x] Visor de PDFs Integrado
- [x] Multi-Operador en Tiempo Real (En gestión por...)
- [x] Formato Estilo WhatsApp Web (emojis, negritas)
- [x] Multi-Proveedor de Base de Datos (D1 / Firebase / PC Local)
- [x] Login Obligatorio con Firebase Auth (JWT + Google)
- [x] Gestión de Usuarios y Roles (Admin vs Secretaría)
- [x] Almacenamiento Local en PC (Plantillas PDF)
- [x] Alerta de Desconexión al Minuto (60s) vía Telegram + Email
- [x] Tildes Azules de Lectura en Tiempo Real (✓✓ azul)
- [x] Edición de Mensajes Enviados (✏️ Editado)
- [x] Eliminación de Mensajes para Todos (🗑️)
- [x] Caché en Memoria RAM (In-Memory Cache TTL 10s)
- [x] Acceso Global a Respuestas Rápidas & PDFs
- [x] Configuración Restringida para Admins
- [x] Deduplicación Persistente en Disco (sent_history.json)
- [x] SSE Endpoints (`/sse` gateways + `/sse-webapp` panel)
- [x] Auth Infrastructure (AuthService con JWT + Google + password hashing)

---

## 🔴 Prioridad Crítica — Seguridad

### 1. Middleware de Auth en Endpoints Sensibles
**Estado:** ✅ Implementado | **Esfuerzo:** Bajo | **Impacto:** CRÍTICO

Los endpoints sensibles están completamente abiertos. Cualquiera puede:
- `POST /api/clear-consultas` → Borrar TODOS los datos
- `POST /api/seed-consultas` → Inyectar datos falsos
- `POST /api/send-message` → Enviar mensajes a pacientes
- `DELETE /api/users/:username` → Eliminar usuarios
- `POST /api/menu-tree` → Cambiar el menú del bot

**Plan:**
1. Crear middleware `authMiddleware` en Hono que verifique JWT en rutas sensibles
2. Aplicar a endpoints de escritura (POST/PUT/DELETE)
3. Excluir rutas públicas: `/webhook`, `/health`, `/api/auth/*`, `/api/pending-outgoing`, `/sse`

**Archivos a modificar:**
- `src/index.ts` → Agregar middleware + importar AuthService
- `src/services/authService.ts` → Verificar que `verifyJWT` esté exportado

---

## 🟡 Prioridad Alta — Funcionalidad

### 2. Envío de Ubicación GPS Nativa
**Estado:** Parcial (config existe, envío no) | **Esfuerzo:** Bajo | **Impacto:** Alto

La config de GPS de la clínica ya está almacenada (`/api/clinic-config` con lat/lng). Falta:
1. Agregar `sendLocation` en el gateway (`whatsapp-web-gateway.js`) usando Baileys
2. Crear botón "📍 Ubicación" en el panel web
3. Nuevo endpoint `POST /api/send-location` o agregar acción al existente `addPendingOutgoing`

**Archivos a modificar:**
- `gateway/whatsapp-web-gateway.js` → Manejar acción `send_location`
- `src/index.ts` → Nuevo endpoint o extender `send-message`
- `public/` → Botón de ubicación en el panel

---

### 3. Respuestas Rápidas Personales por Usuario
**Estado:** Pendiente | **Esfuerzo:** Bajo-Medio | **Impacto:** Alto

Actualmente las respuestas rápidas son globales. Plan:
1. Agregar campo `createdBy` (username) al schema de quick replies
2. Filtrar por usuario en el panel (mostrar globales + propias)
3. Permitir crear/editar/eliminar respuestas personales
4. Endpoint existente `GET/POST /api/quick-replies` → Adaptar

**Archivos a modificar:**
- `src/services/d1Service.ts` → Filtrar por `createdBy`
- `src/services/firestoreService.ts` → Actualizar interfaz `QuickReplyItem`
- `public/` → UI de "Mis Respuestas Rápidas"

---

## 🟠 Prioridad Media — Funcionalidad

### 4. Pestaña de Grupos de WhatsApp
**Estado:** No implementado (grupos filtrados) | **Esfuerzo:** Alto | **Impacto:** Medio

Actualmente el gateway descarta mensajes de grupos (`@g.us`). Plan:
1. En el gateway: detectar mensajes de grupos específicos (configurables)
2. Guardar mensajes de grupos en tabla separada o en consultas con flag `isGroup`
3. Panel web: nueva pestaña "Grupos" con lista de grupos habilitados
4. El bot NO responde automáticamente en grupos (solo visualización)

**Archivos a modificar:**
- `gateway/whatsapp-web-gateway.js` → No filtrar grupos configurados
- `src/services/d1Service.ts` → Tabla o flag para mensajes de grupos
- `src/index.ts` → Endpoints para gestión de grupos
- `public/` → Nueva pestaña "Grupos"

---

### 5. Sistema de Alertas de Desconexión Mejorado
**Estado:** Funcional pero básico | **Esfuerzo:** Bajo | **Impacto:** Medio

Mejoras posibles:
- [ ] Reintentos con backoff exponencial en envío de alertas
- [ ] Historial de desconexiones (cuándo ocurrió, duración)
- [ ] Notificación de reconexión exitosa
- [ ] Dashboard de estado del gateway en tiempo real

---

## 🔵 Prioridad Baja — Expansión

### 6. Backup Automático de D1
**Estado:** No implementado | **Esfuerzo:** Medio | **Impacto:** Bajo

Plan:
1. Nuevo endpoint `POST /api/backup` que exporte consultas como JSON
2. Cron trigger mensual que exporte y envíe por email
3. Opcional: almacenar en R2 si se habilita

### 7. Integración con Cloudflare R2
**Estado:** No implementado | **Esfuerzo:** Medio | **Impacto:** Bajo

Solo necesario si se necesita acceder a archivos multimedia desde fuera de la red local. Actualmente se usa Supabase Storage + Base64 inline.

---

## 📊 Métricas de Consumo (Cloudflare Free Tier)

| Concepto | Límite | Uso Estimado |
|----------|--------|--------------|
| Requests/día | 100,000 | ~5,000-10,000 (normal) |
| D1 Reads/día | 10,000,000 | ~50,000 (con caché) |
| D1 Writes/día | 100,000 | ~5,000 |
| Worker CPU time | 10ms (free) | <5ms promedio |

---

*Hoja de ruta creada el 3 de Agosto de 2026 - Proyecto WhatsBot COAT*
