/**
 * hooks/useSyncStatus.js
 *
 * React hook bridging SyncService's plain-JS pub/sub into component
 * state, plus a locally-tracked pending-logs count (SyncService doesn't
 * track that itself — it only knows about a sync run once one starts).
 * Any component can call this hook to render sync status/progress and
 * trigger a manual sync, without prop-drilling through the screen tree.
 */

import { useCallback, useEffect, useState } from 'react';
import syncService from '../services/SyncService';
import databaseManager from '../db/DatabaseManager';

/**
 * @returns {{
 *   status: 'idle' | 'syncing' | 'success' | 'error',
 *   progress: { current: number, total: number },
 *   lastResult: { synced: number, conflicts: number, failed: number, error?: string } | null,
 *   lastSyncedAt: string | null,
 *   pendingCount: number,
 *   syncNow: () => Promise<void>,
 *   refreshPendingCount: () => Promise<void>,
 * }}
 */
export function useSyncStatus() {
  const [syncState, setSyncState] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await databaseManager.getPendingLogs();
      setPendingCount(pending.length);
    } catch (err) {
      console.warn('useSyncStatus: failed to refresh pending count:', err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = syncService.subscribe(setSyncState);
    refreshPendingCount();
    return unsubscribe;
  }, [refreshPendingCount]);

  // Re-check the pending count whenever a sync run settles, so the badge
  // reflects reality immediately rather than only on the next screen focus.
  useEffect(() => {
    if (syncState && syncState.status !== 'syncing') {
      refreshPendingCount();
    }
  }, [syncState?.status, refreshPendingCount]);

  const syncNow = useCallback(async () => {
    await syncService.syncNow();
  }, []);

  return {
    status: syncState?.status ?? 'idle',
    progress: syncState?.progress ?? { current: 0, total: 0 },
    lastResult: syncState?.lastResult ?? null,
    lastSyncedAt: syncState?.lastSyncedAt ?? null,
    pendingCount,
    syncNow,
    refreshPendingCount,
  };
}
