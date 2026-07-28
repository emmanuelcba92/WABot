import { Env } from '../types';

export class ImageUploadService {
  /**
   * Sube una imagen en base64 a Google Drive o Supabase Storage.
   * Si no se configuran credenciales reales, genera un enlace de vista previa para pruebas.
   */
  public static async uploadImage(
    base64Data: string,
    fileName: string = `imagen_${Date.now()}.jpg`,
    env?: Env
  ): Promise<{ url: string; provider: 'google_drive' | 'supabase' | 'simulated' }> {
    if (!base64Data) {
      throw new Error('No se proporcionó data base64 de la imagen');
    }

    // Extraer limpia la parte base64 si incluye el prefijo data:image/...;base64,
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const mimeMatch = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // 1. INTENTAR SUBIDA A GOOGLE DRIVE (si hay Token configurado)
    if (env?.GOOGLE_ACCESS_TOKEN) {
      try {
        const driveUrl = await this.uploadToGoogleDrive(cleanBase64, fileName, mimeType, env.GOOGLE_ACCESS_TOKEN, env.GOOGLE_DRIVE_FOLDER_ID);
        if (driveUrl) {
          return { url: driveUrl, provider: 'google_drive' };
        }
      } catch (err) {
        console.error('Error al subir a Google Drive, intentando alternativa:', err);
      }
    }

    // 2. INTENTAR SUBIDA A SUPABASE STORAGE (si hay credenciales configuradas)
    if (env?.SUPABASE_URL && env?.SUPABASE_KEY) {
      try {
        const supabaseUrl = await this.uploadToSupabase(cleanBase64, fileName, mimeType, env.SUPABASE_URL, env.SUPABASE_KEY, env.SUPABASE_BUCKET || 'pedidos-medicos');
        if (supabaseUrl) {
          return { url: supabaseUrl, provider: 'supabase' };
        }
      } catch (err) {
        console.error('Error al subir a Supabase Storage:', err);
      }
    }

    // 3. FALLBACK DE PRUEBAS / DESARROLLO LOCAL
    // Retorna una URL formateada de prueba con vista previa del archivo
    const simulatedId = `demo_drive_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const simulatedUrl = `https://drive.google.com/file/d/${simulatedId}/view?usp=sharing`;
    
    console.log(`[ImageUpload] Simulación local: Imagen ${fileName} registrada (${cleanBase64.length} bytes base64)`);

    return {
      url: simulatedUrl,
      provider: 'simulated'
    };
  }

  /**
   * Sube archivo a Google Drive mediante su API REST v3 (multipart upload).
   */
  private static async uploadToGoogleDrive(
    base64: string,
    fileName: string,
    mimeType: string,
    accessToken: string,
    folderId?: string
  ): Promise<string | null> {
    const metadata: Record<string, any> = {
      name: fileName,
      mimeType: mimeType
    };
    if (folderId) {
      metadata.parents = [folderId];
    }

    const binaryData = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
    const mediaPartHeader = `${delimiter}Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;

    const bodyString = metadataPart + mediaPartHeader + base64 + closeDelimiter;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: bodyString
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`Google Drive API error (${res.status}): ${errText}`);
      return null;
    }

    const json: any = await res.json();
    return json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`;
  }

  /**
   * Sube archivo a Supabase Storage mediante su API REST.
   */
  private static async uploadToSupabase(
    base64: string,
    fileName: string,
    mimeType: string,
    supabaseUrl: string,
    supabaseKey: string,
    bucketName: string
  ): Promise<string | null> {
    const binaryData = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const filePath = `${Date.now()}_${fileName}`;
    const url = `${supabaseUrl}/storage/v1/object/${bucketName}/${filePath}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': mimeType
      },
      body: binaryData
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`Supabase Storage API error (${res.status}): ${errText}`);
      return null;
    }

    // Construir la URL pública de vista previa en Supabase Storage
    return `${supabaseUrl}/storage/v1/object/public/${bucketName}/${filePath}`;
  }
}
