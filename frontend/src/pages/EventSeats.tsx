import { useState, useEffect } from 'react';
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
}

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
    api.get(`/events/${eventId}`, token)
      .then((data: Event) => setEvent(data))
      .catch((err: Error) => setError(err.message));

    api.get(`/events/${eventId}/seats`, token)
      .then((data: Seat[]) => setSeats(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [eventId, token]);

  const toggleSeat = (seatId: string) => {
    setSelected((prev) =>
      prev.includes(seatId) ? prev.filter((s) => s !== seatId) : [...prev, seatId],
    );
  };

  const handleHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0 || selected.length > 6) {
      setMessage('Selecciona entre 1 y 6 asientos');
      return;
    }

    try {
      // 1. Join queue (if not already admitted)
      const queueRes = await api.post(
        `/events/${eventId}/queue`,
        {},
        token,
      );
      const admissionToken = (queueRes as any).admissionToken;

      // 2. Create hold
      // Need admission token header - re-post with it
      const holdRes2 = await api.post(
        '/holds',
        { eventId, seatIds: selected },
        token,
      );

      localStorage.setItem('flashtix_hold', JSON.stringify(holdRes2));
      localStorage.setItem('flashtix_admission_token', admissionToken);
      navigate('/hold');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div>Cargando asientos...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!event) return <div>Evento no encontrado</div>;

  const available = seats.filter((s) => s.status === 'AVAILABLE');
  const held = seats.filter((s) => s.status === 'HELD');
  const sold = seats.filter((s) => s.status === 'SOLD');

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={() => navigate('/')} style={styles.backBtn}>← Eventos</button>
        <h1 style={styles.title}>{event.name}</h1>
      </nav>

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
      </div>

      <div style={styles.seatMap}>
        {seats.map((seat) => {
          const isSelected = selected.includes(seat.seatId);
          let color = '#10b981';
          if (seat.status === 'HELD') color = '#f59e0b';
          if (seat.status === 'SOLD') color = '#9ca3af';

          return (
            <div
              key={seat.seatId}
              style={{
                ...styles.seat,
                background: isSelected ? '#2563eb' : color,
                border: isSelected ? '2px solid #1d4ed8' : '1px solid #9ca3af',
              }}
              onClick={
                seat.status === 'AVAILABLE' ? () => toggleSeat(seat.seatId) : undefined
              }
              title={`${seat.seatId} — ${seat.category} — ${seat.status}`}
            >
              {seat.seatId.replace(/^.*-/, '')}
            </div>
          );
        })}
      </div>

      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.summary}>
        <div>
          <strong>Seleccionados:</strong> {selected.length}
        </div>
        <div>
          <strong>Total:</strong> {selected.length} asiento(s)
        </div>
        <button
          onClick={handleHold}
          disabled={selected.length === 0 || selected.length > 6}
          style={styles.holdBtn}
        >
          Reservar asientos
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif' },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
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
  stats: {
    display: 'flex',
    gap: 16,
    marginBottom: 32,
  },
  statBox: {
    padding: 16,
    background: '#f3f4f6',
    borderRadius: 8,
    minWidth: 100,
    textAlign: 'center',
  },
  statValue: { fontSize: 24, fontWeight: 700, color: '#111827' },
  statLabel: { fontSize: 12, color: '#6b7280' },
  seatMap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(10, 40px)',
    gap: 12,
    marginBottom: 24,
  },
  seat: {
    width: 40,
    height: 40,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 600,
    color: '#ffffff',
    cursor: 'pointer',
    userSelect: 'none',
  },
  message: {
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
    padding: 20,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
  },
  holdBtn: {
    padding: '12px 24px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: (() => 1) as unknown as number,
  },
};
