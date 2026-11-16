import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function Catalog() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/events', token)
      .then((data: Event[]) => setEvents(data))
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

  if (loading) return <div>Cargando eventos...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>FlashTix</h1>
        <div style={styles.userInfo}>
          <span>👤 {user?.username} ({user?.role})</span>
          <button onClick={() => {
            localStorage.removeItem('flashtix_token');
            localStorage.removeItem('flashtix_user');
            navigate('/login');
          }} style={styles.logoutBtn}>Cerrar sesión</button>
        </div>
      </header>

      <div style={styles.eventsGrid}>
        {events.map((event) => (
          <div key={event.eventId} style={styles.eventCard}>
            <div style={styles.eventInfo}>
              <h2 style={styles.eventName}>{event.name}</h2>
              <p style={styles.eventArtist}>{event.artist}</p>
              <p style={styles.eventVenue}>
                {event.venue.name} — {event.venue.city}
              </p>
              <p style={styles.eventDate}>
                📅 {new Date(event.startsAt).toLocaleDateString('es-CO')}
              </p>
              <span style={styles.statusBadge}>{event.status}</span>
            </div>
            <button
              onClick={() => navigate(`/events/${event.eventId}/seats`)}
              style={styles.viewSeatsBtn}
              disabled={event.status !== 'ON_SALE'}
            >
              Ver asientos
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#f1f5f9', minHeight: '100vh' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: { margin: 0, fontSize: 32, color: '#ffffff' },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    color: '#cbd5e1',
  },
  eventsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 24,
  },
  eventCard: {
    border: '1px solid #334155',
    borderRadius: 12,
    padding: 24,
    background: '#1e293b',
  },
  eventInfo: { marginBottom: 20 },
  eventName: { margin: 0, fontSize: 20, color: '#ffffff' },
  eventArtist: { margin: 4, color: '#94a3b8' },
  eventVenue: { margin: 4, color: '#cbd5e1' },
  eventDate: { margin: 4, color: '#94a3b8' },
  statusBadge: {
    display: 'inline-block',
    marginTop: 8,
    padding: '4px 10px',
    background: '#064e3b',
    color: '#6ee7b7',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid #10b981',
  },
  viewSeatsBtn: {
    width: '100%',
    padding: 12,
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  logoutBtn: {
    background: '#ef4444',
    color: '#ffffff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  },
};
