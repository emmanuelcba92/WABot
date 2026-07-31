import { Env } from '../types';
import { FirestoreService } from './firestoreService';
import { D1Service } from './d1Service';

export type DBProviderType = 'd1' | 'local' | 'firebase';

export class DBFactory {
  private static activeProvider: DBProviderType = 'd1';

  public static setProvider(provider: DBProviderType) {
    this.activeProvider = provider;
  }

  public static getProvider(env?: Env, headerProvider?: string): DBProviderType {
    if (headerProvider && ['d1', 'local', 'firebase'].includes(headerProvider.toLowerCase())) {
      this.activeProvider = headerProvider.toLowerCase() as DBProviderType;
      return this.activeProvider;
    }
    return this.activeProvider || 'd1';
  }

  public static createService(env?: Env, headerProvider?: string): any {
    const provider = this.getProvider(env, headerProvider);

    if (provider === 'd1' && env?.DB) {
      return new D1Service(env);
    }

    if (provider === 'firebase' || !env?.DB) {
      return new FirestoreService(env);
    }

    return env?.DB ? new D1Service(env) : new FirestoreService(env);
  }
}
