import type { MatchDetail } from '../api.js';
import { Timeline } from './Timeline.js';

export function DetailView({ detail, error, onClose }: { detail: MatchDetail | null; error: string | null; onClose: () => void }) {
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
          <Timeline detail={detail} onSelectWindow={() => { /* window panel wired in Task 10 */ }} />
        </div>
      )}
    </div>
  );
}
