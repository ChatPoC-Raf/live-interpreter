// Feed segmentow na zywo: partial -> final -> tlumaczenie, flagi, latencja.
import type { ReactElement } from 'react';
import type { SegmentView } from '../../core/segment';

const STATUS_LABEL: Record<SegmentView['status'], string> = {
  recording: 'nagrywam',
  committing: 'domykam',
  translating: 'tlumacze',
  playing: 'odtwarzam',
  done: 'gotowy',
  failed: 'awaria',
};

export function SegmentFeed({ segments }: { segments: SegmentView[] }): ReactElement {
  if (segments.length === 0) {
    return <div className="hint">Brak segmentow — sesja jeszcze nie wystartowala albo mowca nie zaczal mowic.</div>;
  }
  return (
    <div className="segment-feed">
      {segments.map((s) => (
        <div key={s.no} className={`segment-card ${s.status === 'failed' ? 'failed' : ''}`}>
          <div className="seg-head">
            <b>#{s.no}</b>
            <span className="seg-status">{STATUS_LABEL[s.status]}</span>
            {s.sourceLang && <span className="seg-status">{s.sourceLang}</span>}
            {s.flags.map((f) => (
              <span key={f} className="seg-flag">
                {f}
              </span>
            ))}
            {s.latencyMs !== null && (
              <span className={`latency-chip ${s.latencyMs > 2000 ? 'over' : ''}`}>
                {(s.latencyMs / 1000).toFixed(2)} s
              </span>
            )}
          </div>
          <div className="seg-original">{s.originalText || s.partialText || '…'}</div>
          {s.translatedText && <div className="seg-translated">{s.translatedText}</div>}
        </div>
      ))}
    </div>
  );
}
