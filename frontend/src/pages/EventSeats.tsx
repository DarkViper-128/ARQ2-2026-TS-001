import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

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

/** A seat exactly as the Catalog Service reports it (spec.md, GET /events/{id}/seats). */
interface Seat {
  seatId: string;
  section: string;
  row: string;
  number: string;
  category: string;
  status: 'AVAILABLE' | 'HELD' | 'SOLD';
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
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!eventId) return;
    // The seat map comes from the catalog. It used to be generated here with ids like
    // "A-001", which do not exist and which the Reservation Service rejects with 400.
    Promise.all([
      api.get(`/events/${eventId}`, token),
      api.get(`/events/${eventId}/seats`, token),
    ])
      .then(([eventData, seatData]: [Event, { seats: Seat[] }]) => {
        setEvent(eventData);
        setSeats(Array.isArray(seatData?.seats) ? seatData.seats : []);
        // Drop any selection that somebody else took while this page was open.
        setSelectedSeats((prev) =>
          prev.filter((id) =>
            (seatData?.seats ?? []).some((s) => s.seatId === id && s.status === 'AVAILABLE'),
          ),
        );
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
  const takenCount = seats.filter((s) => s.status !== 'AVAILABLE').length;

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <Button type="button" onClick={() => navigate('/')} variant="ghost" style={styles.backBtn}>← Eventos</Button>
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
              const selected = isSelected(seat.seatId);
              const taken = seat.status !== 'AVAILABLE';
              const hover = !taken && !loading && hoveredSeat === seat.seatId;
              return (
                <button
                  key={seat.seatId}
                  onClick={taken ? undefined : () => toggleSeat(seat.seatId)}
                  onMouseEnter={taken || loading ? undefined : () => setHoveredSeat(seat.seatId)}
                  onMouseLeave={taken || loading ? undefined : () => setHoveredSeat(null)}
                  disabled={taken || loading}
                  style={{
                    ...styles.seatBtn,
                    ...(selected ? styles.seatSelected : {}),
                    ...(taken ? styles.seatTaken : {}),
                    ...(hover ? { transform: 'translateY(-1px)', opacity: 0.92 } : {}),
                    transition: 'transform 0.15s, opacity 0.15s',
                  }}
                  title={`Asiento ${seat.seatId} (${seat.category}) - ${seat.status}`}
                >
                  {seat.number}
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

        <Button
          onClick={handleBuy}
          disabled={loading || selectedSeats.length === 0 || selectedSeats.length > MAX_TICKETS}
          variant="primary"
          style={styles.buyBtn}
        >
          {loading ? 'Procesando…' : 'Continuar al pago'}
        </Button>
        <p style={styles.hint}>
          Máximo {MAX_TICKETS} boletas por compra. Haz clic en un asiento para seleccionarlo o deseleccionarlo.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', maxWidth: 1200, margin: '0 auto', background: colors.background, color: colors.text },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
  },
  title: { margin: 0, fontSize: 28, color: colors.text },
  eventInfo: {
    marginBottom: 24,
    padding: 16,
    background: colors.background,
    borderRadius: 10,
    color: colors.muted,
    fontSize: 14,
  },
  card: {
    padding: 40,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: 20,
    color: colors.text,
    fontWeight: 700,
  },
  availableText: {
    margin: '0 0 24px 0',
    fontSize: 16,
    color: colors.muted,
  },
  priceBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 0',
    borderBottom: `1px solid ${colors.border}`,
    marginBottom: 24,
  },
  priceLabel: { fontSize: 16, color: colors.muted },
  priceValue: { fontSize: 20, fontWeight: 700, color: colors.text },
  seatMapWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 32,
  },
  stageLabel: {
    marginBottom: 16,
    padding: '6px 16px',
    background: colors.surface,
    color: colors.muted,
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    border: `1px solid ${colors.border}`,
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
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    color: colors.muted,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatSelected: {
    background: colors.primary,
    borderColor: colors.primary,
    color: '#ffffff',
  },
  seatTaken: {
    background: colors.muted,
    borderColor: colors.muted,
    color: '#6b7280',
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
    borderBottom: `1px solid ${colors.border}`,
    marginBottom: 28,
  },
  totalLabel: { fontSize: 16, color: colors.muted },
  totalValue: { fontSize: 22, fontWeight: 800, color: colors.text },
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
  buyBtn: {
    width: '100%',
    padding: '16px 24px',
    fontSize: 17,
    fontWeight: 600,
  },
  hint: {
    margin: 0,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: colors.muted,
    fontSize: 18,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: colors.muted,
    fontSize: 18,
  },
};

function getLegendItemStyle(selected: boolean, taken: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: colors.muted,
    ...(selected ? { color: colors.primary } : {}),
    ...(taken ? { color: colors.muted } : {}),
  };
}
