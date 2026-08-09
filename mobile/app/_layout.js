/**
 * app/_layout.js
 *
 * Root layout for the Expo Router app. This is the Router equivalent of the
 * old App.js: it initializes the local SQLite database before any screen
 * renders, then hands off to a <Stack /> for file-based navigation between
 * routes in this folder (index, log-entry, log-detail/[id]).
 *
 * Phase 4 adds sync engine startup here: once the database is ready, it
 * loads the persisted "last synced at" value, then wires up automatic
 * sync (on reconnect, on app foreground, and on a periodic interval) via
 * SyncService.startAutoSync(). Cleanup on unmount tears all of that back
 * down — in practice this layout doesn't usually unmount during the app's
 * lifetime, but it's correct either way.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';

import databaseManager from '../db/DatabaseManager';
import syncService from '../services/SyncService';

// How often to auto-sync while the app is open and there are pending
// logs, in addition to the reconnect/foreground triggers. 5 minutes is a
// reasonable default for a site log app — logs aren't urgent enough to
// need near-real-time sync, but shouldn't sit unsynced all day either.
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export default function RootLayout() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [initError, setInitError] = useState(null);

  useEffect(() => {
    async function setup() {
      try {
        await databaseManager.initDatabase();
        setIsDbReady(true);

        // Load "last synced at" before wiring up auto-sync, so the UI has
        // a correct value the moment the list screen renders rather than
        // flashing "never synced" for a beat.
        await syncService.loadPersistedState();
      } catch (err) {
        console.error('Failed to initialize database:', err);
        setInitError(
          'SiteLog could not start because the local database failed to initialize.'
        );
      }
    }
    setup();
  }, []);

  // Auto-sync wiring — only after the database (and therefore
  // syncService's persisted state) is ready. Separate effect from the one
  // above so this cleanly re-runs its cleanup if isDbReady ever flips back
  // to false, though that shouldn't normally happen post-init.
  useEffect(() => {
    if (!isDbReady) return undefined;

    const cleanup = syncService.startAutoSync({
      NetInfo,
      AppState,
      intervalMs: AUTO_SYNC_INTERVAL_MS,
    });

    return cleanup;
  }, [isDbReady]);

  if (initError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{initError}</Text>
      </View>
    );
  }

  if (!isDbReady) {
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
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1D4ED8' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'SiteLog' }} />
        <Stack.Screen name="log-entry" options={{ title: 'New Daily Log' }} />
        <Stack.Screen
          name="log-detail/[id]"
          options={{ title: 'Log Detail' }}
        />
      </Stack>
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
