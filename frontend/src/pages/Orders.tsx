import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

interface Order {
  orderId: string;
  userId: string;
  eventId: string;
  status: string;
  total: { amount: number; currency: string };
  seats: Array<{ seatId: string; category: string }>;
  createdAt: string;
}

export default function Orders() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/orders', token)
      .then((data: Order[] | Order) => {
        const list = Array.isArray(data) ? data : data ? [data] : [];
        setOrders(list);
      })
      .catch((err: Error) => {
        if (err.message === 'UNAUTHENTICATED') {
          localStorage.removeItem('flashtix_token');
          localStorage.removeItem('flashtix_user');
          navigate('/login');
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [token, navigate]);

  const handleBack = () => navigate('/');

  if (loading) return <div style={styles.loader}>Cargando órdenes...</div>;
  if (error) return <div style={styles.error}>Error: {error}</div>;

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <Button type="button" onClick={handleBack} variant="ghost" style={styles.backBtn}>← Inicio</Button>
      </nav>

      <h1 style={styles.title}>Mis Órdenes</h1>

      {orders.length === 0 ? (
        <div style={styles.empty}>
          <h2>No tienes órdenes</h2>
          <p>Compra entradas para tus eventos favoritos.</p>
          <Button onClick={handleBack} variant="outline" style={styles.backBtn}>Ir al catálogo</Button>
        </div>
      ) : (
        <div style={styles.orderGrid}>
          {orders.map((order) => (
            <div key={order.orderId} style={styles.orderCard}>
              <div style={styles.orderHeader}>
                <span style={styles.orderIdLabel}>Orden</span>
                <span style={styles.orderIdValue}>#{order.orderId.slice(0, 8)}</span>
              </div>
              <div style={styles.orderInfo}>
                <p style={styles.orderText}>
                  <strong>Estado:</strong> {order.status}
                </p>
                <p style={styles.orderText}>
                  <strong>Evento:</strong> {order.eventId.slice(0, 8)}...
                </p>
                <p style={styles.orderText}>
                  <strong>Asientos:</strong> {order.seats.map((s) => s.seatId).join(', ')}
                </p>
                <p style={styles.orderText}>
                  <strong>Total:</strong>{' '}
                  {order.total.amount.toLocaleString('es-CO', {
                    style: 'currency',
                    currency: 'COP',
                  })}
                </p>
                <p style={styles.orderText}>
                  <strong>Fecha:</strong>{' '}
                  {new Date(order.createdAt).toLocaleDateString('es-CO')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: colors.background, color: colors.text },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 0,
  },
  title: { fontSize: 28, color: colors.text, marginBottom: 24 },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    fontSize: 18,
    color: colors.muted,
  },
  error: {
    padding: 24,
    background: colors.errorBg,
    color: colors.error,
    borderRadius: 8,
    margin: 24,
    border: `1px solid ${colors.errorBorder}`,
  },
  empty: {
    textAlign: 'center',
    padding: 60,
    background: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
  },
  orderGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 20,
  },
  orderCard: {
    padding: 24,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  orderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  orderIdLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  orderIdValue: {
    fontSize: 16,
    fontWeight: 700,
    color: colors.text,
  },
  orderInfo: { display: 'flex', flexDirection: 'column', gap: 8 },
  orderText: { margin: 0, fontSize: 14, color: colors.muted },
};
