/**
 * components/SyncButton.js
 *
 * Self-contained sync status bar + "Sync Now" button. Drop this into any
 * screen (currently just app/index.js) and it handles its own state via
 * useSyncStatus()/useNetworkStatus() — no props required, no need for the
 * parent screen to wire anything up.
 */

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { formatRelativeTime } from '../utils/helpers';

function buildResultMessage(result) {
  if (!result) return '';
  if (result.error) return result.error;

  const parts = [];
  if (result.synced > 0) parts.push(`${result.synced} log${result.synced === 1 ? '' : 's'} synced`);
  if (result.conflicts > 0) parts.push(`${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'} (flagged for review)`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);

  if (parts.length === 0) return 'Nothing to sync — you\'re all caught up.';
  return parts.join(', ') + '.';
}

export default function SyncButton() {
  const { status, progress, lastResult, lastSyncedAt, pendingCount, syncNow } = useSyncStatus();
  const { isConnected, isInternetReachable } = useNetworkStatus();

  const isOnline = isConnected && isInternetReachable;
  const isSyncing = status === 'syncing';
  const canSync = isOnline && !isSyncing;

  const handlePress = useCallback(async () => {
    if (!isOnline) {
      Alert.alert(
        'No connection',
        'You\'re offline right now. Your logs are saved locally and will sync automatically once you\'re back online.'
      );
      return;
    }

    await syncNow();
  }, [isOnline, syncNow]);

  // Fire the result alert as a side effect of status settling, so it shows
  // up whether the sync was triggered by this button or an automatic
  // trigger (reconnect, foreground, interval) elsewhere in the app.
  const lastResultRef = React.useRef(null);
  React.useEffect(() => {
    if (status !== 'syncing' && lastResult && lastResult !== lastResultRef.current) {
      lastResultRef.current = lastResult;
      if (lastResult.synced > 0 || lastResult.conflicts > 0 || lastResult.failed > 0 || lastResult.error) {
        Alert.alert(status === 'error' ? 'Sync finished with issues' : 'Sync complete', buildResultMessage(lastResult));
      }
    }
  }, [status, lastResult]);

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={styles.statusTextGroup}>
          <Text style={styles.statusLine}>
            {isSyncing
              ? `Syncing… ${progress.total > 0 ? `${progress.current}/${progress.total}` : ''}`
              : !isOnline
              ? 'Offline'
              : pendingCount > 0
              ? `${pendingCount} log${pendingCount === 1 ? '' : 's'} pending`
              : 'All synced'}
          </Text>
          {!!lastSyncedAt && !isSyncing && (
            <Text style={styles.lastSyncedLine}>Last synced {formatRelativeTime(lastSyncedAt)}</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, !canSync && styles.buttonDisabled]}
          onPress={handlePress}
          disabled={!canSync}
          activeOpacity={0.8}
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Sync Now</Text>
          )}
        </TouchableOpacity>
      </View>

      {isSyncing && progress.total > 0 && (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round((progress.current / progress.total) * 100)}%` },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusTextGroup: { flex: 1, marginRight: 12 },
  statusLine: { fontSize: 15, fontWeight: '600', color: '#111827' },
  lastSyncedLine: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  button: {
    backgroundColor: '#1D4ED8',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: '#9CA3AF' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  progressTrack: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1D4ED8',
  },
});
