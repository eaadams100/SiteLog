/**
 * components/DateRangePicker.jsx
 *
 * Date range filter with quick presets (Today / This Week / This Month),
 * an Apply button, and a Clear button. Uses native <input type="date">
 * rather than a date-picker library — the spec offered either option
 * ("React DatePicker or native date inputs"), and native inputs need no
 * extra dependency, work consistently across browsers for a simple
 * start/end range, and keep the dashboard's dependency list smaller.
 *
 * Manages its own draft state so typing/picking a date doesn't refetch
 * on every keystroke — only "Apply" (or a preset button, which applies
 * immediately since picking a preset IS the decision) triggers onApply.
 */

import { useState } from 'react';

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function getPresetRange(preset) {
  const today = new Date();
  const end = toISODate(today);

  if (preset === 'today') {
    return { startDate: end, endDate: end };
  }

  if (preset === 'week') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6); // last 7 days inclusive
    return { startDate: toISODate(start), endDate: end };
  }

  if (preset === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: toISODate(start), endDate: end };
  }

  return { startDate: '', endDate: '' };
}

export default function DateRangePicker({ startDate, endDate, onApply, onClear }) {
  const [draftStart, setDraftStart] = useState(startDate || '');
  const [draftEnd, setDraftEnd] = useState(endDate || '');

  const applyPreset = (preset) => {
    const range = getPresetRange(preset);
    setDraftStart(range.startDate);
    setDraftEnd(range.endDate);
    onApply(range);
  };

  const handleApply = () => {
    onApply({ startDate: draftStart, endDate: draftEnd });
  };

  const handleClear = () => {
    setDraftStart('');
    setDraftEnd('');
    onClear();
  };

  return (
    <div className="date-range-picker">
      <div className="field">
        <label htmlFor="start-date" className="field__label">
          Start date
        </label>
        <input
          id="start-date"
          type="date"
          className="field__input"
          value={draftStart}
          onChange={(e) => setDraftStart(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="end-date" className="field__label">
          End date
        </label>
        <input
          id="end-date"
          type="date"
          className="field__input"
          value={draftEnd}
          onChange={(e) => setDraftEnd(e.target.value)}
        />
      </div>

      <div className="date-range-picker__presets">
        <button type="button" className="chip" onClick={() => applyPreset('today')}>
          Today
        </button>
        <button type="button" className="chip" onClick={() => applyPreset('week')}>
          This Week
        </button>
        <button type="button" className="chip" onClick={() => applyPreset('month')}>
          This Month
        </button>
      </div>

      <div className="date-range-picker__actions">
        <button type="button" className="button button--primary" onClick={handleApply}>
          Apply
        </button>
        <button type="button" className="button button--secondary" onClick={handleClear}>
          Clear
        </button>
      </div>
    </div>
  );
}