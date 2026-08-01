import { Env } from '../types';
import { D1Service } from './d1Service';

export type DBProviderType = 'd1' | 'local' | 'firebase';

export class DBFactory {
  private static globalProvider: DBProviderType = 'd1';

  public static setProvider(provider: DBProviderType) {
    this.globalProvider = 'd1';
  }

  public static getProvider(env?: Env): DBProviderType {
    return 'd1';
  }

  public static createService(env?: Env): any {
    return new D1Service(env);
  }
}
