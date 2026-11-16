import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';

interface Hold {
  holdId: string;
  eventId: string;
  seatIds: string[];
  status: string;
  expiresAt: string;
}

export default function Hold() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [hold, setHold] = useState<Hold | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const raw = localStorage.getItem('flashtix_hold');
    if (raw) {
      setHold(JSON.parse(raw));
      setLoading(false);
    } else {
      api.get('/holds', token)
        .then((data: Hold | Hold[]) => {
          const holds = Array.isArray(data) ? data : [data];
          if (holds.length > 0) setHold(holds[0]);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [token]);

  const handleCheckout = () => {
    if (!hold) return;
    navigate('/order');
  };

  const handleRelease = async () => {
    if (!hold) return;
    try {
      await api.delete(`/holds/${hold.holdId}`, token);
      localStorage.removeItem('flashtix_hold');
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div>Cargando reserva...</div>;
  if (!hold) return <div>No hay reserva activa</div>;

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={() => navigate('/')} style={styles.backBtn}>← Catálogo</button>
      </nav>

      <h1 style={styles.title}>Tu reserva</h1>

      <div style={styles.card}>
        <p style={styles.label}>Evento:</p>
        <p style={styles.value}>{hold.eventId}</p>

        <p style={styles.label}>Asientos:</p>
        <ul style={styles.seatList}>
          {hold.seatIds.map((sid) => (
            <li key={sid} style={styles.seatItem}>{sid}</li>
          ))}
        </ul>

        <p style={styles.label}>Estado:</p>
        <span style={styles.status}>{hold.status}</span>

        <p style={styles.label}>Expires en:</p>
        <p style={styles.value}>{new Date(hold.expiresAt).toLocaleString('es-CO')}</p>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.actions}>
        <button onClick={handleCheckout} style={styles.checkoutBtn}>
          Continuar al pago
        </button>
        <button onClick={handleRelease} style={styles.releaseBtn}>
          Liberar asientos
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#f1f5f9' },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'none',
    border: '1px solid #334155',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
  },
  title: { fontSize: 28, color: '#ffffff', marginBottom: 24 },
  card: {
    padding: 32,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    marginBottom: 24,
  },
  label: { fontSize: 14, color: '#94a3b8', marginBottom: 6 },
  value: { fontSize: 18, color: '#ffffff', marginBottom: 16 },
  seatList: {
    margin: 0,
    paddingLeft: 20,
    color: '#cbd5e1',
  },
  seatItem: { marginBottom: 4 },
  status: {
    display: 'inline-block',
    padding: '4px 10px',
    background: '#0f172a',
    color: '#34d399',
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 600,
    border: '1px solid #10b981',
  },
  actions: {
    display: 'flex',
    gap: 12,
  },
  checkoutBtn: {
    padding: '12px 24px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    flex: 1,
  },
  releaseBtn: {
    padding: '12px 24px',
    background: '#ef4444',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    flex: 1,
  },
  message: {
    marginBottom: 16,
    padding: 12,
    background: '#064e3b',
    color: '#6ee7b7',
    borderRadius: 6,
    fontSize: 14,
    border: '1px solid #10b981',
  },
  error: {
    marginBottom: 16,
    padding: 12,
    background: '#7f1d1d',
    color: '#fecaca',
    borderRadius: 6,
    fontSize: 14,
    border: '1px solid #b91c1c',
  },
};
