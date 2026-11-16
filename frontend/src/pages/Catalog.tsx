import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
          <Button
            type="button"
            onClick={() => {
              localStorage.removeItem('flashtix_token');
              localStorage.removeItem('flashtix_user');
              navigate('/login');
            }}
            variant="danger"
            style={styles.logoutBtn}
          >
            Cerrar sesión
          </Button>
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
            <Button
              onClick={() => navigate(`/events/${event.eventId}/seats`)}
              variant="primary"
              disabled={event.status !== 'ON_SALE'}
              style={styles.viewSeatsBtn}
            >
              Ver asientos
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', background: colors.background, color: colors.text, minHeight: '100vh' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: { margin: 0, fontSize: 32, color: colors.text },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    color: colors.text,
  },
  eventsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 24,
  },
  eventCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: 24,
    background: colors.surface,
  },
  eventInfo: { marginBottom: 20 },
  eventName: { margin: 0, fontSize: 20, color: colors.text },
  eventArtist: { margin: 4, color: colors.muted },
  eventVenue: { margin: 4, color: colors.text },
  eventDate: { margin: 4, color: colors.muted },
  statusBadge: {
    display: 'inline-block',
    marginTop: 8,
    padding: '4px 10px',
    background: colors.accent,
    color: '#15042D',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    border: `1px solid ${colors.border}`,
  },
  viewSeatsBtn: {
    width: '100%',
    padding: 12,
    fontSize: 16,
    fontWeight: 600,
  },
  logoutBtn: {
    padding: '8px 16px',
    fontSize: 14,
  },
};
