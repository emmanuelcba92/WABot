import { Env } from '../types';
import { FirestoreService } from './firestoreService';
import { D1Service } from './d1Service';

export type DBProviderType = 'd1' | 'local' | 'firebase';

export class DBFactory {
  // Configuración global por defecto: 100% Cloudflare (5M lecturas/día gratis)
  private static globalProvider: DBProviderType = 'd1';

  public static setProvider(provider: DBProviderType) {
    this.globalProvider = provider;
  }

  public static getProvider(env?: Env): DBProviderType {
    return this.globalProvider;
  }

  public static createService(env?: Env): any {
    const provider = this.getProvider(env);

    if (provider === 'firebase') {
      return new FirestoreService(env);
    }

    // Por defecto usa Cloudflare D1 / Cloudflare Engine
    return new D1Service(env);
  }
}
