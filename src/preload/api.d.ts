import type { LocalGoldApi } from './index';

declare global {
  interface Window {
    localgold: LocalGoldApi;
  }
}

export {};
