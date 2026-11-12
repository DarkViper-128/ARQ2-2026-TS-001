import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface AuthContextType {
  token: string | null;
  user: { username: string; role: string } | null;
  isAuthenticated: boolean;
  login: (token: string, username: string, role: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('flashtix_token');
  });
  const [user, setUser] = useState<{ username: string; role: string } | null>(() => {
    const raw = localStorage.getItem('flashtix_user');
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback((token: string, username: string, role: string) => {
    setToken(token);
    setUser({ username, role });
    localStorage.setItem('flashtix_token', token);
    localStorage.setItem('flashtix_user', JSON.stringify({ username, role }));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('flashtix_token');
    localStorage.removeItem('flashtix_user');
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
