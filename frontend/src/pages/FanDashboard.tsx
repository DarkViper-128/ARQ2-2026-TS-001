import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';
import { extractList } from '../lib/apiHelper';
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
                <Button onClick={() => handleBuyTicket(event.eventId)} variant="primary" style={styles.viewBtn}>
                  Crear Boleto
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: colors.background, color: colors.text },
  loader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    fontSize: 18,
    color: colors.muted,
  },
  error: {
    padding: 24,
    background: colors.errorBg,
    color: colors.error,
    borderRadius: 8,
    margin: 24,
    border: `1px solid ${colors.errorBorder}`,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
    paddingRight: 20,
  },
  welcome: {},
  title: { margin: '0 0 4px 0', fontSize: 28, color: colors.text },
  subtitle: { margin: 0, color: colors.muted, fontSize: 14 },
  roleChip: {
    padding: '8px 16px',
    background: colors.primary,
    color: '#ffffff',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    border: `1px solid ${colors.border}`,
  },
  roleText: { color: '#ffffff', fontSize: 13, fontWeight: 600 },
  errorBanner: {
    marginBottom: 16,
    padding: 12,
    background: colors.errorBg,
    color: colors.error,
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    border: `1px solid ${colors.errorBorder}`,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 24,
    marginBottom: 40,
  },
  statCard: {
    padding: 24,
    background: colors.surface,
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    border: `1px solid ${colors.border}`,
  },
  statIcon: { fontSize: 32 },
  statValue: { fontSize: 28, fontWeight: 700, color: colors.text, margin: '0 0 4px 0' },
  statLabel: { margin: 0, fontSize: 13, color: colors.muted },
  section: { marginBottom: 32 },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: { margin: 0, fontSize: 20, color: colors.text },
  syncBadge: {
    padding: '4px 10px',
    background: colors.accent,
    color: '#15042D',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    border: `1px solid ${colors.border}`,
  },
  empty: {
    padding: 48,
    textAlign: 'center',
    color: colors.muted,
    background: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
  },
  eventGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 24,
  },
  eventCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: 16,
    padding: 24,
    background: colors.surface,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  eventInfo: { marginBottom: 8 },
  eventName: { margin: '0 0 8px 0', fontSize: 20, color: colors.text, fontWeight: 600 },
  eventArtist: { margin: '0 0 8px 0', color: colors.muted, fontSize: 15 },
  eventVenue: { margin: '0 0 8px 0', color: colors.text, fontSize: 14 },
  eventDate: { margin: 0, color: colors.muted, fontSize: 13 },
  viewBtn: {
    marginTop: 12,
    width: '100%',
    padding: 14,
    fontSize: 16,
    fontWeight: 600,
  },
  ticketGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 20,
  },
  ticketCard: {
    padding: 20,
    background: colors.surface,
    border: `2px solid ${colors.primary}`,
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
    color: colors.primary,
    textTransform: 'uppercase',
  },
  seatId: {
    padding: '4px 10px',
    background: colors.primary,
    color: '#ffffff',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    border: `1px solid ${colors.border}`,
  },
  qrArea: {
    height: 80,
    background: colors.background,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    border: `1px solid ${colors.border}`,
  },
  qrPlaceholder: {
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: '100%',
    wordBreak: 'break-all',
  },
  ticketInfo: { display: 'flex', flexDirection: 'column', gap: 6 },
  ticketText: { margin: 0, fontSize: 14, color: colors.text },
  downloadLink: {
    color: colors.primary,
    textDecoration: 'none',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
