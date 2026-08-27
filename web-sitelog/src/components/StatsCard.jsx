/**
 * components/StatsCard.jsx
 *
 * Single summary statistic card. App.jsx computes the four values (total
 * logs, total workers, flagged issues, unique days) from the currently
 * filtered log set and renders four of these in a row — no separate
 * "stats row" component was needed for that.
 */

export default function StatsCard({ label, value, icon: Icon }) {
  return (
    <div className="stats-card">
      {Icon && (
        <div className="stats-card__icon" aria-hidden="true">
          <Icon />
        </div>
      )}
      <div className="stats-card__value">{value}</div>
      <div className="stats-card__label">{label}</div>
    </div>
  );
}