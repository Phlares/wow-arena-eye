import { useState } from 'react';
import type { MatchDetail } from '../api.js';
import { Timeline } from './Timeline.js';
import { WindowPanel } from './WindowPanel.js';
import { ComparePanel } from './ComparePanel.js';

export function DetailView({ detail, error, matchId, onClose }: { detail: MatchDetail | null; error: string | null; matchId: string; onClose: () => void }) {
  const [selectedWindow, setSelectedWindow] = useState<number | null>(null);
  const win = detail && selectedWindow !== null ? detail.metrics.offensiveWindows[selectedWindow] : undefined;
  return (
    <div className="detail-overlay">
      <div className="detail-head">
        <span>Match detail</span>
        <button aria-label="Close detail" onClick={onClose}>✕</button>
      </div>
      {error === 'no-detail' && (
        <div className="detail-empty">No detail stored for this match — re-ingest to view it (<code>npm run ingest-db</code>).</div>
      )}
      {error && error !== 'no-detail' && <div className="detail-empty">Failed to load detail: {error}</div>}
      {!error && !detail && <div className="detail-empty">Loading…</div>}
      {detail && (
        <div className="detail-body">
          <Timeline detail={detail} onSelectWindow={setSelectedWindow} />
          {win && selectedWindow !== null && <WindowPanel window={win} index={selectedWindow} />}
          <ComparePanel matchId={matchId} />
        </div>
      )}
    </div>
  );
}
