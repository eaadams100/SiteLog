/**
 * app/_layout.js
 *
 * Root layout for the Expo Router app. This is the Router equivalent of the
 * old App.js: it initializes the local SQLite database before any screen
 * renders, then hands off to a <Stack /> for file-based navigation between
 * routes in this folder (index, log-entry, log-detail/[id]).
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import databaseManager from '../db/DatabaseManager';

export default function RootLayout() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [initError, setInitError] = useState(null);

  useEffect(() => {
    async function setup() {
      try {
        await databaseManager.initDatabase();
        setIsDbReady(true);
      } catch (err) {
        console.error('Failed to initialize database:', err);
        setInitError(
          'SiteLog could not start because the local database failed to initialize.'
        );
      }
    }
    setup();
  }, []);

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
