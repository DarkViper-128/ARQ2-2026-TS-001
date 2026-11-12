import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';
import { extractList } from '../lib/apiHelper';

interface Event {
  eventId: string;
  name: string;
  artist: string;
  venue: { name: string; city: string };
  startsAt: string;
  saleStartsAt: string;
  status: string;
}

const POLL_INTERVAL = 5000; // 5 segundos para sincronización en tiempo real

export default function FanDashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    const loadEvents = async () => {
      try {
        const data = await api.get('/events', token);
        const list = extractList<Event>(data);
        if (!cancelled) setEvents(list);
      } catch (err: any) {
        if (!cancelled && err.message === 'UNAUTHENTICATED') {
          localStorage.removeItem('flashtix_token');
          localStorage.removeItem('flashtix_user');
          navigate('/login');
        } else if (!cancelled) {
          setApiErrors((prev) => ({ ...prev, events: err.message || 'Error cargando eventos' }));
        }
      }
    };

    const refresh = () => {
      loadEvents();
    };

    refresh();
    timer = setInterval(refresh, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [token, navigate, user]);

  const availableEvents = events.filter((e) => e.status === 'ON_SALE');

  const handleBuyTicket = (eventId: string) => {
    navigate(`/events/${eventId}/seats`);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.welcome}>
          <h1 style={styles.title}>Bienvenido, {user?.username}</h1>
          <p style={styles.subtitle}>
            Explora eventos y gestiona tus boletos. Los datos se actualizan en tiempo real.
          </p>
        </div>
        <div style={styles.roleChip}>
          <span style={styles.roleText}>Rol: FAN</span>
        </div>
      </header>

      {apiErrors.events && <div style={styles.errorBanner}>Eventos: {apiErrors.events}</div>}

      {/* Resumen */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🎟️</div>
          <div style={styles.statValue}>{availableEvents.length}</div>
          <div style={styles.statLabel}>Eventos disponibles</div>
        </div>
      </div>

      {/* Eventos disponibles (sincronizados en tiempo real con el organizador) */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Eventos Disponibles</h2>
          <span style={styles.syncBadge}>🔄 Tiempo real</span>
        </div>
        {availableEvents.length === 0 ? (
          <div style={styles.empty}>
            No hay eventos disponibles en este momento.
          </div>
        ) : (
          <div style={styles.eventGrid}>
            {availableEvents.map((event) => (
              <div key={event.eventId} style={styles.eventCard}>
                <div style={styles.eventInfo}>
                  <h3 style={styles.eventName}>{event.name}</h3>
                  <p style={styles.eventArtist}>{event.artist}</p>
                  <p style={styles.eventVenue}>
                    {event.venue.name} · {event.venue.city}
                  </p>
                  <p style={styles.eventDate}>
                    📅 {new Date(event.startsAt).toLocaleDateString('es-CO', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <button onClick={() => handleBuyTicket(event.eventId)} style={styles.viewBtn}>
                  Crear Boleto
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 0, fontFamily: 'system-ui, sans-serif', minHeight: '100vh' },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    fontSize: 18,
    color: '#6b7280',
  },
  error: {
    padding: 24,
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 8,
    margin: 24,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 32,
    paddingRight: 20,
  },
  welcome: {},
  title: { margin: '0 0 4px 0', fontSize: 28, color: '#111827' },
  subtitle: { margin: 0, color: '#6b7280', fontSize: 14 },
  roleChip: {
    padding: '8px 16px',
    background: '#dbeafe',
    color: '#1e40af',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
  },
  errorBanner: {
    marginBottom: 16,
    padding: 12,
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 32,
  },
  statCard: {
    padding: 20,
    background: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  statIcon: { fontSize: 32 },
  statValue: { fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 4px 0' },
  statLabel: { margin: 0, fontSize: 13, color: '#6b7280' },
  section: { marginBottom: 32 },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: { margin: 0, fontSize: 20, color: '#111827' },
  syncBadge: {
    padding: '4px 10px',
    background: '#059669',
    color: '#ffffff',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  empty: {
    padding: 32,
    textAlign: 'center',
    color: '#6b7280',
    background: '#f9fafb',
    borderRadius: 8,
  },
  eventGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 20,
  },
  eventCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 20,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
  },
  eventInfo: { marginBottom: 16 },
  eventName: { margin: '0 0 6px 0', fontSize: 18, color: '#111827' },
  eventArtist: { margin: '0 0 6px 0', color: '#6b7280', fontSize: 14 },
  eventVenue: { margin: '0 0 6px 0', color: '#374151', fontSize: 14 },
  eventDate: { margin: 0, color: '#6b7280', fontSize: 13 },
  viewBtn: {
    marginTop: 8,
    width: '100%',
    padding: 10,
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  ticketGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 20,
  },
  ticketCard: {
    padding: 20,
    background: '#ffffff',
    border: '2px solid #2563eb',
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  },
  ticketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  ticketBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: '#2563eb',
    textTransform: 'uppercase',
  },
  seatId: {
    padding: '4px 10px',
    background: '#dbeafe',
    color: '#1e40af',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  qrArea: {
    height: 80,
    background: '#f3f4f6',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  qrPlaceholder: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    maxWidth: '100%',
    wordBreak: 'break-all',
  },
  ticketInfo: { display: 'flex', flexDirection: 'column', gap: 6 },
  ticketText: { margin: 0, fontSize: 14, color: '#374151' },
  downloadLink: {
    color: '#2563eb',
    textDecoration: 'none',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
