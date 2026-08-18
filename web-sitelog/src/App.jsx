/**
 * App.jsx
 *
 * Top-level layout and state owner. Fetches projects once on mount,
 * refetches logs whenever the selected project or date range changes,
 * and owns the log-detail modal + issue-flagging logic so both the table
 * and the modal can share the same handlers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProjects, getLogs, getLogById, flagIssue } from './services/api';
import ProjectSelector from './components/ProjectSelector';
import DateRangePicker from './components/DateRangePicker';
import StatsCard from './components/StatsCard';
import LogsTable from './components/LogsTable';
import LogDetailModal from './components/LogDetailModal';
import ExportPDF from './components/ExportPDF';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorDisplay from './components/ErrorDisplay';
import { FaClipboardList, FaUsers, FaExclamationTriangle, FaCalendarDay } from 'react-icons/fa';
import './App.css';

function computeStats(logs) {
  const totalLogs = logs.length;
  const totalWorkers = logs.reduce(
    (sum, log) => sum + (log.workers ?? []).reduce((s, w) => s + (Number(w.count) || 0), 0),
    0
  );
  const flaggedIssues = logs.reduce(
    (sum, log) => sum + (log.issues ?? []).filter((i) => i.flagged).length,
    0
  );
  const uniqueDays = new Set(logs.map((log) => log.log_date)).size;

  return { totalLogs, totalWorkers, flaggedIssues, uniqueDays };
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const [dateRange, setDateRange] = useState({ startDate: '', endDate: '' });

  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState(null);

  const [selectedLogId, setSelectedLogId] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);

  // --- Load projects once on mount ---
  const loadProjects = useCallback(async () => {
    setProjectsError(null);
    try {
      const result = await getProjects();
      setProjects(result);
      if (result.length > 0 && !selectedProjectId) {
        setSelectedProjectId(result[0].project_id);
      }
    } catch (err) {
      setProjectsError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // --- Load logs whenever project or date range changes ---
  const loadLogs = useCallback(async () => {
    if (!selectedProjectId) {
      setLogs([]);
      return;
    }
    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await getLogs(
        selectedProjectId,
        dateRange.startDate || null,
        dateRange.endDate || null
      );
      setLogs(result);
    } catch (err) {
      setLogsError(err.message);
    } finally {
      setLogsLoading(false);
    }
  }, [selectedProjectId, dateRange]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const stats = useMemo(() => computeStats(logs), [logs]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.project_id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  // --- Issue flagging: applies to both the table's `logs` state and the
  // open modal's `selectedLog`, if it's the same log, so neither view
  // goes stale relative to the other. ---
  const handleToggleFlag = useCallback(
    async (logId, issueIndex, flagged) => {
      try {
        const updatedLog = await flagIssue(logId, issueIndex, flagged);
        setLogs((prev) => prev.map((log) => (log.log_id === logId ? { ...log, issues: updatedLog.issues } : log)));
        setSelectedLog((prev) =>
          prev && prev.log_id === logId ? { ...prev, issues: updatedLog.issues } : prev
        );
      } catch (err) {
        // Simple feedback for now — a toast/snackbar would be a nice
        // upgrade, but wasn't part of the requested component list.
        window.alert(`Could not update flag: ${err.message}`);
      }
    },
    []
  );

  // --- View details modal ---
  const openDetails = useCallback(async (logId) => {
    setSelectedLogId(logId);
    setSelectedLog(null);
    setModalError(null);
    setModalLoading(true);
    try {
      const log = await getLogById(logId);
      setSelectedLog(log);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  }, []);

  const closeDetails = useCallback(() => {
    setSelectedLogId(null);
    setSelectedLog(null);
    setModalError(null);
  }, []);

  const retryDetails = useCallback(() => {
    if (selectedLogId) openDetails(selectedLogId);
  }, [selectedLogId, openDetails]);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-title">
          <h1>SiteLog Dashboard</h1>
          <p>Construction site daily log monitoring &amp; reporting</p>
        </div>
        <div className="app__header-actions">
          <button type="button" className="button button--secondary" onClick={loadLogs} disabled={logsLoading}>
            Refresh
          </button>
          <ExportPDF
            project={selectedProject}
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            logs={logs}
            stats={stats}
            disabled={logsLoading}
          />
        </div>
      </header>

      <main className="app__main">
        {projectsError && <ErrorDisplay message={projectsError} onRetry={loadProjects} />}

        <section className="app__filters">
          <ProjectSelector
            projects={projects}
            selectedProjectId={selectedProjectId}
            onChange={setSelectedProjectId}
          />
          <DateRangePicker
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onApply={setDateRange}
            onClear={() => setDateRange({ startDate: '', endDate: '' })}
          />
        </section>

        <section className="app__stats">
          <StatsCard label="Total Logs" value={stats.totalLogs} icon={FaClipboardList} />
          <StatsCard label="Total Workers" value={stats.totalWorkers} icon={FaUsers} />
          <StatsCard label="Flagged Issues" value={stats.flaggedIssues} icon={FaExclamationTriangle} />
          <StatsCard label="Days Logged" value={stats.uniqueDays} icon={FaCalendarDay} />
        </section>

        <section className="app__table">
          {logsLoading && <LoadingSpinner label="Loading logs…" />}
          {logsError && !logsLoading && <ErrorDisplay message={logsError} onRetry={loadLogs} />}
          {!logsLoading && !logsError && (
            <LogsTable logs={logs} onViewDetails={openDetails} onToggleFlag={handleToggleFlag} />
          )}
        </section>
      </main>

      <footer className="app__footer">
        <p>SiteLog Dashboard — v1.0 (Phase 6)</p>
      </footer>

      {selectedLogId && (
        <LogDetailModal
          log={selectedLog}
          loading={modalLoading}
          error={modalError}
          onClose={closeDetails}
          onToggleFlag={handleToggleFlag}
          onRetry={retryDetails}
        />
      )}
    </div>
  );
}
