import { EventEmitter } from 'node:events';

export const GUIDE_TOOLBAR_REVISION_EVENT = 'guide-toolbar-config-revision';

const revisions = new EventEmitter();
let currentRevision = 0;

export function publishGuideToolbarRevision(): number {
  currentRevision += 1;
  revisions.emit(GUIDE_TOOLBAR_REVISION_EVENT, currentRevision);
  return currentRevision;
}

export function subscribeGuideToolbarRevision(listener: (revision: number) => void): () => void {
  revisions.on(GUIDE_TOOLBAR_REVISION_EVENT, listener);
  return () => revisions.off(GUIDE_TOOLBAR_REVISION_EVENT, listener);
}

export function getGuideToolbarRevision(): number {
  return currentRevision;
}

export function resetGuideToolbarRevisionForTest(): void {
  currentRevision = 0;
  revisions.removeAllListeners();
}
