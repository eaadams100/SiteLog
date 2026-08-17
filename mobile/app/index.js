/**
 * app/index.js
 *
 * Route: "/" (home screen). Router equivalent of the old LogsListScreen.js.
 *
 * Phase 4 adds the sync status bar (SyncButton, which is self-contained
 * and handles its own state) above the list, and emoji on each log
 * card's sync badge.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import databaseManager from '../db/DatabaseManager';
import { formatDate } from '../utils/helpers';
import SyncButton from '../components/SyncButton';

const SYNC_STATUS_STYLES = {
  pending: { backgroundColor: '#FEF3C7', color: '#92400E', label: 'Pending' },
  synced: { backgroundColor: '#D1FAE5', color: '#065F46', label: 'Synced' },
  failed: { backgroundColor: '#FEE2E2', color: '#991B1B', label: 'Failed' },
};

function SyncBadge({ status }) {
  const style = SYNC_STATUS_STYLES[status] ?? SYNC_STATUS_STYLES.pending;
  return (
    <View style={[styles.badge, { backgroundColor: style.backgroundColor }]}>
      <Text style={[styles.badgeText, { color: style.color }]}>
        {style.label}
      </Text>
    </View>
  );
}

function LogCard({ log, onPress }) {
  const workerCount = Array.isArray(log.workers)
    ? log.workers.reduce((sum, w) => sum + (Number(w.count) || 0), 0)
    : 0;
  const issuesCount = Array.isArray(log.issues) ? log.issues.length : 0;
  const flaggedCount = Array.isArray(log.issues)
    ? log.issues.filter((iss) => iss.flagged).length
    : 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardDate}>{formatDate(log.log_date)}</Text>
        <SyncBadge status={log.sync_status} />
      </View>

      <Text style={styles.cardSupervisor}>{log.supervisor_name}</Text>

      <View style={styles.cardStatsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Weather</Text>
          <Text style={styles.statValue}>
            {log.weather?.condition ?? '—'}
            {log.weather?.temp != null ? ` · ${log.weather.temp}°` : ''}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Workers</Text>
          <Text style={styles.statValue}>{workerCount}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Issues</Text>
          <Text
            style={[
              styles.statValue,
              flaggedCount > 0 && styles.statValueAlert,
            ]}
          >
            {issuesCount}
            {flaggedCount > 0 ? ` (${flaggedCount} flagged)` : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function LogsListScreen() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadLogs = useCallback(async () => {
    try {
      const allLogs = await databaseManager.getAllLogs();
      setLogs(allLogs);
      setError(null);
    } catch (err) {
      console.error('Failed to load logs:', err);
      setError('Could not load logs. Pull down to try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload every time this route comes into focus (e.g. after saving a new
  // log and navigating back). useFocusEffect works the same under Expo
  // Router since Router is built on top of React Navigation.
  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [loadLogs])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadLogs();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#1D4ED8" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <SyncButton />
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          logs.length === 0 ? styles.emptyListContent : styles.listContent
        }
        renderItem={({ item }) => (
          <LogCard
            log={item}
            onPress={() => router.push(`/log-detail/${item.id}`)}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No logs yet</Text>
            <Text style={styles.emptyStateSubtitle}>
              {error ?? 'Tap the + button to create your first daily log.'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/log-entry')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F3F4F6' },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  listContent: { padding: 16, paddingBottom: 100 },
  emptyListContent: { flexGrow: 1, padding: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardDate: { fontSize: 17, fontWeight: '700', color: '#111827' },
  cardSupervisor: { fontSize: 15, color: '#4B5563', marginBottom: 12 },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  cardStatsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { flex: 1 },
  statLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statValue: { fontSize: 15, fontWeight: '600', color: '#111827' },
  statValueAlert: { color: '#DC2626' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1D4ED8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  fabIcon: { fontSize: 32, color: '#FFFFFF', lineHeight: 34, fontWeight: '400' },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
