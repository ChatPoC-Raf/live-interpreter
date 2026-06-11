// Hook React na snapshot kontrolera sesji (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import { sessionController } from './sessionController';
import type { SessionSnapshot } from './sessionTypes';

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(sessionController.subscribe, sessionController.getSnapshot);
}

export { sessionController };
