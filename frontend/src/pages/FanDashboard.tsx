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
  container: { padding: 32, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#0f172a', color: '#f1f5f9' },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    fontSize: 18,
    color: '#94a3b8',
  },
  error: {
    padding: 24,
    background: '#450a0a',
    color: '#fca5a5',
    borderRadius: 8,
    margin: 24,
    border: '1px solid #7f1d1d',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
    paddingRight: 20,
  },
  welcome: {},
  title: { margin: '0 0 4px 0', fontSize: 28, color: '#ffffff' },
  subtitle: { margin: 0, color: '#94a3b8', fontSize: 14 },
  roleChip: {
    padding: '8px 16px',
    background: '#1e3a8a',
    color: '#bfdbfe',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid #3b82f6',
  },
  errorBanner: {
    marginBottom: 16,
    padding: 12,
    background: '#7f1d1d',
    color: '#fecaca',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #b91c1c',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 24,
    marginBottom: 40,
  },
  statCard: {
    padding: 24,
    background: '#1e293b',
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    border: '1px solid #334155',
  },
  statIcon: { fontSize: 32 },
  statValue: { fontSize: 28, fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0' },
  statLabel: { margin: 0, fontSize: 13, color: '#94a3b8' },
  section: { marginBottom: 32 },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: { margin: 0, fontSize: 20, color: '#ffffff' },
  syncBadge: {
    padding: '4px 10px',
    background: '#064e3b',
    color: '#6ee7b7',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    border: '1px solid #10b981',
  },
  empty: {
    padding: 48,
    textAlign: 'center',
    color: '#94a3b8',
    background: '#1e293b',
    borderRadius: 12,
    border: '1px solid #334155',
  },
  eventGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 24,
  },
  eventCard: {
    border: '1px solid #334155',
    borderRadius: 16,
    padding: 24,
    background: '#1e293b',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  eventInfo: { marginBottom: 8 },
  eventName: { margin: '0 0 8px 0', fontSize: 20, color: '#ffffff', fontWeight: 600 },
  eventArtist: { margin: '0 0 8px 0', color: '#94a3b8', fontSize: 15 },
  eventVenue: { margin: '0 0 8px 0', color: '#cbd5e1', fontSize: 14 },
  eventDate: { margin: 0, color: '#64748b', fontSize: 13 },
  viewBtn: {
    marginTop: 12,
    width: '100%',
    padding: 14,
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(37, 99, 235, 0.3)',
  },
  ticketGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 20,
  },
  ticketCard: {
    padding: 20,
    background: '#1e293b',
    border: '2px solid #2563eb',
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
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
    background: '#1e3a8a',
    color: '#bfdbfe',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  qrArea: {
    height: 80,
    background: '#0f172a',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    border: '1px solid #334155',
  },
  qrPlaceholder: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    maxWidth: '100%',
    wordBreak: 'break-all',
  },
  ticketInfo: { display: 'flex', flexDirection: 'column', gap: 6 },
  ticketText: { margin: 0, fontSize: 14, color: '#cbd5e1' },
  downloadLink: {
    color: '#2563eb',
    textDecoration: 'none',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
