/**
 * app/log-entry.js
 *
 * Route: "/log-entry". Router equivalent of the old LogEntryScreen.js.
 * Only the navigation call changed (router.back() instead of
 * navigation.goBack()) — all form logic, validation, and save behavior are
 * identical to the React Navigation version.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import databaseManager from '../db/DatabaseManager';
import {
  generateUUID,
  getTodayISODate,
  formatDate,
} from '../utils/helpers';

const WEATHER_CONDITIONS = ['Sunny', 'Cloudy', 'Rain', 'Storm', 'Snow', 'Windy'];
const DEFAULT_PROJECT_ID = 'default-project';

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

  // ---------- Validation & Save ----------
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

  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    try {
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

      await databaseManager.insertLog({
        id: generateUUID(),
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
        sync_status: 'pending',
      });

      Alert.alert('Saved', 'Daily log saved successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
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
});
