import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';

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
        <button onClick={handleBack} style={styles.backBtn}>← Inicio</button>
      </nav>

      <h1 style={styles.title}>Mis Órdenes</h1>

      {orders.length === 0 ? (
        <div style={styles.empty}>
          <h2>No tienes órdenes</h2>
          <p>Compra entradas para tus eventos favoritos.</p>
          <button onClick={handleBack} style={styles.backBtn}>Ir al catálogo</button>
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
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', minHeight: '100vh' },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'none',
    border: '1px solid #d1d5db',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  },
  title: { fontSize: 28, color: '#111827', marginBottom: 24 },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    fontSize: 18,
    color: '#6b7280',
  },
  error: {
    padding: 24,
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 8,
    margin: 24,
  },
  empty: {
    textAlign: 'center',
    padding: 60,
    background: '#f3f4f6',
    borderRadius: 12,
  },
  orderGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 20,
  },
  orderCard: {
    padding: 24,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
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
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  orderIdValue: {
    fontSize: 16,
    fontWeight: 700,
    color: '#111827',
  },
  orderInfo: { display: 'flex', flexDirection: 'column', gap: 8 },
  orderText: { margin: 0, fontSize: 14, color: '#374151' },
};
