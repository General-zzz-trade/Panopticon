import { useCallback, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api/client';

function parseJwt(token: string): { email: string; role: string; exp?: number } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { email: payload.email ?? '', role: payload.role ?? 'user', exp: payload.exp };
  } catch {
    return null;
  }
}

export function useAuth() {
  const { state, dispatch } = useApp();

  const isAuthenticated = !!state.jwtToken;

  // On mount: if we have a stored token, verify it via /auth/me
  useEffect(() => {
    if (!state.jwtToken) return;
    const parsed = parseJwt(state.jwtToken);

    // Check if token is expired
    if (parsed?.exp && parsed.exp * 1000 < Date.now()) {
      // Try refresh
      api.refreshToken()
        .then(({ token }) => {
          const user = parseJwt(token);
          dispatch({ type: 'SET_AUTH', token, user: user ?? { email: '', role: 'user' } });
        })
        .catch(() => {
          dispatch({ type: 'LOGOUT' });
        });
      return;
    }

    // Verify token is still valid
    api.getMe()
      .then(({ user }) => {
        dispatch({
          type: 'SET_AUTH',
          token: state.jwtToken!,
          user: { email: user.email, role: user.role },
        });
      })
      .catch(() => {
        // Token invalid — logout
        dispatch({ type: 'LOGOUT' });
      });
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!state.jwtToken) return;
    const parsed = parseJwt(state.jwtToken);
    if (!parsed?.exp) return;

    const msUntilExpiry = parsed.exp * 1000 - Date.now();
    // Refresh 2 minutes before expiry
    const refreshIn = Math.max(msUntilExpiry - 120_000, 10_000);

    const timer = setTimeout(() => {
      api.refreshToken()
        .then(({ token }) => {
          const user = parseJwt(token);
          dispatch({ type: 'SET_AUTH', token, user: user ?? { email: '', role: 'user' } });
        })
        .catch(() => {});
    }, refreshIn);

    return () => clearTimeout(timer);
  }, [state.jwtToken, dispatch]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user } = await api.login(email, password);
      const parsed = parseJwt(token);
      dispatch({
        type: 'SET_AUTH',
        token,
        user: parsed ?? { email: user.email, role: user.role },
      });
      return { token, user };
    },
    [dispatch],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const { token, user } = await api.register(email, password, name);
      const parsed = parseJwt(token);
      dispatch({
        type: 'SET_AUTH',
        token,
        user: parsed ?? { email: user.email, role: user.role },
      });
      return { token, user };
    },
    [dispatch],
  );

  const logout = useCallback(() => {
    dispatch({ type: 'LOGOUT' });
  }, [dispatch]);

  const user = useMemo(() => state.jwtUser, [state.jwtUser]);

  return { token: state.jwtToken, user, login, register, logout, isAuthenticated };
}
