import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';

interface Seat {
  seatId: string;
  category: string;
  status: 'AVAILABLE' | 'HELD' | 'SOLD';
}

interface Event {
  eventId: string;
  name: string;
  artist: string;
  venue: { name: string; city: string };
  startsAt: string;
  saleStartsAt: string;
  status: string;
  priceCategories: Array<{ category: string; price: { amount: number; currency: string } }>;
}

/** Estadio Atanasio Girardot - sección por sección con filas y asientos por fila. */
const STADIUM_SECTIONS: Array<{
  key: string;
  name: string;
  rows: string[];
  seatsPerRow: number;
  category: string;
  price: number;
  currency: string;
}> = [
  { key: 'TRIBUNA', name: 'Tribuna Occidental', rows: ['A', 'B', 'C', 'D', 'E'], seatsPerRow: 12, category: 'VIP', price: 45000000, currency: 'COP' },
  { key: 'OCCIDENTAL', name: 'Occidental Alta', rows: ['F', 'G', 'H', 'I', 'J'], seatsPerRow: 16, category: 'Preferencial', price: 32000000, currency: 'COP' },
  { key: 'ORIENTAL', name: 'Oriental Alta', rows: ['K', 'L', 'M', 'N', 'O'], seatsPerRow: 16, category: 'Preferencial', price: 32000000, currency: 'COP' },
  { key: 'NORTE', name: 'Norte', rows: ['P', 'Q', 'R', 'S'], seatsPerRow: 14, category: 'General', price: 18000000, currency: 'COP' },
  { key: 'SUR', name: 'Sur', rows: ['T', 'U', 'V', 'W'], seatsPerRow: 14, category: 'General', price: 18000000, currency: 'COP' },
];

export default function EventSeats() {
  const { eventId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    const loadEvent = async () => {
      try {
        const data = await api.get(`/events/${eventId}`, token);
        if (!cancelled) setEvent(data as Event);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    };

    const loadSeats = async () => {
      try {
        const data = await api.get(`/events/${eventId}/seats`, token);
        const list = Array.isArray(data) ? data : (data as any).seats || [];
        if (!cancelled) setSeats(list as Seat[]);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadEvent();
    loadSeats();

    return () => {
      cancelled = true;
    };
  }, [eventId, token]);

  /** Mock del Estadio Atanasio Girardot: genera asientos por sección si el backend no los tiene. */
  useEffect(() => {
    if (seats.length === 0 && event) {
      const generated: Seat[] = [];
      for (const section of STADIUM_SECTIONS) {
        for (const row of section.rows) {
          for (let i = 1; i <= section.seatsPerRow; i++) {
            generated.push({
              seatId: `${section.key}-${row}-${i.toString().padStart(2, '0')}`,
              category: section.category,
              status: 'AVAILABLE',
            });
          }
        }
      }
      setSeats(generated);
    }
  }, [seats.length, event]);

  const toggleSeat = useCallback((seatId: string) => {
    setSelected((prev) =>
      prev.includes(seatId) ? prev.filter((s) => s !== seatId) : [...prev, seatId],
    );
  }, []);

  /** WR-3: joins the virtual queue and polls until the fan is ADMITTED. */
  const waitForAdmission = useCallback(async (ticketId: string): Promise<string> => {
    for (let i = 0; i < 30; i++) {
      const turn = await api.get(`/events/${eventId}/queue/${ticketId}`, token);
      if ((turn as any).status === 'ADMITTED') return (turn as any).admissionToken;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('La cola virtual no te admitió a tiempo. Intenta de nuevo.');
  }, [eventId, token]);

  const handleHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0 || selected.length > 6) {
      setMessage('Selecciona entre 1 y 6 asientos');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setMessage('');

      // 1. Join the virtual queue
      const queueRes = await api.post(`/events/${eventId}/queue`, {}, token);
      const ticketId = (queueRes as any).queueTicketId;
      if (!ticketId) throw new Error('No se pudo unir a la cola virtual');

      // 2. Wait until ADMITTED to get the admission token
      const admissionToken = await waitForAdmission(ticketId);

      // 3. Create the hold WITH the admission token (the gateway requires it)
      const holdRes = await api.postWithHeaders(
        '/holds',
        { eventId, seatIds: selected },
        { 'X-Admission-Token': admissionToken },
        token,
      );

      localStorage.setItem('flashtix_hold', JSON.stringify(holdRes));
      localStorage.setItem('flashtix_admission_token', admissionToken);
      navigate('/hold');
    } catch (err: any) {
      setError(err.message || 'No se pudo crear la reserva');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.loader}>
        <div style={styles.spinner}>🎟️</div>
        <div>Cargando asientos del Estadio Atanasio Girardot…</div>
      </div>
    );
  }
  if (error) return <div style={styles.error}>Error: {error}</div>;
  if (!event) return <div style={styles.empty}>Evento no encontrado</div>;

  const available = seats.filter((s) => s.status === 'AVAILABLE');
  const held = seats.filter((s) => s.status === 'HELD');
  const sold = seats.filter((s) => s.status === 'SOLD');
  const selectedSeats = seats.filter((s) => selected.includes(s.seatId));
  const total = selectedSeats.reduce((sum, s) => {
    const sec = STADIUM_SECTIONS.find((s2) => s.seatId.startsWith(s2.key));
    return sum + (sec ? sec.price : 0);
  }, 0);

  const sectionRows: Record<string, JSX.Element> = {};
  for (const section of STADIUM_SECTIONS) {
    const sectionSeats = seats.filter((s) => s.seatId.startsWith(section.key));
    const rowsJSX: JSX.Element[] = [];
    for (const row of section.rows) {
      const rowSeats = sectionSeats.filter((s) => s.seatId.includes(`-${row}-`));
      const seatElements = rowSeats.map((seat) => {
        const isSelected = selected.includes(seat.seatId);
        let color = '#10b981';
        let borderColor = '#059669';
        if (seat.status === 'HELD') { color = '#f59e0b'; borderColor = '#d97706'; }
        if (seat.status === 'SOLD') { color = '#9ca3af'; borderColor = '#9ca3af'; }
        if (isSelected && seat.status === 'AVAILABLE') { color = '#2563eb'; borderColor = '#1d4ed8'; }

        return (
          <div
            key={seat.seatId}
            style={{ ...styles.seat, background: color, border: `2px solid ${borderColor}` }}
            onClick={seat.status === 'AVAILABLE' ? () => toggleSeat(seat.seatId) : undefined}
            title={`${seat.seatId} — ${seat.category} — ${seat.status}`}
          >
            {seat.seatId.split('-').pop()}
          </div>
        );
      });
      rowsJSX.push(
        <div key={row} style={styles.row}>
          <span style={styles.rowLabel}>{row}</span>
          {seatElements}
        </div>
      );
    }
    sectionRows[section.key] = (
      <section key={section.key} style={styles.section}>
        <h3 style={styles.sectionTitle}>{section.name}</h3>
        <div style={styles.rowContainer}>{rowsJSX}</div>
        <p style={styles.sectionPrice}>
          {section.category} · {section.price.toLocaleString('es-CO', { style: 'currency', currency: section.currency })}
        </p>
      </section>
    );
  }

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={() => navigate('/')} style={styles.backBtn}>← Eventos</button>
        <h1 style={styles.title}>{event.name}</h1>
      </nav>

      <div style={styles.eventInfo}>
        <strong>{event.artist}</strong>
        <span> · {event.venue.name}, {event.venue.city}</span>
        <span> · {new Date(event.startsAt).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>

      <div style={styles.stats}>
        <div style={styles.statBox}>
          <div style={styles.statValue}>{available.length}</div>
          <div style={styles.statLabel}>Disponibles</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statValue}>{held.length}</div>
          <div style={styles.statLabel}>Retenidos</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statValue}>{sold.length}</div>
          <div style={styles.statLabel}>Vendidos</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statValue}>{selected.length}</div>
          <div style={styles.statLabel}>Seleccionados</div>
        </div>
      </div>

      <div style={styles.seatMapWrapper}>
        {STADIUM_SECTIONS.map((section) => sectionRows[section.key])}
      </div>

      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendDot, background: '#10b981' }} /> Disponible
        </div>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendDot, background: '#f59e0b' }} /> Retenido
        </div>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendDot, background: '#9ca3af' }} /> Vendido
        </div>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendDot, background: '#2563eb' }} /> Seleccionado
        </div>
      </div>

      {message && <div style={styles.message}>{message}</div>}
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.summary}>
        <div>
          <strong>Asientos seleccionados:</strong> {selected.length}
        </div>
        <div>
          <strong>Total:</strong> {total.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}
        </div>
        <button
          onClick={handleHold}
          disabled={selected.length === 0 || selected.length > 6 || loading}
          style={{
            ...styles.holdBtn,
            opacity: (selected.length === 0 || selected.length > 6 || loading) ? 0.5 : 1,
          }}
        >
          {loading ? 'Procesando reserva…' : 'Reservar asientos'}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', minHeight: '100vh' },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  backBtn: {
    background: 'none',
    border: '1px solid #d1d5db',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  },
  title: { margin: 0, fontSize: 28, color: '#111827' },
  eventInfo: {
    marginBottom: 20,
    padding: 16,
    background: '#f3f4f6',
    borderRadius: 8,
    color: '#6b7280',
    fontSize: 14,
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 16,
    marginBottom: 32,
  },
  statBox: {
    padding: 18,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    textAlign: 'center',
    minWidth: 140,
  },
  statValue: { fontSize: 26, fontWeight: 700, color: '#111827', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#6b7280' },
  seatMapWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
    marginBottom: 24,
  },
  section: {
    width: '100%',
    maxWidth: 900,
    margin: '0 auto',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: 18,
    color: '#111827',
    fontWeight: 700,
    borderBottom: '2px solid #e5e7eb',
    paddingBottom: 8,
  },
  rowContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: {
    width: 24,
    textAlign: 'center',
    fontWeight: 600,
    color: '#6b7280',
    fontSize: 12,
  },
  seat: {
    width: 36,
    height: 36,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#ffffff',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'transform 0.1s, box-shadow 0.1s',
  },
  legend: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: '#374151',
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    display: 'inline-block',
  },
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
  summary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    maxWidth: 600,
    margin: '0 auto',
  },
  holdBtn: {
    padding: '14px 28px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  loader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    gap: 12,
    color: '#6b7280',
  },
  spinner: {
    fontSize: 48,
    animation: 'spin 1s linear infinite',
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
