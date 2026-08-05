# 📌 Hoja de Ruta y Pendientes - WA Bot Clínica COAT

Documento oficial de seguimiento con todas las funciones conversadas, prioridades e ideas acordadas para la versión de producción.

---

## 🟢 1. En Desarrollo / Implementado en esta entrega

### 🛡️ Core del Sistema, Conectividad y Deduplicación
- [x] **Conexión Multidispositivo y Deduplicación Atómica**: Prevención de mensajes dobles y resincronización automática de sesión tras borrados.
- [x] **Emparejamiento por @lid / Número Limpio**: El bot no interrumpe ni menú ni chats iniciados manualmente por secretaría. Reset automático de alias `@lid` al finalizar la atención.
- [x] **Deduplicación Persistente en Disco SSD (`sent_history.json`)**: Registro permanente para evitar re-envíos de mensajes incluso tras reiniciar el proceso de la PC.
- [x] **Captura de Respuestas enviadas desde WhatsApp Web**: El historial refleja incluso los mensajes enviados directamente desde el teléfono o WhatsApp Web oficial.

### ⚡ Notificaciones, Optimización y Cierre por Inactividad
- [x] **Server-Sent Events (SSE) vía Cloudflare Durable Objects (`SseBroker`)**: Entrega instantánea de mensajes en tiempo real a todas las pantallas de secretaría conectadas sin demora.
- [x] **Smart Polling Adaptativo + Page Visibility API**: Polling dinámico que se autorreduce (3s → 8s → 15s) cuando no hay actividad y se frena cuando la pestaña está en segundo plano. Reducción del **65% en consumo de requests**.
- [x] **Auto-Logout de Sesión tras 2 Horas de Inactividad**: Cierre de sesión automático y redirección amigable al Login tras 2 horas sin interacción del operador, reduciendo a 0 el consumo de peticiones a Cloudflare si la PC queda encendida de noche.
- [x] **Multi-Operador en Tiempo Real (En gestión por...)**: Indicador visual dinámico (*👁️ En gestión por Vos / Sofía*) con liberación automática e instantánea al cambiar de chat o cerrar solapa.

### 📍 Ubicación GPS Nativa & 📜 Registro de Auditoría (Audit Logs)
- [x] **Envío de Ubicación GPS Nativa de WhatsApp**: Botón `📍 Enviar Ubicación GPS` accesible para todos los operadores para enviar la tarjeta interactiva de mapa GPS con las coordenadas y dirección de la Clínica COAT.
- [x] **Sistema de Registro de Auditoría (Audit Logs - Exclusivo Admins)**: Pestaña `📜 Registro Auditoría` visible únicamente para usuarios con rol de Administrador (`admin`) para auditar todas las acciones del sistema (envío de ubicación, cambios de estado, logins, modificaciones de config, etc.) con usuario, fecha y detalles.

### 🚨 Monitoreo y Alertas Automáticas
- [x] **Cron Watchdog en la Nube (Cloudflare Triggers `* * * * *`)**: Vigilancia automática de señal sin depender de que la Web App esté abierta.
- [x] **Alertas de Desconexión vía Telegram & Email (Google Apps Script / Resend)**: Notificación inmediata enviada al Grupo de Telegram de Encargados (`-5112025915`) y a múltiples casillas de correo cuando el conector lleva +90 segundos sin señal.
- [x] **Control Anti-Spam Persistente en D1**: Garantiza que se envíe solo **1 única alerta por caída** para no saturar los teléfonos durante la noche cuando la PC se apaga.

### 💬 Experiencia de Usuario (UX) y Métricas
- [x] **Visor de PDFs Integrado**: Vista previa inline de pedidos médicos en PDF sin necesidad de descarga previa obligatoria.
- [x] **Formato Estilo WhatsApp Web**: Reconocimiento de plantillas con emojis (`🪪 DNI`, `👤 Nombre`, `🏥 Obra social`, etc.) y renderizado de negritas.
- [x] **Tildes Azules de Lectura en Tiempo Real (`✓` / `✓✓` / `✓✓` azul)**: Visualización dinámica de entrega y lectura de cada mensaje de secretaría en el panel web.
- [x] **Edición de Mensajes Enviados (✏️)**: Botón de edición en cada globo para corregir textos directamente en el WhatsApp del paciente *(✏️ Editado)*.
- [x] **Eliminación de Mensajes para Todos (🗑️)**: Botón de borrado directo para eliminar mensajes de la Web App y de WhatsApp *(Eliminar para todos)*.
- [x] **Dashboard de Métricas e Indicadores (`dashboard.html`)**: Gráficos de actividad de los últimos 7 días, atenciones por secretaria, totales de mensajes y distribución por tipo de consulta.

### ⚙️ Administración y Mantenimiento
- [x] **Configuración Opcional de Lectura en WhatsApp (Pestaña `10. Lectura en WhatsApp`)**: Permite elegir si los chats se marcan como leídos automáticamente al responder un mensaje o al finalizar la atención.
- [x] **Mantenimiento y Auto-Limpieza del Sistema (Pestaña `11. Mantenimiento del Sistema`)**: Retención configurable de días para auto-limpieza periódica de consultas antiguas en la base de datos D1.
- [x] **Configuración de la Clínica (Pestaña `9. Configuración de la Clínica`)**: Nombre, dirección y coordenadas GPS dinámicas para enviar la ubicación a los pacientes.

---

## 🟡 2. Pendientes Aprobados para Próximas Entregas

### 🎙️ A) Transcripción de Voz e Inteligencia Artificial
- [ ] **Transcripción Automática de Audios y Notas de Voz de Pacientes (Speech-to-Text)**:
  - Captura de mensajes de audio (`audioMessage` / `pttMessage`) en el Gateway de WhatsApp.
  - Procesamiento ultrarrápido (1-2s) para convertir la nota de voz a texto.
  - Visualización del reproductor de audio junto con la transcripción completa en la pantalla de secretaría (*"🎤 Audio de paciente (0:45s) — Transcripción: '...' "*).

### 🔔 Notificaciones Sonoras y Alertas de Escritorio (PWA)
- [x] **Tono Multinota Sutil de Audio (Web Audio API)**: Generador de audio sin archivos pesados para avisar con un chasquido sutil cuando entra un mensaje de paciente.
- [x] **Alertas Emergentes del Navegador (Web Notifications API)**: Notificaciones en segundo plano con el nombre del paciente y fragmento de mensaje para que las secretarias se enteren sin tener la pestaña visible.
- [x] **Controles de Encendido/Mutado en Barra Superior**: Botones interactivos `🔔 Sonido Activado / 🔕 Sonido Mutado` y `🔔 Activar Alertas Escritorio` para activar o silenciar notificaciones en 1 clic.

---

## 🟡 2. Pendientes Aprobados para Próximas Entregas

### 🎙️ A) Transcripción de Voz e Inteligencia Artificial
- [ ] **Transcripción Automática de Audios y Notas de Voz de Pacientes (Speech-to-Text)**:
  - Captura de mensajes de audio (`audioMessage` / `pttMessage`) en el Gateway de WhatsApp.
  - Procesamiento ultrarrápido (1-2s) para convertir la nota de voz a texto.
  - Visualización del reproductor de audio junto con la transcripción completa en la pantalla de secretaría (*"🎤 Audio de paciente (0:45s) — Transcripción: '...' "*).

### 👥 B) Funciones de Mensajería, Grupos y Plantillas
- [ ] **Pestaña de Grupos de WhatsApp (Residentes & Socios)**: Pestaña dedicada en la Web App para visualizar y responder a grupos seleccionados (ej: Residentes, Socios) sin que el bot responda de forma automática en ellos.
- [ ] **Respuestas Rápidas Personales por Usuario**: Sección *"Mis Respuestas Rápidas"* donde cada secretaria puede guardar sus propias plantillas y saludos frecuentes individuales.
- [ ] **Cierre Rápido de Chat con Motivo de Consulta**: Modal rápido al finalizar consulta para clasificar el motivo (`Solicitud de Turno`, `Estudios/Recetas`, `Cirugía`, etc.) y generar estadísticas.
- [ ] **Mensaje Dinámico "Fuera de Horario" de Guardia**: Permitir a las secretarias configurar un aviso personalizado de guardia antes de retirarse.

---

## 🔵 3. Futuras Expansiones (Evaluación posterior)

- [ ] **Integración opcional de Cloudflare R2**: Almacenamiento de archivos en la nube gratis si en el futuro se desea ver archivos desde fuera de la red local.
- [ ] **Copia de Seguridad (Backup) Automático**: Exportación programada periódica de la base de datos de consultas en archivo descargable JSON / CSV.

---

*Última actualización: 4 de Agosto de 2026 - Proyecto WA Bot Clínica COAT*
