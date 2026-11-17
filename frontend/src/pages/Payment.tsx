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

    // The order finishes asynchronously, so the screen has to be told when it does.
    const TERMINAL = ['CONFIRMED', 'FAILED', 'CANCELLED'];
    let polling: ReturnType<typeof setInterval> | null = null;

    const applyStatus = (status: string, updatedAt?: string) => {
      setOrder((prev) => (prev ? { ...prev, status, updatedAt: updatedAt ?? prev.updatedAt } : prev));
      if (TERMINAL.includes(status) && polling) {
        clearInterval(polling);
        polling = null;
      }
    };

    // Fallback for whenever the stream is unavailable or drops: without it the screen
    // stayed on "procesando" forever even though the order had already been confirmed.
    const startPolling = (orderId: string) => {
      if (polling) return;
      polling = setInterval(async () => {
        try {
          const data = (await api.get(`/orders/${orderId}`, token)) as Order;
          applyStatus(data.status, data.updatedAt);
        } catch {
          // keep trying; the stream or the next tick may succeed
        }
      }, 2000);
    };

    try {
      const orderId = JSON.parse(stored).orderId;
      // EventSource cannot send headers, so the token travels as the `jwt` query
      // argument. Kong verifies it there exactly as it does in the header.
      eventSource = new EventSource(`/v1/orders/${orderId}/events?jwt=${token}`);

      // The server names its events ("event: order.update"), and onmessage only fires
      // for unnamed ones, so listening there meant never hearing anything.
      eventSource.addEventListener('order.update', (evt) => {
        try {
          const update = JSON.parse((evt as MessageEvent).data);
          applyStatus(update.status, update.updatedAt);
        } catch {
          // ignore malformed SSE frames
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        startPolling(orderId);
      };
    } catch {
      // EventSource missing in this browser: poll instead.
      try {
        startPolling(JSON.parse(stored).orderId);
      } catch {
        // nothing else to do
      }
    }

    return () => {
      eventSource?.close();
      if (polling) clearInterval(polling);
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
        <Button onClick={handleBack} variant="outline" style={styles.secondaryBtn}>
          Volver a mis órdenes
        </Button>
      </div>
    );
  }
  if (!order) {
    return (
      <div style={styles.empty}>
        <h2>No hay orden de pago</h2>
        <p>No se encontró una orden reciente para mostrar el pago.</p>
        <Button onClick={handleBack} variant="outline" style={styles.secondaryBtn}>
          Ir a mis órdenes
        </Button>
      </div>
    );
  }

  const style = STATUS_STYLE[order.status] || STATUS_STYLE.PENDING;
  const isTerminal = order.status === 'CONFIRMED' || order.status === 'CANCELLED' || order.status === 'FAILED';

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <Button type="button" onClick={handleBack} variant="ghost" style={styles.backBtn}>← Mis órdenes</Button>
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
            <Button onClick={() => navigate('/tickets')} variant="primary" style={styles.primaryBtn}>
              Ver mis boletos
            </Button>
          )}
          {order.status === 'FAILED' && (
            <>
              <Button onClick={handleRetry} variant="outline" style={styles.secondaryBtn}>
                Reintentar compra
              </Button>
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
  orderCard: {
    padding: 32,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
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
    color: colors.muted,
    textTransform: 'uppercase',
  },
  orderIdValue: {
    fontSize: 18,
    fontWeight: 700,
    color: colors.text,
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  statusLabel: { fontSize: 14, color: colors.muted },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: colors.background,
    border: `1px solid ${colors.border}`,
    color: colors.muted,
  },
  orderInfo: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 },
  orderText: { margin: 0, fontSize: 14, color: colors.muted },
  failureReason: {
    margin: 0,
    fontSize: 13,
    color: colors.error,
    background: colors.errorBg,
    padding: 8,
    borderRadius: 6,
    border: `1px solid ${colors.errorBorder}`,
  },
  actions: { display: 'flex', gap: 12, marginBottom: 20 },
  primaryBtn: {
    padding: '10px 24px',
    fontSize: 16,
    fontWeight: 600,
  },
  secondaryBtn: {
    padding: '10px 24px',
    fontSize: 16,
    fontWeight: 600,
  },
  retryHint: {
    margin: 0,
    fontSize: 13,
    color: colors.muted,
  },
  note: {
    margin: 0,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
};
