import { Env } from '../types';
import { FirestoreService } from './firestoreService';
import { D1Service } from './d1Service';

export type DBProviderType = 'd1' | 'local' | 'firebase';

export class DBFactory {
  // Configuración global del servidor para todas las PCs de la clínica
  private static globalProvider: DBProviderType = 'firebase';

  public static setProvider(provider: DBProviderType) {
    this.globalProvider = provider;
  }

  public static getProvider(env?: Env): DBProviderType {
    if (env?.DB_PROVIDER && ['d1', 'local', 'firebase'].includes(env.DB_PROVIDER.toLowerCase())) {
      return (env.DB_PROVIDER.toLowerCase() as DBProviderType) || this.globalProvider;
    }
    return this.globalProvider;
  }

  public static createService(env?: Env): any {
    const provider = this.getProvider(env);

    if (provider === 'd1' && env?.DB) {
      return new D1Service(env);
    }

    if (provider === 'firebase' || !env?.DB) {
      return new FirestoreService(env);
    }

    return env?.DB ? new D1Service(env) : new FirestoreService(env);
  }
}
