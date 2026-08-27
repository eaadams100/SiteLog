/**
 * components/ErrorDisplay.jsx
 *
 * User-friendly error box with a retry button. Never renders raw
 * JSON/stack traces — `message` is expected to already be a readable
 * string (services/api.js's normalizeError() guarantees that for
 * anything coming from the API layer).
 */

export default function ErrorDisplay({ message, onRetry }) {
  return (
    <div className="error-display" role="alert">
      <p className="error-display__message">{message || 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}