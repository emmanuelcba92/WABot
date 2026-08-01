import { AppUser } from '../types';

export class AuthService {
  private static DEFAULT_JWT_SECRET = 'coat-clinica-jwt-secret-key-2026';

  /**
   * Genera un hash criptográfico SHA-256 con Salt para la contraseña.
   */
  public static async hashPassword(password: string, saltInput?: string): Promise<{ hash: string; salt: string }> {
    const encoder = new TextEncoder();
    let salt = saltInput;
    if (!salt) {
      const saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
      salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const data = encoder.encode(salt + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return { hash, salt };
  }

  /**
   * Verifica si la contraseña dada coincide con el hash y salt guardados.
   */
  public static async verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
    if (!storedHash || !storedSalt) return false;
    const { hash } = await this.hashPassword(password, storedSalt);
    return hash === storedHash;
  }

  /**
   * Crea un token JWT firmado con HMAC-SHA256 para el usuario.
   */
  public static async createJWT(payload: Record<string, any>, secretInput?: string, expiresInSeconds = 7 * 86400): Promise<string> {
    const secret = secretInput || this.DEFAULT_JWT_SECRET;
    const encoder = new TextEncoder();

    const header = { alg: 'HS256', typ: 'JWT' };
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const fullPayload = { ...payload, exp };

    const base64UrlHeader = this.base64UrlEncode(encoder.encode(JSON.stringify(header)));
    const base64UrlPayload = this.base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));

    const unsignedToken = `${base64UrlHeader}.${base64UrlPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(unsignedToken));
    const base64UrlSignature = this.base64UrlEncode(new Uint8Array(signature));

    return `${unsignedToken}.${base64UrlSignature}`;
  }

  /**
   * Verifica un token JWT y devuelve su payload si es válido y no ha expirado.
   */
  public static async verifyJWT(token: string, secretInput?: string): Promise<Record<string, any> | null> {
    try {
      if (!token) return null;
      const secret = secretInput || this.DEFAULT_JWT_SECRET;
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signatureB64] = parts;
      const unsignedToken = `${headerB64}.${payloadB64}`;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );

      const signature = this.base64UrlDecode(signatureB64);
      const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(unsignedToken));

      if (!isValid) return null;

      const payloadJson = new TextDecoder().decode(this.base64UrlDecode(payloadB64));
      const payload = JSON.parse(payloadJson);

      if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
        return null; // Expirado
      }

      return payload;
    } catch (e) {
      return null;
    }
  }

  /**
   * Decodifica un Google Credential ID Token (JWT).
   */
  public static parseGoogleToken(idToken: string): { email?: string; name?: string; sub?: string; email_verified?: boolean } | null {
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) return null;
      const payloadJson = new TextDecoder().decode(this.base64UrlDecode(parts[1]));
      return JSON.parse(payloadJson);
    } catch (e) {
      return null;
    }
  }

  private static base64UrlEncode(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private static base64UrlDecode(str: string): Uint8Array {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
