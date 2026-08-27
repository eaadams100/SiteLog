/**
 * components/Login.jsx
 *
 * Combined login/register screen, shown by App.jsx whenever the person
 * isn't authenticated. Mirrors the mobile app's app/login.js — same
 * toggle-between-modes approach, same reasoning (a separate register
 * page felt like more navigation than this needs).
 */

import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'pm', label: 'Project Manager' },
];

export default function Login() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('pm');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-card__title">SiteLog</h1>
        <p className="login-card__subtitle">
          {mode === 'login' ? 'Log in to the dashboard' : 'Create an account'}
        </p>

        {mode === 'register' && (
          <div className="field">
            <label className="field__label" htmlFor="login-name">
              Name
            </label>
            <input
              id="login-name"
              className="field__input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ama Boateng"
            />
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="field__input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="field__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>

        {mode === 'register' && (
          <div className="field">
            <span className="field__label">Role</span>
            <div className="login-card__role-row">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.value}
                  className={`chip ${role === r.value ? 'chip--selected' : ''}`}
                  onClick={() => setRole(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="login-card__error">{error}</p>}

        <button type="submit" className="button button--primary login-card__submit" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
        </button>

        <button
          type="button"
          className="login-card__toggle"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Log in'}
        </button>
      </form>
    </div>
  );
}
