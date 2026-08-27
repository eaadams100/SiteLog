/**
 * components/LogsTable.jsx
 *
 * The main data table: sortable columns, client-side pagination (10/25/50
 * per page), per-issue flag toggling inline, and a "View Details" action.
 *
 * Client-side sorting/pagination over the full filtered log set (fetched
 * once via getLogs with a generous limit — see services/api.js) rather
 * than server-side paged requests. This keeps the stats cards (computed
 * from the same full set in App.jsx) and the table's own pagination
 * controls from having to stay in sync across separate network requests
 * — reasonable for the data volumes a single project's date-range filter
 * will realistically produce.
 */

import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';
import { FaSun, FaCloud, FaCloudRain, FaBolt, FaSnowflake, FaWind, FaChevronUp, FaChevronDown } from 'react-icons/fa';
import IssueFlag from './IssueFlag';

const WEATHER_ICONS = {
  sunny: FaSun,
  cloudy: FaCloud,
  rain: FaCloudRain,
  storm: FaBolt,
  snow: FaSnowflake,
  windy: FaWind,
};

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatWorkers(workers) {
  if (!Array.isArray(workers) || workers.length === 0) return '—';
  return workers.map((w) => `${w.count} ${w.trade}`).join(', ');
}

function formatMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) return '—';
  return materials.map((m) => `${m.quantity} ${m.unit} ${m.name}`).join(', ');
}

function totalWorkerCount(workers) {
  if (!Array.isArray(workers)) return 0;
  return workers.reduce((sum, w) => sum + (Number(w.count) || 0), 0);
}

function flaggedIssueCount(issues) {
  if (!Array.isArray(issues)) return 0;
  return issues.filter((i) => i.flagged).length;
}

export default function LogsTable({ logs, onViewDetails, onToggleFlag, canFlag = true }) {
  const [sorting, setSorting] = useState([{ id: 'log_date', desc: true }]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  const columns = useMemo(
    () => [
      {
        id: 'log_date',
        header: 'Date',
        accessorKey: 'log_date',
        cell: (info) => formatDate(info.getValue()),
        sortingFn: 'text', // ISO date strings sort correctly as text
      },
      {
        id: 'weather',
        header: 'Weather',
        accessorFn: (log) => log.weather?.condition || '',
        cell: (info) => {
          const weather = info.row.original.weather;
          const condition = weather?.condition;
          const Icon = condition ? WEATHER_ICONS[condition.toLowerCase()] : null;
          return (
            <span className="weather-cell">
              {Icon && <Icon className="weather-cell__icon" aria-hidden="true" />}
              {condition || '—'}
              {weather?.temp != null ? ` · ${weather.temp}°` : ''}
            </span>
          );
        },
      },
      {
        id: 'workers',
        header: 'Workers',
        accessorFn: (log) => totalWorkerCount(log.workers),
        cell: (info) => formatWorkers(info.row.original.workers),
      },
      {
        id: 'materials',
        header: 'Materials',
        accessorFn: (log) => (Array.isArray(log.materials) ? log.materials.length : 0),
        cell: (info) => formatMaterials(info.row.original.materials),
        enableSorting: false,
      },
      {
        id: 'issues',
        header: 'Issues',
        accessorFn: (log) => flaggedIssueCount(log.issues),
        cell: (info) => {
          const log = info.row.original;
          const issues = Array.isArray(log.issues) ? log.issues : [];
          const flaggedCount = flaggedIssueCount(issues);

          if (issues.length === 0) {
            return <span className="issues-cell issues-cell--none">✅ None</span>;
          }

          return (
            <div className="issues-cell">
              <span className={`issues-cell__badge ${flaggedCount > 0 ? 'issues-cell__badge--flagged' : ''}`}>
                {flaggedCount > 0 ? `⚠️ ${flaggedCount} flagged` : `${issues.length} issue${issues.length === 1 ? '' : 's'}`}
              </span>
              {issues.map((issue, index) => (
                <IssueFlag
                  key={index}
                  issue={issue}
                  onToggle={(flagged) => onToggleFlag(log.log_id, index, flagged)}
                  disabled={!canFlag}
                />
              ))}
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: (info) => (
          <button
            type="button"
            className="button button--small"
            onClick={() => onViewDetails(info.row.original.log_id)}
          >
            View Details
          </button>
        ),
        enableSorting: false,
      },
    ],
    [onViewDetails, onToggleFlag, canFlag]
  );

  const table = useReactTable({
    data: logs,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if (logs.length === 0) {
    return (
      <div className="empty-state">
        <p>No logs for this project and date range.</p>
      </div>
    );
  }

  return (
    <div className="logs-table-wrapper">
      <table className="logs-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDirection = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    className={canSort ? 'logs-table__sortable' : ''}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {canSort && (
                      <span className="logs-table__sort-icon">
                        {sortDirection === 'asc' && <FaChevronUp />}
                        {sortDirection === 'desc' && <FaChevronDown />}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="logs-table__pagination">
        <div className="logs-table__page-size">
          <label htmlFor="page-size">Rows per page:</label>
          <select
            id="page-size"
            value={pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="logs-table__page-controls">
          <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </button>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </span>
          <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}