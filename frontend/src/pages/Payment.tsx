import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';

interface Order {
  orderId: string;
  userId: string;
  eventId: string;
  status: string;
  failureReason: string | null;
  total: { amount: number; currency: string };
  seats: Array<{ seatId: string; category: string }>;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  PENDING:   { color: '#fbbf24', bg: '#78350f', border: '#d97706', label: 'Pago en proceso' },
  CONFIRMED: { color: '#4ade80', bg: '#14532d', border: '#bbf7d0', label: 'Pago aprobado' },
  FAILED:    { color: '#fca5a5', bg: '#7f1d1d', border: '#fecaca', label: 'Pago fallido' },
  REFUND_PENDING: { color: '#fbbf24', bg: '#78350f', border: '#d97706', label: 'Reembolso en proceso' },
  CANCELLED: { color: '#9ca3af', bg: '#334155', border: '#64748b', label: 'Orden cancelada' },
};

export default function Payment() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('flashtix_order');
    if (!stored) {
      setError('No hay una orden reciente. Ve al catálogo y crea una.');
      setLoading(false);
      return;
    }

    let eventSource: EventSource | null = null;

    const loadOrder = async () => {
      try {
        const orderId = JSON.parse(stored).orderId;
        const data = await api.get(`/orders/${orderId}`, token);
        setOrder(data as Order);
      } catch (err: any) {
        if (err.message === 'UNAUTHENTICATED') {
          localStorage.removeItem('flashtix_token');
          localStorage.removeItem('flashtix_user');
          navigate('/login');
        } else {
          setError(err.message || 'Error cargando la orden');
        }
      } finally {
        setLoading(false);
      }
    };

    loadOrder();

    // SSE: actualiza el estado en tiempo real sin recargar la página.
    try {
      const storedOrder = JSON.parse(stored);
      const orderId = storedOrder.orderId;
      eventSource = new EventSource(`/v1/orders/${orderId}/events`);
      eventSource.onmessage = (evt) => {
        try {
          const update = JSON.parse(evt.data);
          setOrder((prev) => (prev ? { ...prev, status: update.data.status, updatedAt: update.data.updatedAt } : prev));
        } catch {
          // ignore malformed SSE frames
        }
      };
      eventSource.onerror = () => {
        // SSE puede caerse; no es crítico, el estado ya se cargó por HTTP.
        eventSource?.close();
      };
    } catch {
      // EventSource no disponible en este entorno; seguimos con el estado HTTP.
    }

    return () => {
      eventSource?.close();
    };
  }, [token, navigate]);

  const handleRetry = () => {
    // El pago falló: volvemos al flujo de compra para crear una orden nueva.
    localStorage.removeItem('flashtix_order');
    navigate('/hold');
  };

  const handleBack = () => navigate('/orders');

  if (loading) {
    return (
      <div style={styles.loader}>
        <div>Cargando estado del pago…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={styles.error}>
        <p>{error}</p>
        <button onClick={handleBack} style={styles.secondaryBtn}>
          Volver a mis órdenes
        </button>
      </div>
    );
  }
  if (!order) {
    return (
      <div style={styles.empty}>
        <h2>No hay orden de pago</h2>
        <p>No se encontró una orden reciente para mostrar el pago.</p>
        <button onClick={handleBack} style={styles.secondaryBtn}>
          Ir a mis órdenes
        </button>
      </div>
    );
  }

  const style = STATUS_STYLE[order.status] || STATUS_STYLE.PENDING;
  const isTerminal = order.status === 'CONFIRMED' || order.status === 'CANCELLED' || order.status === 'FAILED';

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={handleBack} style={styles.backBtn}>← Mis órdenes</button>
      </nav>

      <h1 style={styles.title}>Estado del Pago</h1>

      <div style={styles.orderCard}>
        <div style={styles.orderHeader}>
          <span style={styles.orderIdLabel}>Orden</span>
          <span style={styles.orderIdValue}>#{order.orderId.slice(0, 8)}</span>
        </div>

        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Estado del pago</span>
          <span
            style={{
              ...styles.statusBadge,
              color: style.color,
              backgroundColor: style.bg,
              border: `1px solid ${style.border}`,
            }}
          >
            {style.label}
          </span>
        </div>

        <div style={styles.orderInfo}>
          <p style={styles.orderText}>
            <strong>Evento:</strong> {order.eventId.slice(0, 8)}…
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
          {order.failureReason && (
            <p style={styles.failureReason}>
              <strong>Motivo:</strong> {order.failureReason}
            </p>
          )}
        </div>

        <div style={styles.actions}>
          {order.status === 'CONFIRMED' && (
            <button onClick={() => navigate('/tickets')} style={styles.primaryBtn}>
              Ver mis boletos
            </button>
          )}
          {order.status === 'FAILED' && (
            <>
              <button onClick={handleRetry} style={styles.secondaryBtn}>
                Reintentar compra
              </button>
              <p style={styles.retryHint}>
                El pago se procesa de forma asíncrona. Si falló, puedes crear una orden nueva desde aquí.
              </p>
            </>
          )}
          {order.status === 'PENDING' && (
            <p style={styles.retryHint}>
              El pago se está procesando. Esta página se actualiza sola cuando el estado cambie.
            </p>
          )}
        </div>
      </div>

      {isTerminal && (
        <p style={styles.note}>
          El estado de esta orden ya es definitivo. Para otra compra, ve al catálogo.
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#0f172a', color: '#f1f5f9' },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'none',
    border: '1px solid #334155',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    color: '#94a3b8',
  },
  title: { fontSize: 28, color: '#ffffff', marginBottom: 24 },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    fontSize: 18,
    color: '#94a3b8',
  },
  error: {
    padding: 24,
    background: '#450a0a',
    color: '#fca5a5',
    borderRadius: 8,
    margin: 24,
    border: '1px solid #7f1d1d',
  },
  empty: {
    textAlign: 'center',
    padding: 60,
    background: '#1e293b',
    borderRadius: 12,
    border: '1px solid #334155',
  },
  orderCard: {
    padding: 32,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    maxWidth: 520,
    margin: '0 auto',
  },
  orderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  orderIdLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  orderIdValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#ffffff',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  statusLabel: { fontSize: 14, color: '#94a3b8' },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#0f172a',
    border: '1px solid #334155',
    color: '#cbd5e1',
  },
  orderInfo: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 },
  orderText: { margin: 0, fontSize: 14, color: '#cbd5e1' },
  failureReason: {
    margin: 0,
    fontSize: 13,
    color: '#fca5a5',
    background: '#450a0a',
    padding: 8,
    borderRadius: 6,
    border: '1px solid #7f1d1d',
  },
  actions: { display: 'flex', gap: 12, marginBottom: 20 },
  primaryBtn: {
    padding: '10px 24px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 24px',
    background: '#1e293b',
    color: '#2563eb',
    border: '1px solid #2563eb',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  retryHint: {
    margin: 0,
    fontSize: 13,
    color: '#94a3b8',
  },
  note: {
    margin: 0,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
};
