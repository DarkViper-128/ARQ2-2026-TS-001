import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api';

export default function Order() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<any>(null);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const idempotencyKey = `order-${Date.now()}`;
      const holdRaw = localStorage.getItem('flashtix_hold');
      const hold = holdRaw ? JSON.parse(holdRaw) : null;

      const res2 = await fetch('/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          holdId: hold?.holdId,
          paymentMethodToken: 'tok_visa',
        }),
      });

      if (res2.status === 401) {
        localStorage.removeItem('flashtix_token');
        localStorage.removeItem('flashtix_user');
        navigate('/login');
        return;
      }

      if (!res2.ok) {
        const errBody = await res2.json().catch(() => ({}));
        throw new Error(errBody.detail || `Error ${res2.status}`);
      }

      const orderData = await res2.json();
      setOrder(orderData);
      localStorage.setItem('flashtix_order', JSON.stringify(orderData));
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleGoTickets = () => {
    navigate('/tickets');
  };

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={() => navigate('/hold')} style={styles.backBtn}>← Reserva</button>
      </nav>

      <h1 style={styles.title}>Confirmar compra</h1>

      {!order && (
        <>
          <form onSubmit={handleCheckout} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Método de pago</label>
              <select style={styles.input}>
                <option value="tok_visa">Tarjeta de crédito (Visa)</option>
              </select>
            </div>
            <p style={styles.hint}>
              El pago se procesa de forma asíncrona. Recibirás la confirmación en unos segundos.
            </p>
            <button type="submit" disabled={loading} style={styles.payBtn}>
              {loading ? 'Procesando...' : 'Pagar y confirmar orden'}
            </button>
          </form>
        </>
      )}

      {order && (
        <div style={styles.successCard}>
          <h2 style={styles.successTitle}>✅ Orden confirmada</h2>
          <p style={styles.successText}>
            Tu orden <strong>{order.orderId}</strong> ha sido confirmada.
          </p>
          <p style={styles.successText}>
            Asientos: {order.seats?.map((s: any) => s.seatId).join(', ')}
          </p>
          <p style={styles.successText}>
            Total: {order.total?.amount?.toLocaleString('es-CO', {
              style: 'currency',
              currency: 'COP',
            })}
          </p>
          <button onClick={handleGoTickets} style={styles.ticketsBtn}>
            Ver mis boletos
          </button>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif' },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'none',
    border: '1px solid #d1d5db',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
  },
  title: { fontSize: 28, color: '#111827', marginBottom: 24 },
  form: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400 },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 14, color: '#6b7280' },
  input: {
    padding: 10,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 16,
  },
  hint: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  payBtn: {
    padding: 12,
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  successCard: {
    padding: 40,
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 12,
    textAlign: 'center',
    maxWidth: 400,
    margin: '0 auto',
  },
  successTitle: { margin: 0, fontSize: 24, color: '#166534' },
  successText: { color: '#166534', margin: 12 },
  ticketsBtn: {
    marginTop: 20,
    padding: '10px 24px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    marginBottom: 16,
    padding: 12,
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 6,
    fontSize: 14,
  },
};
