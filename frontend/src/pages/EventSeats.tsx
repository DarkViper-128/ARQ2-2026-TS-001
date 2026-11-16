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
  totalSeats?: number;
}

interface Seat {
  id: string;
  number: string;
  status: 'available' | 'selected' | 'taken';
}

const PRICE_PER_TICKET = 100; // 100 pesos por boleta
const MAX_TICKETS = 6;
const COLS = 10; // 10 columnas x 10 filas = 100 asientos del auditorio

export default function EventSeats() {
  const { eventId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!eventId) return;
    api.get(`/events/${eventId}`, token)
      .then((data: Event) => {
        setEvent(data);
        const total = data.totalSeats || 100;
        const seatCount = Math.min(total, 100);
        const initial: Seat[] = [];
        for (let i = 1; i <= seatCount; i++) {
          initial.push({ id: `seat-${i}`, number: `A-${String(i).padStart(3, '0')}`, status: 'available' });
        }
        setSeats(initial);
      })
      .catch((err: Error) => setError(err.message));
  }, [eventId, token]);

  const toggleSeat = (seatId: string) => {
    setSelectedSeats((prev) =>
      prev.includes(seatId) ? prev.filter((id) => id !== seatId) : [...prev, seatId]
    );
  };

  const isSelected = (seatId: string) => selectedSeats.includes(seatId);

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

    if (selectedSeats.length === 0) {
      setError('Selecciona al menos un asiento.');
      setLoading(false);
      return;
    }
    if (selectedSeats.length > MAX_TICKETS) {
      setError(`Máximo ${MAX_TICKETS} boletas por compra.`);
      setLoading(false);
      return;
    }

    try {
      // 1. Join the virtual queue
      const queueRes = await api.post(`/events/${eventId}/queue`, {}, token);
      const ticketId = (queueRes as any).queueTicketId;
      if (!ticketId) throw new Error('No se pudo unir a la cola virtual');

      // 2. Wait until ADMITTED to get the admission token
      const admissionToken = await waitForAdmission(ticketId);

      // 3. Create the hold with the selected seats
      const holdRes = await api.postWithHeaders(
        '/holds',
        { eventId, seatIds: selectedSeats },
        { 'X-Admission-Token': admissionToken },
        token,
      );

      localStorage.setItem('flashtix_hold', JSON.stringify(holdRes));
      localStorage.setItem('flashtix_admission_token', admissionToken);

      // 4. Pasarela de pago (Order -> Payment)
      navigate('/order');
    } catch (err: any) {
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

  const total = selectedSeats.length * PRICE_PER_TICKET;
  const takenCount = seats.filter((s) => s.status === 'taken').length;

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
        <h2 style={styles.sectionTitle}>Selecciona tus asientos</h2>
        <p style={styles.availableText}>
          Asientos del auditorio: <strong>{seats.length}</strong> &nbsp;|&nbsp;
          Seleccionados: <strong>{selectedSeats.length}</strong> &nbsp;|&nbsp;
          Ocupados: <strong>{takenCount}</strong>
        </p>

        <div style={styles.priceBox}>
          <span style={styles.priceLabel}>Precio por boleta:</span>
          <span style={styles.priceValue}>
            {PRICE_PER_TICKET.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}
          </span>
        </div>

        <div style={styles.seatMapWrapper}>
          <div style={styles.stageLabel}>ESCENARIO</div>
          <div style={styles.seatMap}>
            {seats.map((seat) => {
              const selected = isSelected(seat.id);
              const taken = seat.status === 'taken';
              return (
                <button
                  key={seat.id}
                  onClick={taken ? undefined : () => toggleSeat(seat.id)}
                  disabled={taken || loading}
                  style={{
                    ...styles.seatBtn,
                    ...(selected ? styles.seatSelected : {}),
                    ...(taken ? styles.seatTaken : {}),
                  }}
                  title={`Asiento ${seat.number}`}
                >
                  {seat.number.slice(-3)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={styles.legend}>
          <span style={getLegendItemStyle(false, false)}>Disponible</span>
          <span style={getLegendItemStyle(true, false)}>Seleccionado</span>
          <span style={getLegendItemStyle(false, true)}>Ocupado</span>
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
          disabled={loading || selectedSeats.length === 0 || selectedSeats.length > MAX_TICKETS}
          style={styles.buyBtn}
        >
          {loading ? 'Procesando…' : 'Continuar al pago'}
        </button>
        <p style={styles.hint}>
          Máximo {MAX_TICKETS} boletas por compra. Haz clic en un asiento para seleccionarlo o deseleccionarlo.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', maxWidth: 1200, margin: '0 auto', background: '#0f172a', color: '#f1f5f9' },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  backBtn: {
    background: 'none',
    border: '1px solid #334155',
    padding: '10px 20px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
    color: '#94a3b8',
  },
  title: { margin: 0, fontSize: 28, color: '#ffffff' },
  eventInfo: {
    marginBottom: 24,
    padding: 16,
    background: '#0f172a',
    borderRadius: 10,
    color: '#94a3b8',
    fontSize: 14,
  },
  card: {
    padding: 40,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: 20,
    color: '#ffffff',
    fontWeight: 700,
  },
  availableText: {
    margin: '0 0 24px 0',
    fontSize: 16,
    color: '#cbd5e1',
  },
  priceBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 0',
    borderBottom: '1px solid #334155',
    marginBottom: 24,
  },
  priceLabel: { fontSize: 16, color: '#94a3b8' },
  priceValue: { fontSize: 20, fontWeight: 700, color: '#ffffff' },
  seatMapWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 32,
  },
  stageLabel: {
    marginBottom: 16,
    padding: '6px 16px',
    background: '#334155',
    color: '#94a3b8',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    border: '1px solid #475569',
  },
  seatMap: {
    display: 'grid',
    gridTemplateColumns: `repeat(${COLS}, 40px)`,
    gap: 10,
    marginBottom: 24,
    justifyContent: 'center',
  },
  seatBtn: {
    width: 40,
    height: 40,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  seatSelected: {
    background: '#2563eb',
    borderColor: '#2563eb',
    color: '#ffffff',
  },
  seatTaken: {
    background: '#475569',
    borderColor: '#64748b',
    color: '#94a3b8',
    cursor: 'not-allowed',
  },
  legend: {
    display: 'flex',
    gap: 16,
    marginBottom: 24,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  totalBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 0',
    borderBottom: '1px solid #334155',
    marginBottom: 28,
  },
  totalLabel: { fontSize: 16, color: '#94a3b8' },
  totalValue: { fontSize: 22, fontWeight: 800, color: '#ffffff' },
  message: {
    marginBottom: 16,
    padding: 12,
    background: '#7f1d1d',
    color: '#fecaca',
    borderRadius: 6,
    fontSize: 14,
    border: '1px solid #b91c1c',
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
  hint: {
    margin: 0,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 16,
  },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: '#94a3b8',
    fontSize: 18,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: '#94a3b8',
    fontSize: 18,
  },
};

function getLegendItemStyle(selected: boolean, taken: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: '#94a3b8',
    ...(selected ? { color: '#2563eb' } : {}),
    ...(taken ? { color: '#64748b' } : {}),
  };
}
