import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

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
        <Button type="button" onClick={() => navigate('/')} variant="ghost" style={styles.backBtn}>← Catálogo</Button>
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
        <Button onClick={handleCheckout} variant="primary" style={styles.checkoutBtn}>
          Continuar al pago
        </Button>
        <Button onClick={handleRelease} variant="danger" style={styles.releaseBtn}>
          Liberar asientos
        </Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', background: colors.background, color: colors.text },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    cursor: 'pointer',
    padding: 0,
  },
  title: { fontSize: 28, color: colors.text, marginBottom: 24 },
  card: {
    padding: 32,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    marginBottom: 24,
  },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6 },
  value: { fontSize: 18, color: colors.text, marginBottom: 16 },
  seatList: {
    margin: 0,
    paddingLeft: 20,
    color: colors.text,
  },
  seatItem: { marginBottom: 4 },
  status: {
    display: 'inline-block',
    padding: '4px 10px',
    background: colors.background,
    color: colors.accent,
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 600,
    border: `1px solid ${colors.border}`,
  },
  actions: {
    display: 'flex',
    gap: 12,
  },
  checkoutBtn: {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 600,
    flex: 1,
  },
  releaseBtn: {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 600,
    flex: 1,
  },
  message: {
    marginBottom: 16,
    padding: 12,
    background: colors.errorBg,
    color: colors.error,
    borderRadius: 6,
    fontSize: 14,
    border: `1px solid ${colors.errorBorder}`,
  },
  error: {
    marginBottom: 16,
    padding: 12,
    background: colors.errorBg,
    color: colors.error,
    borderRadius: 6,
    fontSize: 14,
    border: `1px solid ${colors.errorBorder}`,
  },
};
