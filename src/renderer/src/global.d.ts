import type { LiveApi } from '../../shared/ipc';

declare global {
  interface Window {
    live: LiveApi;
  }
}

export {};
