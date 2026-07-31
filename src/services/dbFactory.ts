import { Env } from '../types';
import { FirestoreService } from './firestoreService';
import { D1Service } from './d1Service';

export type DBProviderType = 'd1' | 'local' | 'firebase';

export class DBFactory {
  private static activeProvider: DBProviderType = 'd1';

  public static setProvider(provider: DBProviderType) {
    this.activeProvider = provider;
  }

  public static getProvider(env?: Env): DBProviderType {
    if (env?.DB_PROVIDER && ['d1', 'local', 'firebase'].includes(env.DB_PROVIDER.toLowerCase())) {
      return env.DB_PROVIDER.toLowerCase() as DBProviderType;
    }
    return this.activeProvider;
  }

  public static createService(env?: Env): any {
    const provider = this.getProvider(env);

    if (provider === 'd1' && env?.DB) {
      return new D1Service(env);
    }

    if (provider === 'firebase' || !env?.DB) {
      return new FirestoreService(env);
    }

    // Default fallback to D1Service or FirestoreService
    return env?.DB ? new D1Service(env) : new FirestoreService(env);
  }
}
