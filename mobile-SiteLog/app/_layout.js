/**
 * app/_layout.js
 *
 * Root layout for the Expo Router app. Initializes the local SQLite
 * database, restores any persisted auth session, wires up the sync
 * engine's automatic triggers, and gates navigation based on auth status:
 * unauthenticated users only ever see /login; authenticated users see
 * everything else and get bounced away from /login if they land on it.
 *
 * Phase 7 adds the auth gating. Implemented as a manual redirect (watch
 * auth status + current route via useSegments, router.replace as needed)
 * rather than expo-router's newer <Stack.Protected> guard component —
 * this pattern works across a wider range of expo-router versions and is
 * easier to reason about without needing to verify that component's
 * exact availability/API for this project's SDK.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';

import databaseManager from '../db/DatabaseManager';
import syncService from '../services/SyncService';
import authService from '../services/AuthService';
import { useAuth } from '../hooks/useAuth';

// How often to auto-sync while the app is open and there are pending
// logs, in addition to the reconnect/foreground triggers. 5 minutes is a
// reasonable default for a site log app — logs aren't urgent enough to
// need near-real-time sync, but shouldn't sit unsynced all day either.
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function AuthGate({ children }) {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return; // don't redirect until we know

    const onLoginScreen = segments[0] === 'login';

    if (status === 'unauthenticated' && !onLoginScreen) {
      router.replace('/login');
    } else if (status === 'authenticated' && onLoginScreen) {
      router.replace('/');
    }
  }, [status, segments, router]);

  return children;
}

export default function RootLayout() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [initError, setInitError] = useState(null);
  const { status: authStatus } = useAuth();

  useEffect(() => {
    async function setup() {
      try {
        await databaseManager.initDatabase();
        setIsDbReady(true);

        // Load "last synced at" before wiring up auto-sync, so the UI has
        // a correct value the moment the list screen renders rather than
        // flashing "never synced" for a beat.
        await syncService.loadPersistedState();

        // Restore any previously-logged-in session from SecureStore.
        await authService.restoreSession();
      } catch (err) {
        console.error('Failed to initialize database:', err);
        setInitError(
          'SiteLog could not start because the local database failed to initialize.'
        );
      }
    }
    setup();
  }, []);

  // Auto-sync wiring — only once the database is ready AND the person is
  // actually logged in (syncing while unauthenticated would just fail the
  // backend's auth check on every attempt).
  useEffect(() => {
    if (!isDbReady || authStatus !== 'authenticated') return undefined;

    const cleanup = syncService.startAutoSync({
      NetInfo,
      AppState,
      intervalMs: AUTO_SYNC_INTERVAL_MS,
    });

    return cleanup;
  }, [isDbReady, authStatus]);

  if (initError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{initError}</Text>
      </View>
    );
  }

  if (!isDbReady || authStatus === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1D4ED8" />
        <Text style={styles.loadingText}>Starting SiteLog…</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthGate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#1D4ED8' },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'SiteLog' }} />
          <Stack.Screen name="log-entry" options={{ title: 'New Daily Log' }} />
          <Stack.Screen
            name="log-detail/[id]"
            options={{ title: 'Log Detail' }}
          />
        </Stack>
      </AuthGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 24,
  },
  loadingText: { marginTop: 12, fontSize: 15, color: '#4B5563' },
  errorText: { fontSize: 15, color: '#DC2626', textAlign: 'center' },
});