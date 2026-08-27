/**
 * components/LoadingSpinner.jsx
 *
 * Simple centered spinner, used both as a full-page loading state and
 * inline (e.g. inside the table area while logs are refetching).
 */

export default function LoadingSpinner({ label = 'Loading…' }) {
  return (
    <div className="loading-spinner">
      <div className="loading-spinner__circle" aria-hidden="true" />
      <p className="loading-spinner__label">{label}</p>
    </div>
  );
}