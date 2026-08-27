/**
 * components/LogDetailModal.jsx
 *
 * NOT explicitly named in the Phase 6 file list, but necessary: "View
 * Details button to see full log with photos" (item 6) requires
 * somewhere to actually show that detail, and photos only ever come back
 * from GET /api/v1/logs/:id (the list endpoint never includes them — see
 * services/api.js). This is that somewhere: a simple modal overlay
 * showing the full log — weather, workers, materials, flaggable issues,
 * notes, and a photo grid — fetched on demand when "View Details" is
 * clicked.
 */

import IssueFlag from './IssueFlag';
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function LogDetailModal({ log, loading, error, onClose, onToggleFlag, onRetry, canFlag = true }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{log ? formatDate(log.log_date) : 'Log Detail'}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__body">
          {loading && <LoadingSpinner label="Loading log details…" />}
          {error && <ErrorDisplay message={error} onRetry={onRetry} />}

          {log && !loading && !error && (
            <>
              <p className="modal__supervisor">Supervisor: {log.supervisor_name}</p>

              {log.conflict_resolved && (
                <p className="modal__conflict-note">
                  This log's data was automatically merged from {log.merged_from_logs?.length ?? 0} conflicting
                  submission(s) for this date.
                </p>
              )}

              <section className="modal__section">
                <h3>Weather</h3>
                <p>
                  {log.weather?.condition ?? '—'}
                  {log.weather?.temp != null ? `, ${log.weather.temp}°` : ''}
                </p>
              </section>

              <section className="modal__section">
                <h3>Workers ({log.workers?.length ?? 0})</h3>
                {(log.workers ?? []).map((w, i) => (
                  <p key={i}>
                    {w.trade}: {w.count}
                  </p>
                ))}
              </section>

              <section className="modal__section">
                <h3>Materials ({log.materials?.length ?? 0})</h3>
                {(log.materials ?? []).map((m, i) => (
                  <p key={i}>
                    {m.name}: {m.quantity} {m.unit}
                  </p>
                ))}
              </section>

              <section className="modal__section">
                <h3>Issues ({log.issues?.length ?? 0})</h3>
                {(log.issues ?? []).length === 0 && <p>None reported.</p>}
                {(log.issues ?? []).map((issue, index) => (
                  <IssueFlag
                    key={index}
                    issue={issue}
                    onToggle={(flagged) => onToggleFlag(log.log_id, index, flagged)}
                    disabled={!canFlag}
                  />
                ))}
              </section>

              {log.notes && (
                <section className="modal__section">
                  <h3>Notes</h3>
                  <p>{log.notes}</p>
                </section>
              )}

              <section className="modal__section">
                <h3>Photos ({log.photos?.length ?? 0})</h3>
                {(log.photos ?? []).length === 0 ? (
                  <p>No photos attached.</p>
                ) : (
                  <div className="modal__photo-grid">
                    {log.photos.map((photo) => (
                      <img key={photo.photo_id} src={photo.file_path} alt="" className="modal__photo" />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}