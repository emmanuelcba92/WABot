import { Env } from '../types';

export interface MetaSendResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

function getPhoneCandidates(toPhoneNumber: string): string[] {
  const cleanTo = toPhoneNumber.replace(/\D/g, '');
  const candidates: string[] = [];

  // Para números de Argentina:
  // WhatsApp les asigna 549351XXXXXXX (13 dígitos)
  // Pero la consola Sandbox de Meta registra 5435115XXXXXXX (14 dígitos con el 15)
  if (cleanTo.startsWith('549') && cleanTo.length === 13) {
    const area = cleanTo.substring(3, 6);
    const local = cleanTo.substring(6);
    candidates.push(`54${area}15${local}`); // Priorizar formato Sandbox Meta con 15
    candidates.push(cleanTo);               // Luego formato estándar WhatsApp
  } else if (cleanTo.startsWith('54') && cleanTo.length === 14 && cleanTo.substring(5, 7) === '15') {
    const area = cleanTo.substring(2, 5);
    const local = cleanTo.substring(7);
    candidates.push(cleanTo);
    candidates.push(`549${area}${local}`);
  } else {
    candidates.push(cleanTo);
  }

  return candidates;
}

/**
 * Servicio para enviar mensajes mediante la API oficial de WhatsApp (Meta Cloud API)
 */
export class MetaWhatsappService {
  /**
   * Envía un mensaje de texto plano a un número usando Meta Cloud API
   */
  static async sendTextMessage(env: Env, toPhoneNumber: string, text: string): Promise<boolean> {
    const phoneNumberId = env.META_PHONE_NUMBER_ID;
    const accessToken = env.META_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      console.error('❌ [META SERVICE] Falta META_PHONE_NUMBER_ID o META_ACCESS_TOKEN en las variables de entorno.');
      return false;
    }

    const candidates = getPhoneCandidates(toPhoneNumber);
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    for (const targetTo of candidates) {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: targetTo,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      };

      try {
        console.log(`📤 [META SERVICE] Probando envío a ${targetTo}...`);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data: MetaSendResponse = await response.json();
          console.log(`✅ [META SERVICE] Mensaje enviado con éxito a ${targetTo}. Message ID: ${data.messages?.[0]?.id}`);
          return true;
        }

        const errorData = await response.text();
        console.error(`❌ [META SERVICE] Falló envío a ${targetTo} (${response.status}):`, errorData);
      } catch (error: any) {
        console.error(`❌ [META SERVICE] Excepción enviando a ${targetTo}:`, error);
      }
    }

    return false;
  }

  /**
   * Envía un mensaje interactivo con botones simples (máx 3 botones por política de Meta)
   */
  static async sendInteractiveButtons(
    env: Env,
    toPhoneNumber: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText?: string,
    footerText?: string
  ): Promise<boolean> {
    const phoneNumberId = env.META_PHONE_NUMBER_ID;
    const accessToken = env.META_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      console.error('❌ [META SERVICE] Falta META_PHONE_NUMBER_ID o META_ACCESS_TOKEN.');
      return false;
    }

    const candidates = getPhoneCandidates(toPhoneNumber);
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    // Limit a máximo 3 botones por requerimiento de Meta
    const metaButtons = buttons.slice(0, 3).map(btn => ({
      type: 'reply',
      reply: {
        id: btn.id.substring(0, 256),
        title: btn.title.substring(0, 20) // Meta limita títulos a 20 caracteres
      }
    }));

    const interactiveObject: any = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: metaButtons }
    };

    if (headerText) {
      interactiveObject.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactiveObject.footer = { text: footerText };
    }

    for (const targetTo of candidates) {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: targetTo,
        type: 'interactive',
        interactive: interactiveObject
      };

      try {
        console.log(`📤 [META SERVICE] Probando botones a ${targetTo}...`);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data: MetaSendResponse = await response.json();
          console.log(`✅ [META SERVICE] Botones enviados con éxito a ${targetTo}. Message ID: ${data.messages?.[0]?.id}`);
          return true;
        }

        const errorData = await response.text();
        console.error(`❌ [META SERVICE] Falló envío de botones a ${targetTo} (${response.status}):`, errorData);
      } catch (error) {
        console.error(`❌ [META SERVICE] Excepción botones a ${targetTo}:`, error);
      }
    }

    // Fallback a texto si falla el botón interactivo
    return await this.sendTextMessage(env, toPhoneNumber, bodyText);
  }
}
