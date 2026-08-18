/**
 * components/IssueFlag.jsx
 *
 * Renders one issue with a clickable flag toggle. Used both inline in
 * LogsTable's Issues column (compact) and in the log detail modal
 * (slightly more room). Pure/controlled — the actual PUT request and
 * optimistic state update happen in App.jsx (via onToggle), not here,
 * so this component doesn't need to know about loading/error states.
 */

import { FaFlag, FaRegFlag } from 'react-icons/fa';

export default function IssueFlag({ issue, onToggle, disabled = false }) {
  const isFlagged = Boolean(issue.flagged);

  return (
    <div className={`issue-flag ${isFlagged ? 'issue-flag--flagged' : ''}`}>
      <span className="issue-flag__description">{issue.description}</span>
      <button
        type="button"
        className="issue-flag__toggle"
        onClick={() => onToggle(!isFlagged)}
        disabled={disabled}
        title={isFlagged ? 'Unflag this issue' : 'Flag this issue'}
        aria-pressed={isFlagged}
      >
        {isFlagged ? <FaFlag /> : <FaRegFlag />}
      </button>
    </div>
  );
}