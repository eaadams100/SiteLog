/**
 * app/log-entry.js
 *
 * Route: "/log-entry". Daily log creation form.
 *
 * Phase 2 adds photo capture/gallery-picking, a thumbnail grid, and a
 * full-screen photo viewer. Because photos need a log_id to attach to,
 * adding the *first* photo before the user has pressed "Save" triggers an
 * auto-save: a minimally-validated log row is inserted immediately, and
 * `currentLogId` is remembered for the rest of the session. The final
 * "Save Daily Log" button then does an UPDATE against that same row
 * instead of inserting a second one.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Image,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import databaseManager from '../db/DatabaseManager';
import syncService from '../services/SyncService';
import {
  generateUUID,
  getTodayISODate,
  formatDate,
} from '../utils/helpers';

const WEATHER_CONDITIONS = ['Sunny', 'Cloudy', 'Rain', 'Storm', 'Snow', 'Windy'];
// This must be a real UUID matching a row in the backend's `projects`
// table — the backend schema has `daily_logs.project_id UUID NOT NULL
// REFERENCES projects (project_id)`, so a plain string like
// "default-project" would fail every sync with a foreign key violation.
// This value matches the project seeded by `backend/src/db/seed.js` — if
// you change one, change the other, or better yet build a real project
// picker (see backend/README.md's "What's next" section) and stop relying
// on a hardcoded default entirely.
const DEFAULT_PROJECT_ID = '76f663d3-aeff-40f3-b7d6-7c8e0f7e83a0';

const PHOTO_SYNC_STYLES = {
  pending: { backgroundColor: '#FEF3C7', color: '#92400E', label: 'Pending' },
  synced: { backgroundColor: '#D1FAE5', color: '#065F46', label: 'Synced' },
  failed: { backgroundColor: '#FEE2E2', color: '#991B1B', label: 'Failed' },
};

export default function LogEntryScreen() {
  const todayISO = getTodayISODate();

  const [weatherCondition, setWeatherCondition] = useState('Sunny');
  const [weatherTemp, setWeatherTemp] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [workers, setWorkers] = useState([{ trade: '', count: '' }]);
  const [materials, setMaterials] = useState([]);
  const [issues, setIssues] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Phase 2: photo state ---
  const [currentLogId, setCurrentLogId] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [modalPhoto, setModalPhoto] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  // ---------- Workers ----------
  const addWorkerRow = useCallback(() => {
    setWorkers((prev) => [...prev, { trade: '', count: '' }]);
  }, []);

  const updateWorkerRow = useCallback((index, field, value) => {
    setWorkers((prev) =>
      prev.map((w, i) => (i === index ? { ...w, [field]: value } : w))
    );
  }, []);

  const removeWorkerRow = useCallback((index) => {
    setWorkers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---------- Materials ----------
  const addMaterialRow = useCallback(() => {
    setMaterials((prev) => [...prev, { name: '', quantity: '', unit: '' }]);
  }, []);

  const updateMaterialRow = useCallback((index, field, value) => {
    setMaterials((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }, []);

  const removeMaterialRow = useCallback((index) => {
    setMaterials((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---------- Issues ----------
  const addIssueRow = useCallback(() => {
    setIssues((prev) => [...prev, { description: '', flagged: false }]);
  }, []);

  const updateIssueRow = useCallback((index, field, value) => {
    setIssues((prev) =>
      prev.map((iss, i) => (i === index ? { ...iss, [field]: value } : iss))
    );
  }, []);

  const removeIssueRow = useCallback((index) => {
    setIssues((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---------- Shared validation ----------

  /**
   * Full validation, run before the final "Save Daily Log" button commits.
   */
  const validate = () => {
    if (!supervisorName.trim()) {
      Alert.alert('Missing information', 'Supervisor name is required.');
      return false;
    }

    const validWorkers = workers.filter(
      (w) => w.trade.trim() && String(w.count).trim()
    );
    if (validWorkers.length === 0) {
      Alert.alert(
        'Missing information',
        'At least one worker entry (trade + count) is required.'
      );
      return false;
    }

    for (const w of validWorkers) {
      if (isNaN(Number(w.count)) || Number(w.count) < 0) {
        Alert.alert('Invalid worker count', `"${w.count}" is not a valid number for ${w.trade}.`);
        return false;
      }
    }

    if (weatherTemp && isNaN(Number(weatherTemp))) {
      Alert.alert('Invalid temperature', 'Temperature must be a number.');
      return false;
    }

    for (const m of materials) {
      const hasAny = m.name.trim() || String(m.quantity).trim() || m.unit.trim();
      if (hasAny && (!m.name.trim() || !String(m.quantity).trim())) {
        Alert.alert(
          'Incomplete material',
          'Each material row needs at least a name and quantity.'
        );
        return false;
      }
      if (m.quantity && isNaN(Number(m.quantity))) {
        Alert.alert('Invalid quantity', `"${m.quantity}" is not a valid number.`);
        return false;
      }
    }

    return true;
  };

  /**
   * Lighter validation used only to gate the photo auto-save: a photo has
   * to belong to *some* log, so we require just enough to make that log
   * meaningful (supervisor + at least one worker), without forcing the
   * user to fill in materials/issues/notes before they can snap a photo.
   */
  const validateForAutoSave = () => {
    if (!supervisorName.trim()) {
      Alert.alert(
        'Add supervisor name first',
        'Enter the supervisor name before attaching photos, so this log can be saved.'
      );
      return false;
    }
    const validWorkers = workers.filter(
      (w) => w.trade.trim() && String(w.count).trim()
    );
    if (validWorkers.length === 0) {
      Alert.alert(
        'Add a worker first',
        'Enter at least one worker (trade + count) before attaching photos, so this log can be saved.'
      );
      return false;
    }
    return true;
  };

  const buildLogPayload = () => {
    const cleanedWorkers = workers
      .filter((w) => w.trade.trim() && String(w.count).trim())
      .map((w) => ({ trade: w.trade.trim(), count: Number(w.count) }));

    const cleanedMaterials = materials
      .filter((m) => m.name.trim() && String(m.quantity).trim())
      .map((m) => ({
        name: m.name.trim(),
        quantity: Number(m.quantity),
        unit: m.unit.trim(),
      }));

    const cleanedIssues = issues
      .filter((iss) => iss.description.trim())
      .map((iss) => ({
        description: iss.description.trim(),
        flagged: !!iss.flagged,
      }));

    return {
      project_id: DEFAULT_PROJECT_ID,
      log_date: todayISO,
      weather: {
        condition: weatherCondition,
        temp: weatherTemp ? Number(weatherTemp) : null,
      },
      workers: cleanedWorkers,
      materials: cleanedMaterials,
      issues: cleanedIssues,
      notes: notes.trim(),
      supervisor_name: supervisorName.trim(),
    };
  };

  /**
   * Returns the id of a persisted log for this form, auto-saving one first
   * if it hasn't been saved yet. Returns null if auto-save validation
   * fails (an alert has already been shown in that case).
   */
  const ensureLogSaved = async () => {
    if (currentLogId) return currentLogId;

    if (!validateForAutoSave()) return null;

    const inserted = await databaseManager.insertLog({
      id: generateUUID(),
      ...buildLogPayload(),
      sync_status: 'pending',
    });
    setCurrentLogId(inserted.id);
    return inserted.id;
  };

  // ---------- Photos ----------

  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera permission needed',
        'SiteLog needs camera access to take site photos. You can enable this in your device Settings.'
      );
      return false;
    }
    return true;
  };

  const requestGalleryPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo library permission needed',
        'SiteLog needs photo library access to attach existing photos. You can enable this in your device Settings.'
      );
      return false;
    }
    return true;
  };

  const savePhotoToLog = async (uri) => {
    setPhotoLoading(true);
    try {
      const logId = await ensureLogSaved();
      if (!logId) return; // validation alert already shown

      const photo = await databaseManager.savePhoto(uri, logId);
      setPhotos((prev) => [...prev, photo]);
    } catch (err) {
      console.error('Failed to save photo:', err);
      Alert.alert('Photo save failed', 'Something went wrong while saving this photo. Please try again.');
    } finally {
      setPhotoLoading(false);
    }
  };

  const takePhoto = async () => {
    const granted = await requestCameraPermission();
    if (!granted) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        quality: 1,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.length) return;
      await savePhotoToLog(result.assets[0].uri);
    } catch (err) {
      console.error('Camera error:', err);
      Alert.alert('Camera error', 'Could not open the camera. Please try again.');
    }
  };

  const pickPhoto = async () => {
    const granted = await requestGalleryPermission();
    if (!granted) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      await savePhotoToLog(result.assets[0].uri);
    } catch (err) {
      console.error('Gallery error:', err);
      Alert.alert('Gallery error', 'Could not open the photo library. Please try again.');
    }
  };

  const removePhoto = (photoId, filePath) => {
    Alert.alert(
      'Delete photo?',
      'This photo will be permanently removed from this log.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await databaseManager.deletePhoto(photoId, filePath);
              setPhotos((prev) => prev.filter((p) => p.id !== photoId));
            } catch (err) {
              console.error('Failed to delete photo:', err);
              Alert.alert('Delete failed', 'Could not delete this photo. Please try again.');
            }
          },
        },
      ]
    );
  };

  const viewPhoto = (photo) => {
    setModalPhoto(photo);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setModalPhoto(null);
  };

  // ---------- Save ----------
  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = buildLogPayload();

      if (currentLogId) {
        // Already auto-saved when the first photo was added — update the
        // same row instead of inserting a duplicate.
        await databaseManager.updateLog(currentLogId, payload);
      } else {
        await databaseManager.insertLog({
          id: generateUUID(),
          ...payload,
          sync_status: 'pending',
        });
      }

      Alert.alert('Saved', 'Daily log saved successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);

      // Fire-and-forget: check for pending logs and sync if online. Not
      // awaited, since the person shouldn't have to wait for a network
      // round trip just to leave this screen — syncIfNeeded() only
      // actually runs a sync if there's something pending and never
      // throws, so this is safe to leave unhandled.
      syncService.syncIfNeeded();
    } catch (err) {
      console.error('Failed to save log:', err);
      Alert.alert(
        'Save failed',
        'Something went wrong while saving this log. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Date */}
          <View style={styles.section}>
            <Text style={styles.label}>Date</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{formatDate(todayISO)}</Text>
            </View>
          </View>

          {/* Supervisor */}
          <View style={styles.section}>
            <Text style={styles.label}>Supervisor Name *</Text>
            <TextInput
              style={styles.input}
              value={supervisorName}
              onChangeText={setSupervisorName}
              placeholder="e.g. John Mensah"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {/* Weather */}
          <View style={styles.section}>
            <Text style={styles.label}>Weather</Text>
            <View style={styles.chipRow}>
              {WEATHER_CONDITIONS.map((condition) => (
                <TouchableOpacity
                  key={condition}
                  style={[
                    styles.chip,
                    weatherCondition === condition && styles.chipSelected,
                  ]}
                  onPress={() => setWeatherCondition(condition)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      weatherCondition === condition && styles.chipTextSelected,
                    ]}
                  >
                    {condition}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              value={weatherTemp}
              onChangeText={setWeatherTemp}
              placeholder="Temperature (°F or °C)"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
            />
          </View>

          {/* Workers */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.label}>Workers on Site *</Text>
              <TouchableOpacity onPress={addWorkerRow} style={styles.addButton}>
                <Text style={styles.addButtonText}>+ Add Worker</Text>
              </TouchableOpacity>
            </View>
            {workers.map((worker, index) => (
              <View key={index} style={styles.rowCard}>
                <TextInput
                  style={[styles.input, styles.rowInputWide]}
                  value={worker.trade}
                  onChangeText={(v) => updateWorkerRow(index, 'trade', v)}
                  placeholder="Trade (e.g. Mason)"
                  placeholderTextColor="#9CA3AF"
                />
                <TextInput
                  style={[styles.input, styles.rowInputNarrow]}
                  value={String(worker.count)}
                  onChangeText={(v) => updateWorkerRow(index, 'count', v)}
                  placeholder="Count"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                />
                {workers.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeWorkerRow(index)}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeButtonText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          {/* Materials */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.label}>Materials Used</Text>
              <TouchableOpacity onPress={addMaterialRow} style={styles.addButton}>
                <Text style={styles.addButtonText}>+ Add Material</Text>
              </TouchableOpacity>
            </View>
            {materials.map((material, index) => (
              <View key={index} style={styles.rowCard}>
                <TextInput
                  style={[styles.input, styles.rowInputWide]}
                  value={material.name}
                  onChangeText={(v) => updateMaterialRow(index, 'name', v)}
                  placeholder="Material (e.g. Cement)"
                  placeholderTextColor="#9CA3AF"
                />
                <TextInput
                  style={[styles.input, styles.rowInputNarrow]}
                  value={String(material.quantity)}
                  onChangeText={(v) => updateMaterialRow(index, 'quantity', v)}
                  placeholder="Qty"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.rowInputNarrow]}
                  value={material.unit}
                  onChangeText={(v) => updateMaterialRow(index, 'unit', v)}
                  placeholder="Unit"
                  placeholderTextColor="#9CA3AF"
                />
                <TouchableOpacity
                  onPress={() => removeMaterialRow(index)}
                  style={styles.removeButton}
                >
                  <Text style={styles.removeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {materials.length === 0 && (
              <Text style={styles.emptyHint}>No materials added yet.</Text>
            )}
          </View>

          {/* Issues */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.label}>Site Issues</Text>
              <TouchableOpacity onPress={addIssueRow} style={styles.addButton}>
                <Text style={styles.addButtonText}>+ Add Issue</Text>
              </TouchableOpacity>
            </View>
            {issues.map((issue, index) => (
              <View key={index} style={styles.issueCard}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={issue.description}
                  onChangeText={(v) => updateIssueRow(index, 'description', v)}
                  placeholder="Describe the issue"
                  placeholderTextColor="#9CA3AF"
                  multiline
                />
                <View style={styles.issueFooter}>
                  <View style={styles.flagRow}>
                    <Text style={styles.flagLabel}>Flag for follow-up</Text>
                    <Switch
                      value={issue.flagged}
                      onValueChange={(v) => updateIssueRow(index, 'flagged', v)}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => removeIssueRow(index)}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeButtonText}>✕ Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {issues.length === 0 && (
              <Text style={styles.emptyHint}>No issues reported.</Text>
            )}
          </View>

          {/* Photos (Phase 2) */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.label}>
                Photos{photos.length > 0 ? ` (${photos.length})` : ''}
              </Text>
              {photoLoading && <ActivityIndicator size="small" color="#1D4ED8" />}
            </View>

            <View style={styles.photoButtonRow}>
              <TouchableOpacity
                style={styles.photoActionButton}
                onPress={takePhoto}
                disabled={photoLoading}
              >
                <Text style={styles.photoActionButtonText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.photoActionButton}
                onPress={pickPhoto}
                disabled={photoLoading}
              >
                <Text style={styles.photoActionButtonText}>Pick from Gallery</Text>
              </TouchableOpacity>
            </View>

            {photos.length === 0 ? (
              <Text style={styles.emptyHint}>No photos added yet.</Text>
            ) : (
              <View style={styles.photoGrid}>
                {photos.map((photo) => {
                  const badge =
                    PHOTO_SYNC_STYLES[photo.sync_status] ?? PHOTO_SYNC_STYLES.pending;
                  return (
                    <TouchableOpacity
                      key={photo.id}
                      style={styles.photoThumbWrapper}
                      onPress={() => viewPhoto(photo)}
                      onLongPress={() => removePhoto(photo.id, photo.file_path)}
                      delayLongPress={350}
                    >
                      <Image
                        source={{ uri: photo.file_path }}
                        style={styles.photoThumb}
                      />
                      <View
                        style={[
                          styles.photoBadge,
                          { backgroundColor: badge.backgroundColor },
                        ]}
                      >
                        <Text style={[styles.photoBadgeText, { color: badge.color }]}>
                          {badge.label}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={styles.photoHint}>Tap a photo to view · Long press to delete</Text>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes about today's work..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Saving...' : 'Save Daily Log'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

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
            {modalPhoto && (
              <TouchableOpacity
                onPress={() => {
                  closeModal();
                  removePhoto(modalPhoto.id, modalPhoto.file_path);
                }}
                style={styles.modalDeleteButton}
              >
                <Text style={styles.modalDeleteText}>Delete</Text>
              </TouchableOpacity>
            )}
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
  scrollContent: { padding: 16, paddingBottom: 40 },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  readOnlyField: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  readOnlyText: { fontSize: 16, color: '#6B7280' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    minHeight: 48,
  },
  notesInput: { minHeight: 110, paddingTop: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  chipText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  chipTextSelected: { color: '#FFFFFF' },
  addButton: {
    backgroundColor: '#EFF6FF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  addButtonText: { color: '#1D4ED8', fontWeight: '600', fontSize: 14 },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  rowInputWide: { flex: 2 },
  rowInputNarrow: { flex: 1 },
  removeButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
  },
  removeButtonText: { color: '#DC2626', fontWeight: '600', fontSize: 14 },
  issueCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  issueFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flagLabel: { fontSize: 14, color: '#374151' },
  emptyHint: { fontSize: 14, color: '#9CA3AF', fontStyle: 'italic' },
  saveButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  // --- Phase 2: photo styles ---
  photoButtonRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  photoActionButton: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  photoActionButtonText: { color: '#1D4ED8', fontWeight: '600', fontSize: 14 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrapper: {
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E5E7EB',
  },
  photoThumb: { width: '100%', height: '100%' },
  photoBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    borderRadius: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  photoBadgeText: { fontSize: 10, fontWeight: '700' },
  photoHint: { fontSize: 12, color: '#9CA3AF', marginTop: 10 },

  modalContainer: { flex: 1, backgroundColor: '#000000' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalCloseButton: { padding: 8 },
  modalCloseText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  modalDeleteButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  modalDeleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  modalImage: { flex: 1, width: '100%' },
});
