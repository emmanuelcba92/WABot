# Conector de WhatsApp Web (Sin Meta API)

Este conector permite vincular el número de teléfono real de la clínica mediante **WhatsApp Web** (escaneando un código QR en pantalla), sin necesidad de registrarse en Meta Cloud API ni pagar comisiones por mensajes.

---

## 🚀 Pasos para Iniciar en cualquier PC o Servidor:

1. **Entrar a la carpeta `gateway`**:
   ```bash
   cd gateway
   ```

2. **Instalar las dependencias**:
   ```bash
   npm install
   ```

3. **Iniciar el conector**:
   ```bash
   npm start
   ```

4. **Escanear el Código QR**:
   - Aparecerá un Código QR en la terminal.
   - Abre WhatsApp en el celular de la clínica > Dispositivos vinculados > **Vincular un dispositivo**.
   - Escanea el QR.

¡Listo! A partir de ese momento, todos los pacientes que le escriban a ese WhatsApp serán atendidos automáticamente por tu Cloudflare Worker y guardados en el Panel de Recepción.
