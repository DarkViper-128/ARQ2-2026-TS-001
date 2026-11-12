import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';

interface Event {
  eventId: string;
  name: string;
  artist: string;
  venue: { name: string; city: string };
  startsAt: string;
  saleStartsAt: string;
  status: string;
}

const PRICE_PER_TICKET = 100; // 100 pesos por boleta
const MAX_TICKETS = 6;

export default function EventSeats() {
  const { eventId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [availableTickets] = useState(50);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!eventId) return;
    api.get(`/events/${eventId}`, token)
      .then((data: Event) => setEvent(data))
      .catch((err: Error) => setError(err.message));
  }, [eventId, token]);

  const decrease = () => setQuantity((q) => Math.max(1, q - 1));
  const increase = () => setQuantity((q) => Math.min(availableTickets, MAX_TICKETS, q + 1));

  /** WR-3: joins the virtual queue and polls until the fan is ADMITTED. */
  const waitForAdmission = useCallback(async (ticketId: string): Promise<string> => {
    for (let i = 0; i < 30; i++) {
      const turn = await api.get(`/events/${eventId}/queue/${ticketId}`, token);
      if ((turn as any).status === 'ADMITTED') return (turn as any).admissionToken;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('La cola virtual no te admitió a tiempo. Intenta de nuevo.');
  }, [eventId, token]);

  const handleBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      // 1. Join the virtual queue
      const queueRes = await api.post(`/events/${eventId}/queue`, {}, token);
      const ticketId = (queueRes as any).queueTicketId;
      if (!ticketId) throw new Error('No se pudo unir a la cola virtual');

      // 2. Wait until ADMITTED to get the admission token
      const admissionToken = await waitForAdmission(ticketId);

      // 3. Generate seat ids for the requested quantity and create the hold
      const seatIds: string[] = [];
      for (let i = 1; i <= quantity; i++) {
        seatIds.push(`seat-${i}`);
      }

      const holdRes = await api.postWithHeaders(
        '/holds',
        { eventId, seatIds },
        { 'X-Admission-Token': admissionToken },
        token,
      );

      localStorage.setItem('flashtix_hold', JSON.stringify(holdRes));
      localStorage.setItem('flashtix_admission_token', admissionToken);
      navigate('/hold');
    } catch (err: any) {
      if (err.message === 'UNAUTHENTICATED') {
        localStorage.removeItem('flashtix_token');
        localStorage.removeItem('flashtix_user');
        navigate('/login');
        return;
      }
      setError(err.message || 'No se pudo crear la reserva');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.loader}>
        <div>Procesando reserva…</div>
      </div>
    );
  }
  if (error) return <div style={styles.error}>Error: {error}</div>;
  if (!event) return <div style={styles.empty}>Evento no encontrado</div>;

  const total = quantity * PRICE_PER_TICKET;

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={() => navigate('/')} style={styles.backBtn}>← Eventos</button>
        <h1 style={styles.title}>{event.name}</h1>
      </nav>

      <div style={styles.eventInfo}>
        <strong>{event.artist}</strong>
        <span> · {event.venue.name}, {event.venue.city}</span>
      </div>

      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Boletas disponibles</h2>
        <p style={styles.availableText}>
          Quedan <strong>{availableTickets}</strong> boletas para este evento.
        </p>

        <div style={styles.priceBox}>
          <span style={styles.priceLabel}>Precio por boleta:</span>
          <span style={styles.priceValue}>
            {PRICE_PER_TICKET.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}
          </span>
        </div>

        <div style={styles.quantityControl}>
          <label style={styles.quantityLabel}>Cantidad de boletas</label>
          <div style={styles.quantitySelector}>
            <button onClick={decrease} disabled={quantity <= 1} style={styles.qtyBtn}>
              −
            </button>
            <input
              type="number"
              value={quantity}
              min="1"
              max={Math.min(availableTickets, MAX_TICKETS)}
              onChange={(e) => {
                const v = Math.max(1, Math.min(parseInt(e.target.value) || 1, availableTickets, MAX_TICKETS));
                setQuantity(v);
              }}
              style={styles.qtyInput}
            />
            <button
              onClick={increase}
              disabled={quantity >= Math.min(availableTickets, MAX_TICKETS)}
              style={styles.qtyBtn}
            >
              +
            </button>
          </div>
        </div>

        <div style={styles.totalBox}>
          <span style={styles.totalLabel}>Total a pagar:</span>
          <span style={styles.totalValue}>
            {total.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}
          </span>
        </div>

        {message && <div style={styles.message}>{message}</div>}
        {error && <div style={styles.error}>{error}</div>}

        <button
          onClick={handleBuy}
          disabled={loading || quantity === 0}
          style={styles.buyBtn}
        >
          {loading ? 'Procesando…' : 'Continuar al pago'}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', maxWidth: 600, margin: '0 auto' },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  backBtn: {
    background: 'none',
    border: '1px solid #d1d5db',
    padding: '10px 20px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
  },
  title: { margin: 0, fontSize: 28, color: '#111827' },
  eventInfo: {
    marginBottom: 24,
    padding: 16,
    background: '#f3f4f6',
    borderRadius: 10,
    color: '#6b7280',
    fontSize: 14,
  },
  card: {
    padding: 32,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: 20,
    color: '#111827',
    fontWeight: 700,
  },
  availableText: {
    margin: '0 0 24px 0',
    fontSize: 16,
    color: '#374151',
  },
  priceBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 0',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: 24,
  },
  priceLabel: { fontSize: 16, color: '#6b7280' },
  priceValue: { fontSize: 20, fontWeight: 700, color: '#111827' },
  quantityControl: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 24,
  },
  quantityLabel: { fontSize: 16, color: '#374151', fontWeight: 600 },
  quantitySelector: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  qtyBtn: {
    padding: '10px 16px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    width: 48,
  },
  qtyInput: {
    width: 64,
    padding: '10px 12px',
    fontSize: 18,
    fontWeight: 700,
    textAlign: 'center',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    color: '#111827',
  },
  totalBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 0',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: 28,
  },
  totalLabel: { fontSize: 16, color: '#6b7280' },
  totalValue: { fontSize: 22, fontWeight: 800, color: '#111827' },
  message: {
    marginBottom: 16,
    padding: 12,
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 6,
    fontSize: 14,
  },
  error: {
    marginBottom: 16,
    padding: 12,
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 6,
    fontSize: 14,
  },
  buyBtn: {
    width: '100%',
    padding: '16px 24px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 10,
    fontSize: 17,
    fontWeight: 600,
    cursor: 'pointer',
  },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: '#6b7280',
    fontSize: 18,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: '#6b7280',
    fontSize: 18,
  },
};
