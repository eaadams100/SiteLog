/**
 * hooks/useAuth.js
 *
 * React hook bridging AuthService's plain-JS pub/sub into component
 * state. Any screen/component can call this to read auth status or
 * trigger login/logout, without prop-drilling.
 */

import { useCallback, useEffect, useState } from 'react';
import authService from '../services/AuthService';

/**
 * @returns {{
 *   status: 'loading' | 'authenticated' | 'unauthenticated',
 *   user: {id: string, email: string, name: string, role: 'supervisor'|'pm'} | null,
 *   error: string | null,
 *   login: (email: string, password: string) => Promise<{success: boolean, error?: string}>,
 *   register: (email: string, password: string, name: string, role: string) => Promise<{success: boolean, error?: string}>,
 *   logout: () => Promise<void>,
 * }}
 */
export function useAuth() {
  const [state, setState] = useState(null);

  useEffect(() => {
    return authService.subscribe(setState);
  }, []);

  const login = useCallback((email, password) => authService.login(email, password), []);
  const register = useCallback(
    (email, password, name, role) => authService.register(email, password, name, role),
    []
  );
  const logout = useCallback(() => authService.logout(), []);

  return {
    status: state?.status ?? 'loading',
    user: state?.user ?? null,
    error: state?.error ?? null,
    login,
    register,
    logout,
  };
}
