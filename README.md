# Backend WhatsApp Bot para Clínica Médica (Cloudflare Worker + Firestore)

Este proyecto proporciona un backend completo de atención automática por WhatsApp para una clínica médica, diseñado para ejecutarse **100% gratis** en **Cloudflare Workers** conectándose con **Firebase Firestore (Plan Spark)**.

---

## 🚀 Características Principales

1. **Endpoint `POST /webhook`**:
   - Recibe un JSON en formato `{ "remitente": "+5491112345678", "mensaje": "Hola" }`.
   - Soporta un parámetro opcional `simulatedTime` (ISO string) para simular fechas y horas durante el desarrollo y pruebas.

2. **Control de Horario de Atención (Zona Horaria Argentina)**:
   - Zona Horaria: `America/Argentina/Buenos_Aires` (GMT-3).
   - Horario: **Lunes a Viernes de 08:00 a 20:00 hs**.
   - Respuestas automáticas fuera de horario con el mensaje `#Fuera_de_Horario`.

3. **Máquina de Estados (State Engine) en Firestore**:
   - Identifica el número de teléfono del paciente (`remitente`) y mantiene el estado en la colección `sesiones`.
   - **Saludo de Bienvenida**: Al recibir "hola", "buen dia", etc., despliega el menú principal con opciones **A, B, C, D, E**.
   - **Flujos del Menú**:
     - **Opción A (Turnos)**: Despliega submenú (`1: Médico ORL`, `2: Estudios`, `3: Cirugías`).
       - `A -> 1`: Solicita plantilla de **9 datos**.
       - `A -> 2`: Solicita plantilla de **7 datos + foto del pedido médico**.
       - `A -> 3`: Solicita plantilla de **6 datos + foto del pedido si tiene**.
     - **Opción B (Autorización)**: Solicita foto del pedido + foto del carnet de obra social + datos.
     - **Opción C (Consultas Generales)**: Solicita motivo de ayuda.
     - **Opción D (Afiliados PAMI)**: Solicita los 3 datos requeridos.
     - **Opción E (Reprogramación)**: Solicita DNI, nombre y preferencia horaria.

4. **Guardado de Consultas en Firestore**:
   - Cuando el paciente completa los datos solicitados en cualquier opción, guarda el chat en la colección `consultas` con `estado: "pendiente"` y un objeto estructurado.

5. **Página de Pruebas Interactiva (`public/index.html`)**:
   - Vista web interactiva estilo WhatsApp Web para enviar mensajes, testear el menú, cambiar de paciente y simular comportamiento dentro y fuera de horario.

---

## 📁 Estructura del Proyecto

```
/
├── package.json
├── wrangler.json           # Configuración de Cloudflare Worker
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts            # Servidor Hono y definición de endpoints
│   ├── types.ts            # Definiciones de Interfaces TypeScript
│   ├── config.ts           # Configuración general y constantes
│   ├── templates/
│   │   └── messages.ts     # Plantillas formateadas de los mensajes de WhatsApp
│   ├── services/
│   │   ├── scheduleService.ts   # Verificación de Horario Argentina (Lun-Vie 8-20hs)
│   │   └── firestoreService.ts  # Cliente REST de Firestore para Workers
│   └── stateMachine/
│       └── engine.ts       # Lógica del motor de máquina de estados
└── public/
    └── index.html          # Interfaz web interactiva de pruebas
```

---

## 🛠️ Ejecución Local y Pruebas

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Iniciar Servidor de Desarrollo**:
   ```bash
   npm run dev
   ```
   Wrangler iniciará el servidor local en `http://localhost:8787`.

3. **Abrir la Página de Pruebas**:
   Abre tu navegador en `http://localhost:8787` (o abre `public/index.html` directamente en el navegador).

4. **Probar desde Terminal / cURL**:
   ```bash
   curl -X POST http://localhost:8787/webhook \
     -H "Content-Type: application/json" \
     -d '{"remitente": "+5491112345678", "mensaje": "Hola"}'
   ```

---

## 🔥 Configuración con Firebase Firestore (Plan Spark Gratis)

El proyecto utiliza la **API REST oficial de Firestore** mediante `fetch`, lo que permite una ejecución fluida en Cloudflare Workers sin depender del SDK nativo de Node.js (gRPC/fs).

### Pasos para conectar tu propia base de datos de Firebase:
1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Crea una base de datos en **Firestore Database** en modo de producción.
3. Define las Reglas de Seguridad en Firestore para permitir lectura/escritura pública desde la API REST (o configura tu API Key):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /sesiones/{document} {
         allow read, write: if true;
       }
       match /consultas/{document} {
         allow read, write: if true;
       }
     }
   }
   ```
4. Configura las variables de entorno en `wrangler.json` o mediante secretos en Cloudflare:
   ```bash
   npx wrangler secret put FIREBASE_PROJECT_ID
   npx wrangler secret put FIREBASE_API_KEY
   ```

---

## 🚀 Despliegue en Cloudflare Workers (100% Gratuito)

Para desplegar tu backend a producción en Cloudflare Workers gratis:

```bash
npm run deploy
```

Obtendrás una URL pública `https://wa-bot-clinica.<tu-usuario>.workers.dev/webhook` lista para conectar con cualquier proveedor de API de WhatsApp (como Meta Cloud API, Twilio, Z-API, Baileys, etc.).
