/**
 * app/login.js
 *
 * Route: "/login". Combined login/register screen — a separate register
 * screen felt like more navigation than this needs, so a toggle switches
 * between the two modes on one screen. Once authenticated, app/_layout.js
 * automatically stops rendering this route and shows the main app
 * instead — this screen doesn't navigate away on success itself.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';

const ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'pm', label: 'Project Manager' },
];

export default function LoginScreen() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('supervisor');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('Name is required.');
      return;
    }

    setSubmitting(true);
    const result =
      mode === 'login'
        ? await login(email.trim(), password)
        : await register(email.trim(), password, name.trim(), role);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || 'Something went wrong. Please try again.');
    }
    // On success, app/_layout.js's auth gate takes over — nothing else to do here.
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>SiteLog</Text>
          <Text style={styles.subtitle}>
            {mode === 'login' ? 'Log in to sync your daily logs' : 'Create an account'}
          </Text>

          <View style={styles.form}>
            {mode === 'register' && (
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. John Mensah"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
                placeholderTextColor="#9CA3AF"
                secureTextEntry
              />
            </View>

            {mode === 'register' && (
              <View style={styles.field}>
                <Text style={styles.label}>Role</Text>
                <View style={styles.chipRow}>
                  {ROLES.map((r) => (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.chip, role === r.value && styles.chipSelected]}
                      onPress={() => setRole(r.value)}
                    >
                      <Text style={[styles.chipText, role === r.value && styles.chipTextSelected]}>
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitButtonText}>{mode === 'login' ? 'Log In' : 'Create Account'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toggleModeButton}
              onPress={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
            >
              <Text style={styles.toggleModeText}>
                {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Log in'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '800', color: '#1D4ED8', textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginTop: 6, marginBottom: 32 },
  form: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 20 },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#111827',
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  chipSelected: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  chipText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  chipTextSelected: { color: '#FFFFFF' },
  error: { color: '#DC2626', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  submitButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  toggleModeButton: { marginTop: 16, alignItems: 'center' },
  toggleModeText: { color: '#1D4ED8', fontSize: 14 },
});
