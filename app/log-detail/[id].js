/**
 * app/log-detail/[id].js
 *
 * Route: "/log-detail/:id". Router equivalent of the old LogDetailScreen.js.
 * The only real change is where the id comes from: Router exposes dynamic
 * segments via useLocalSearchParams() instead of a route.params prop.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import databaseManager from '../../db/DatabaseManager';
import { formatDate, formatTimestamp } from '../../utils/helpers';

export default function LogDetailScreen() {
  const { id: logId } = useLocalSearchParams();
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadLog() {
      try {
        const result = await databaseManager.getLogById(logId);
        if (isMounted) {
          setLog(result);
          if (!result) setError('Log not found.');
        }
      } catch (err) {
        console.error('Failed to load log detail:', err);
        if (isMounted) setError('Could not load this log.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    if (logId) {
      loadLog();
    } else {
      setLoading(false);
      setError('No log specified.');
    }

    return () => {
      isMounted = false;
    };
  }, [logId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#1D4ED8" />
      </SafeAreaView>
    );
  }

  if (error || !log) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Log not found.'}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{formatDate(log.log_date)}</Text>
        <Text style={styles.subtitle}>Supervisor: {log.supervisor_name}</Text>
        <Text style={styles.subtitle}>Status: {log.sync_status}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weather</Text>
          <Text style={styles.sectionText}>
            {log.weather?.condition ?? '—'}
            {log.weather?.temp != null ? `, ${log.weather.temp}°` : ''}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Workers ({log.workers.length})</Text>
          {log.workers.length === 0 && <Text style={styles.sectionText}>None recorded.</Text>}
          {log.workers.map((w, i) => (
            <Text key={i} style={styles.sectionText}>
              • {w.trade}: {w.count}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Materials ({log.materials.length})</Text>
          {log.materials.length === 0 && <Text style={styles.sectionText}>None recorded.</Text>}
          {log.materials.map((m, i) => (
            <Text key={i} style={styles.sectionText}>
              • {m.name}: {m.quantity} {m.unit}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Issues ({log.issues.length})</Text>
          {log.issues.length === 0 && <Text style={styles.sectionText}>None reported.</Text>}
          {log.issues.map((iss, i) => (
            <Text key={i} style={styles.sectionText}>
              • {iss.description} {iss.flagged ? '🚩' : ''}
            </Text>
          ))}
        </View>

        {!!log.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.sectionText}>{log.notes}</Text>
          </View>
        )}

        <Text style={styles.meta}>Created: {formatTimestamp(log.created_at)}</Text>
        <Text style={styles.meta}>Updated: {formatTimestamp(log.updated_at)}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F3F4F6' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  errorText: { fontSize: 16, color: '#DC2626' },
  content: { padding: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#4B5563', marginBottom: 2 },
  section: {
    marginTop: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  sectionText: { fontSize: 15, color: '#374151', marginBottom: 2 },
  meta: { fontSize: 12, color: '#9CA3AF', marginTop: 16 },
});
