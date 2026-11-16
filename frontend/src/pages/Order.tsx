import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/api';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

interface PaymentMethod {
  value: string;
  label: string;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  { value: 'tok_visa', label: 'Tarjeta de Crédito Visa' },
  { value: 'tok_mastercard', label: 'Tarjeta de Crédito Mastercard' },
  { value: 'tok_amex', label: 'American Express' },
];

export default function Order() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PAYMENT_METHODS[0]);

  const holdRaw = localStorage.getItem('flashtix_hold');
  const hold = holdRaw ? JSON.parse(holdRaw) : null;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const idempotencyKey = `order-${Date.now()}`;
      if (!token) {
        localStorage.removeItem('flashtix_token');
        localStorage.removeItem('flashtix_user');
        navigate('/login');
        return;
      }

      const res2 = await fetch('/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          holdId: hold?.holdId,
          paymentMethodToken: method.value,
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
      localStorage.setItem('flashtix_order', JSON.stringify(orderData));
      navigate('/payment');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleBack = () => navigate('/hold');

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <Button type="button" onClick={handleBack} variant="ghost" style={styles.backBtn}>← Reserva</Button>
      </nav>

      <h1 style={styles.title}>Pasarela de Pago</h1>

      <div style={styles.card}>
        <div style={styles.orderSummary}>
          <h2 style={styles.summaryTitle}>Resumen de la compra</h2>
          <p style={styles.summaryLine}>
            <span style={styles.summaryLabel}>Evento:</span>
            <span style={styles.summaryValue}>{hold?.eventId ?? '—'}</span>
          </p>
          <p style={styles.summaryLine}>
            <span style={styles.summaryLabel}>Asientos:</span>
            <span style={styles.summaryValue}>{hold?.seatIds?.join(', ') ?? '—'}</span>
          </p>
          <p style={styles.summaryLineTotal}>
            <span style={styles.summaryLabel}>Total:</span>
            <span style={styles.summaryTotal}>
              {hold?.seatIds ? (hold.seatIds.length * 100).toLocaleString('es-CO', { style: 'currency', currency: 'COP' }) : '—'}
            </span>
          </p>
        </div>

        <form onSubmit={handleCheckout} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Método de pago</label>
            <select
              value={method.value}
              onChange={(e) => setMethod(PAYMENT_METHODS.find((m) => m.value === e.target.value)!)}
              style={styles.input}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.cardFields}>
            <h3 style={styles.cardTitle}>Datos de la tarjeta</h3>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Número de tarjeta</label>
              <input
                type="text"
                maxLength={19}
                placeholder="1234 5678 9012 3456"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.cardRow}>
              <div style={styles.inputGroupHalf}>
                <label style={styles.label}>Fecha de vencimiento</label>
                <input
                  type="text"
                  maxLength={5}
                  placeholder="MM/AA"
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.inputGroupHalf}>
                <label style={styles.label}>CVV</label>
                <input
                  type="text"
                  maxLength={3}
                  placeholder="123"
                  style={styles.input}
                  required
                />
              </div>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Nombre del titular</label>
              <input
                type="text"
                placeholder="Juan Pérez"
                style={styles.input}
                required
              />
            </div>
          </div>

          <p style={styles.hint}>
            El pago se procesa de forma asíncrona. Recibirás la confirmación en unos segundos.
          </p>

          <Button type="submit" disabled={loading} variant="primary" style={styles.payBtn}>
            {loading ? 'Procesando pago…' : 'Pagar y confirmar orden'}
          </Button>
        </form>
      </div>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', maxWidth: 600, margin: '0 auto', background: colors.background, color: colors.text },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
  },
  title: { margin: '0 0 24px 0', fontSize: 28, color: colors.text },
  card: {
    padding: 32,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 14,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  orderSummary: {
    marginBottom: 28,
    padding: 20,
    background: colors.background,
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
  },
  summaryTitle: { margin: '0 0 16px 0', fontSize: 18, color: colors.text, fontWeight: 700 },
  summaryLine: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
    fontSize: 15,
    color: colors.muted,
  },
  summaryLineTotal: {
    fontWeight: 700,
    fontSize: 17,
    color: colors.text,
    borderTop: `1px solid ${colors.border}`,
    paddingTop: 12,
    marginTop: 8,
  },
  summaryLabel: { color: colors.muted },
  summaryValue: { fontWeight: 600 },
  summaryTotal: { fontWeight: 800, color: colors.text },
  form: { display: 'flex', flexDirection: 'column', gap: 20 },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 14, fontWeight: 600, color: colors.muted },
  input: {
    padding: 12,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    fontSize: 16,
    color: colors.text,
    background: colors.background,
  },
  cardFields: {
    background: colors.background,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: { margin: '0 0 16px 0', fontSize: 16, color: colors.text, fontWeight: 600 },
  cardRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  inputGroupHalf: { display: 'flex', flexDirection: 'column', gap: 6 },
  hint: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 12,
  },
  payBtn: {
    width: '100%',
    padding: 16,
    fontSize: 17,
    fontWeight: 600,
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
