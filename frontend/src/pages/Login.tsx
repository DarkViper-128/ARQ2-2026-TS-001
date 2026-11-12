import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

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
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de inicio de sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>FlashTix</h1>
        <p style={styles.subtitle}>Inicia sesión para comprar entradas</p>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="fan1 o organizer1"
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
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
        </form>
        <div style={styles.hint}>
          <p>Usuarios de prueba:</p>
          <ul style={styles.list}>
            <li>fan1 / fan12345 (FAN)</li>
            <li>fan2 / fan12345 (FAN)</li>
            <li>organizer1 / organizer12345 (ORGANIZER)</li>
            <li>organizer2 / organizer12345 (ORGANIZER)</li>
          </ul>
        </div>
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
    background: '#f5f5f5',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: '#ffffff',
    padding: 40,
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    width: 100,
    maxWidth: 400,
  },
  title: { margin: 0, fontSize: 28, color: '#111827' },
  subtitle: { color: '#6b7280', marginBottom: 20 },
  error: {
    color: '#dc2626',
    background: '#fef2f2',
    padding: 10,
    borderRadius: 6,
    fontSize: 14,
    marginBottom: 20,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 15 },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 14, fontWeight: 600, color: '#374151' },
  input: {
    padding: 10,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 16,
  },
  button: {
    marginTop: 10,
    padding: 12,
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: loading ? 0.7 : 1,
  },
  hint: {
    marginTop: 25,
    paddingTop: 20,
    borderTop: '1px solid #e5e7eb',
  },
  list: {
    margin: 8,
    paddingLeft: 20,
    color: '#6b7280',
    fontSize: 13,
    lineHeight: '1.8',
  },
};
