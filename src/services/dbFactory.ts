import { Env } from '../types';
import { FirestoreService } from './firestoreService';
import { D1Service } from './d1Service';

export type DBProviderType = 'd1' | 'local' | 'firebase';

export class DBFactory {
  private static globalProvider: DBProviderType = 'firebase';

  public static setProvider(provider: DBProviderType) {
    this.globalProvider = provider;
  }

  public static getProvider(env?: Env): DBProviderType {
    return this.globalProvider;
  }

  public static createService(env?: Env): any {
    const provider = this.getProvider(env);

    if (provider === 'd1' && env?.DB) {
      return new D1Service(env);
    }

    return new FirestoreService(env);
  }
}
