/**
 * hooks/useAuth.js
 *
 * React hook bridging services/auth.js's plain pub/sub into component
 * state. Mirrors the same pattern used in the mobile app's
 * hooks/useAuth.js, for consistency across the whole project.
 */

import { useCallback, useEffect, useState } from 'react';
import { subscribe, login as authLogin, register as authRegister, logout as authLogout } from '../services/auth';

export function useAuth() {
  const [state, setState] = useState(null);

  useEffect(() => subscribe(setState), []);

  const login = useCallback((email, password) => authLogin(email, password), []);
  const register = useCallback(
    (email, password, name, role) => authRegister(email, password, name, role),
    []
  );
  const logout = useCallback(() => authLogout(), []);

  return {
    status: state?.status ?? 'loading',
    user: state?.user ?? null,
    error: state?.error ?? null,
    login,
    register,
    logout,
  };
}