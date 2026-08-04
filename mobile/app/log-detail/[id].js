/**
 * app/log-detail/[id].js
 *
 * Route: "/log-detail/:id". Read-only detail view for a single log.
 *
 * Phase 2 adds a photo grid pulled from the `photos` table (via
 * getPhotosForLog), a photo count in the section header, and a
 * full-screen tap-to-view modal — the same pattern used in log-entry.js,
 * minus the delete/capture actions, since this screen is read-only.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import databaseManager from '../../db/DatabaseManager';
import { formatDate, formatTimestamp } from '../../utils/helpers';

export default function LogDetailScreen() {
  const { id: logId } = useLocalSearchParams();
  const [log, setLog] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalPhoto, setModalPhoto] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const loadLogAndPhotos = useCallback(async () => {
    if (!logId) {
      setLoading(false);
      setError('No log specified.');
      return;
    }
    try {
      const [logResult, photosResult] = await Promise.all([
        databaseManager.getLogById(logId),
        databaseManager.getPhotosForLog(logId),
      ]);
      setLog(logResult);
      setPhotos(photosResult);
      if (!logResult) setError('Log not found.');
      else setError(null);
    } catch (err) {
      console.error('Failed to load log detail:', err);
      setError('Could not load this log.');
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    loadLogAndPhotos();
  }, [loadLogAndPhotos]);

  // Refresh photos/log whenever this screen regains focus, in case photos
  // were added or removed elsewhere (or the log was edited).
  useFocusEffect(
    useCallback(() => {
      loadLogAndPhotos();
    }, [loadLogAndPhotos])
  );

  const viewPhoto = (photo) => {
    setModalPhoto(photo);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setModalPhoto(null);
  };

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

        {/* Photos (Phase 2) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos ({photos.length})</Text>
          {photos.length === 0 ? (
            <Text style={styles.sectionText}>No photos attached.</Text>
          ) : (
            <View style={styles.photoGrid}>
              {photos.map((photo) => (
                <TouchableOpacity
                  key={photo.id}
                  style={styles.photoThumbWrapper}
                  onPress={() => viewPhoto(photo)}
                >
                  <Image
                    source={{ uri: photo.file_path }}
                    style={styles.photoThumb}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
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

      {/* Full-screen photo viewer */}
      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent={false}
        onRequestClose={closeModal}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          {modalPhoto && (
            <Image
              source={{ uri: modalPhoto.file_path }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </SafeAreaView>
      </Modal>
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

  // --- Phase 2: photo styles ---
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  photoThumbWrapper: {
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  photoThumb: { width: '100%', height: '100%' },

  modalContainer: { flex: 1, backgroundColor: '#000000' },
  modalHeader: { paddingHorizontal: 16, paddingVertical: 12 },
  modalCloseButton: { alignSelf: 'flex-start', padding: 8 },
  modalCloseText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  modalImage: { flex: 1, width: '100%' },
});
