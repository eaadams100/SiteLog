/**
 * services/AuthService.js
 *
 * Phase 7 — authentication. Plain singleton module (same pattern as
 * SyncService and databaseManager), so it can be used from anywhere —
 * screens, SyncService's request headers, route guards in
 * app/_layout.js — without needing to live inside a component tree.
 *
 * The JWT is stored via expo-secure-store (Keychain on iOS, Keystore on
 * Android) — deliberately NOT AsyncStorage, which stores plain
 * unencrypted text. A construction site login token sitting in
 * plaintext on a shared/lost device is a real risk worth avoiding for
 * the cost of one extra (built-in, well-supported) dependency.
 */

import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUT_MS } from '../constants/api';

const TOKEN_KEY = 'sitelog_auth_token';
const USER_KEY = 'sitelog_auth_user';

class AuthService {
  constructor() {
    this._listeners = new Set();
    this._state = {
      status: 'loading', // 'loading' | 'authenticated' | 'unauthenticated'
      user: null, // { id, email, name, role }
      token: null,
      error: null,
    };
  }

  // ===========================================================================
  // Subscription (used by hooks/useAuth.js)
  // ===========================================================================

  subscribe(listener) {
    this._listeners.add(listener);
    listener(this._state);
    return () => this._listeners.delete(listener);
  }

  _emit(partialState) {
    this._state = { ...this._state, ...partialState };
    for (const listener of this._listeners) {
      listener(this._state);
    }
  }

  // ===========================================================================
  // Startup: restore a persisted session, if any
  // ===========================================================================

  /**
   * Call once at app start (app/_layout.js). Loads any previously-saved
   * token/user from SecureStore so the person doesn't have to log in
   * again every time they open the app.
   *
   * @returns {Promise<void>}
   */
  async restoreSession() {
    try {
      const [token, userJson] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      if (token && userJson) {
        this._emit({ status: 'authenticated', token, user: JSON.parse(userJson), error: null });
      } else {
        this._emit({ status: 'unauthenticated', token: null, user: null });
      }
    } catch (err) {
      console.warn('AuthService: failed to restore session:', err);
      this._emit({ status: 'unauthenticated', token: null, user: null });
    }
  }

  // ===========================================================================
  // Login / register / logout
  // ===========================================================================

  /**
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async login(email, password) {
    return this._authenticate(API_ENDPOINTS.authLogin, { email, password });
  }

  /**
   * @param {string} email
   * @param {string} password
   * @param {string} name
   * @param {'supervisor'|'pm'} role
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async register(email, password, name, role) {
    return this._authenticate(API_ENDPOINTS.authRegister, { email, password, name, role });
  }

  async _authenticate(endpoint, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const url = `${API_BASE_URL}${endpoint}`;

    console.log('AUTH REQUEST URL:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        data?.error || `Request failed with status ${response.status}.`;

      this._emit({ error: message });
      return { success: false, error: message };
    }

    await Promise.all([
  SecureStore.setItemAsync(TOKEN_KEY, data.token),
  SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user)),
]);

    this._emit({
      status: 'authenticated',
      token: data.token,
      user: data.user,
      error: null,
    });

    return { success: true };
  } catch (err) {
    console.log('LOGIN ERROR:', err);
    console.log('API URL:', `${API_BASE_URL}${endpoint}`);

    const message =
      err.name === 'AbortError'
        ? 'The server took too long to respond.'
        : err.message || 'Could not reach the server.';

    this._emit({ error: message });
    return { success: false, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

  /**
   * Clears the stored session. Does NOT delete any local log/photo data —
   * logging out just means "no longer authenticated to sync", not "erase
   * this device's offline data".
   *
   * @returns {Promise<void>}
   */
  async logout() {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    this._emit({ status: 'unauthenticated', token: null, user: null, error: null });
  }

  // ===========================================================================
  // Accessors for non-React code (e.g. SyncService building request headers)
  // ===========================================================================

  /**
   * @returns {Promise<string|null>}
   */
  async getToken() {
    if (this._state.token) return this._state.token;
    return SecureStore.getItemAsync(TOKEN_KEY);
  }

  getCurrentUser() {
    return this._state.user;
  }

  isAuthenticated() {
    return this._state.status === 'authenticated';
  }
}

const authService = new AuthService();
export default authService;
