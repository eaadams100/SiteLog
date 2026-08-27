/**
 * services/auth.js
 *
 * Phase 7 — authentication for the dashboard. Plain module with a tiny
 * pub/sub (same pattern as the mobile app's AuthService/SyncService),
 * so any component can subscribe without prop-drilling.
 *
 * Token storage: localStorage. Simpler than an httpOnly cookie (which
 * would need the backend to set/manage cookies instead of returning a
 * token in the JSON body — a bigger change), but worth knowing the
 * trade-off: a token in localStorage is readable by any JS running on
 * the page, so it's vulnerable to XSS in a way an httpOnly cookie isn't.
 * Reasonable for an internal PM tool's roll-your-own MVP auth; revisit
 * if this is ever exposed more broadly.
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://sitelog-api.onrender.com';
const TOKEN_KEY = 'sitelog_auth_token';
const USER_KEY = 'sitelog_auth_user';

const authClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

const listeners = new Set();
let state = {
  status: 'loading', // 'loading' | 'authenticated' | 'unauthenticated'
  user: null,
  token: null,
  error: null,
};

function emit(partial) {
  state = { ...state, ...partial };
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Call once at app start — restores a persisted session, if any. */
export function restoreSession() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY);
    if (token && userJson) {
      emit({ status: 'authenticated', token, user: JSON.parse(userJson), error: null });
    } else {
      emit({ status: 'unauthenticated', token: null, user: null });
    }
  } catch (err) {
    console.warn('auth: failed to restore session:', err);
    emit({ status: 'unauthenticated', token: null, user: null });
  }
}

function normalizeError(err) {
  if (err.response) return err.response.data?.error || `Request failed with status ${err.response.status}.`;
  if (err.request) return 'Could not reach the SiteLog server. It may be waking up from sleep — try again shortly.';
  return err.message || 'An unexpected error occurred.';
}

async function authenticate(endpoint, body) {
  try {
    const { data } = await authClient.post(endpoint, body);
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    emit({ status: 'authenticated', token: data.token, user: data.user, error: null });
    return { success: true };
  } catch (err) {
    const message = normalizeError(err);
    emit({ error: message });
    return { success: false, error: message };
  }
}

export function login(email, password) {
  return authenticate('/api/v1/auth/login', { email, password });
}

export function register(email, password, name, role) {
  return authenticate('/api/v1/auth/register', { email, password, name, role });
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  emit({ status: 'unauthenticated', token: null, user: null, error: null });
}

export function getToken() {
  return state.token || localStorage.getItem(TOKEN_KEY);
}

export function getCurrentUser() {
  return state.user;
}