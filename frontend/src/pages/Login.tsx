import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

type View = 'selector' | 'organizerLogin';

export default function Login() {
  const [view, setView] = useState<View>('selector');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleEnterAsFan = () => {
    setError('');
    // El fan entra sin credenciales: rol FAN, sin token real
    login(null, 'fan', 'FAN');
    navigate('/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        'http://localhost:8080/realms/flashtix/protocol/openid-connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'password',
            client_id: 'flashtix-web',
            username,
            password,
          }),
        },
      );

      if (!response.ok) throw new Error('Credenciales inválidas');

      const data = await response.json();
      // Decode JWT payload to get role (no verification needed for UI)
      const payload = JSON.parse(
        atob(data.access_token.split('.')[1]),
      );
      const role = payload.realm_access?.roles?.[0] || 'FAN';

      login(data.access_token, username, role);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de inicio de sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {view === 'selector' ? (
          <>
            <h1 style={styles.title}>FlashTix</h1>
            <p style={styles.subtitle}>
              Elige cómo quieres entrar
            </p>
            {error && <p style={styles.error}>{error}</p>}
            <div style={styles.roleButtons}>
              <Button
                type="button"
                onClick={handleEnterAsFan}
                disabled={loading}
                variant="primary"
                style={styles.roleBtn}
              >
                🎟️ Entrar como Fan
              </Button>
              <Button
                type="button"
                onClick={() => setView('organizerLogin')}
                disabled={loading}
                variant="outline"
                style={styles.roleBtnOutline}
              >
                👤 Entrar como Organizador
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 style={styles.title}>FlashTix</h1>
            <p style={styles.subtitle}>
              Inicio de sesión — Organizador
            </p>
            <Button
              type="button"
              onClick={() => {
                setView('selector');
                setError('');
              }}
              variant="ghost"
              style={styles.backBtn}
            >
              ← Volver
            </Button>
            {error && <p style={styles.error}>{error}</p>}
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Usuario</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="organizer1"
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={styles.input}
                  required
                />
              </div>
              <Button type="submit" disabled={loading} variant="primary" style={styles.button}>
                {loading ? 'Ingresando...' : 'Iniciar sesión'}
              </Button>
            </form>
            <div style={styles.hint}>
              <p>Usuarios de prueba:</p>
              <ul style={styles.list}>
                <li>organizer1 / organizer12345 (ORGANIZER)</li>
                <li>organizer2 / organizer12345 (ORGANIZER)</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: colors.background,
    color: colors.text,
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: colors.surface,
    padding: 40,
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    width: 300,
    maxWidth: 300,
    border: `1px solid ${colors.border}`,
    color: colors.text,
  },
  title: { margin: '0 0 8px 0', fontSize: 28, color: colors.text },
  subtitle: { color: colors.muted, marginBottom: 24 },
  error: {
    color: colors.error,
    background: colors.errorBg,
    padding: 10,
    borderRadius: 6,
    fontSize: 14,
    marginBottom: 20,
    border: `1px solid ${colors.errorBorder}`,
  },
  roleButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  roleBtn: {
    padding: '18px 24px',
    fontSize: 18,
    fontWeight: 600,
    textAlign: 'left',
    width: '100%',
  },
  roleBtnOutline: {
    padding: '18px 24px',
    fontSize: 18,
    fontWeight: 600,
    textAlign: 'left',
    width: '100%',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    fontSize: 14,
    cursor: 'pointer',
    marginBottom: 16,
    textAlign: 'left',
    padding: 0,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 15 },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 14, fontWeight: 600, color: colors.muted },
  input: {
    padding: 10,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontSize: 16,
    color: colors.text,
    background: colors.background,
  },
  button: {
    marginTop: 10,
    padding: '14px 24px',
    fontSize: 16,
    fontWeight: 600,
    width: '100%',
  },
  hint: {
    marginTop: 25,
    paddingTop: 20,
    borderTop: `1px solid ${colors.border}`,
  },
  list: {
    margin: 8,
    paddingLeft: 20,
    color: colors.muted,
    fontSize: 13,
    lineHeight: '1.8',
  },
};
