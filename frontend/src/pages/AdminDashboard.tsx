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

interface Order {
  orderId: string;
  userId: string;
  eventId: string;
  status: string;
  total: { amount: number; currency: string };
  seats: Array<{ seatId: string; category: string }>;
  createdAt: string;
}

interface ErrorEntry {
  operation: string;
  message: string;
  timestamp: string;
}

interface SuccessStats {
  eventsCreated: number;
  eventsPublished: number;
  ordersConfirmed: number;
  refundsRequested: number;
}

const POLL_INTERVAL = 5000;
const MAX_ERRORS = 10;

export default function AdminDashboard() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  const [recentErrors, setRecentErrors] = useState<ErrorEntry[]>([]);
  const [successStats, setSuccessStats] = useState<SuccessStats>({
    eventsCreated: 0,
    eventsPublished: 0,
    ordersConfirmed: 0,
    refundsRequested: 0,
  });

  const addError = (operation: string, message: string) => {
    const entry: ErrorEntry = {
      operation,
      message,
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setRecentErrors((prev) => [entry, ...prev].slice(0, MAX_ERRORS));
  };

  const incStat = (key: keyof SuccessStats) => {
    setSuccessStats((prev) => ({ ...prev, [key]: prev[key] + 1 }));
  };

  // Crear evento form state
  const [createForm, setCreateForm] = useState({
    name: '',
    artist: '',
    venueName: '',
    venueCity: '',
    startsAt: '',
    saleStartsAt: '',
    priceCategories: JSON.stringify([
      { category: 'VIP', price: { amount: 45000000, currency: 'COP' } },
    ]),
    seats: JSON.stringify([{ seatId: 'A-01-01', category: 'VIP' }]),
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    const loadEvents = async () => {
      try {
        const data = await api.get('/events', token);
        const list = extractList<Event>(data);
        if (!cancelled) setEvents(list);
        if (!cancelled) setLoading(false);
        if (!cancelled) setApiErrors((prev) => ({ ...prev, events: '' }));
      } catch (err: any) {
        if (!cancelled && err.message === 'UNAUTHENTICATED') {
          localStorage.removeItem('flashtix_token');
          localStorage.removeItem('flashtix_user');
          navigate('/login');
        } else if (!cancelled) {
          setApiErrors((prev) => ({ ...prev, events: err.message || 'Error cargando eventos' }));
          addError('Cargar eventos', err.message || 'Error cargando eventos');
          setLoading(false);
        }
      }
    };

    const loadOrders = async () => {
      try {
        const data = await api.get('/orders', token);
        const list = extractList<Order>(data);
        if (!cancelled) setOrders(list);
        if (!cancelled) setApiErrors((prev) => ({ ...prev, orders: '' }));
      } catch (err: any) {
        if (!cancelled && err.message === 'UNAUTHENTICATED') {
          localStorage.removeItem('flashtix_token');
          localStorage.removeItem('flashtix_user');
          navigate('/login');
        } else if (!cancelled) {
          // Órdenes pueden no estar disponibles para organizador (401) — no es crítico
          setApiErrors((prev) => ({ ...prev, orders: 'Órdenes no disponibles para este rol' }));
          addError('Cargar órdenes', 'Órdenes no disponibles para este rol');
        }
      }
    };

    const refresh = () => {
      loadEvents();
      loadOrders();
    };

    refresh();
    timer = setInterval(refresh, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [token, navigate]);

  const handlePublish = async (eventId: string) => {
    try {
      await api.post(`/admin/events/${eventId}/publish`, {}, token);
      setSuccess('Evento publicado correctamente');
      setApiErrors((prev) => ({ ...prev, publish: '' }));
      incStat('eventsPublished');
      const data = await api.get('/events', token);
      setEvents(extractList<Event>(data));
    } catch (err: any) {
      setApiErrors((prev) => ({ ...prev, publish: err.message || 'Error al publicar' }));
      addError('Publicar evento', err.message || 'Error al publicar');
      setSuccess('');
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este evento?')) return;
    try {
      await api.delete(`/admin/events/${eventId}`, token);
      setSuccess('Evento eliminado correctamente');
      setApiErrors((prev) => ({ ...prev, delete: '' }));
      const data = await api.get('/events', token);
      setEvents(extractList<Event>(data));
    } catch (err: any) {
      setApiErrors((prev) => ({ ...prev, delete: err.message || 'Error al eliminar' }));
      addError('Eliminar evento', err.message || 'Error al eliminar');
      setSuccess('');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setApiErrors((prev) => ({ ...prev, create: '' }));

    try {
      const body = {
        name: createForm.name,
        artist: createForm.artist,
        venue: { name: createForm.venueName, city: createForm.venueCity },
        startsAt: createForm.startsAt,
        saleStartsAt: createForm.saleStartsAt,
        priceCategories: JSON.parse(createForm.priceCategories),
        seats: JSON.parse(createForm.seats),
      };

      await api.post('/admin/events', body, token);
      setSuccess('Evento creado correctamente');
      setApiErrors((prev) => ({ ...prev, create: '' }));
      incStat('eventsCreated');

      setCreateForm({
        name: '',
        artist: '',
        venueName: '',
        venueCity: '',
        startsAt: '',
        saleStartsAt: '',
        priceCategories: JSON.stringify([
          { category: 'VIP', price: { amount: 45000000, currency: 'COP' } },
        ]),
        seats: JSON.stringify([{ seatId: 'A-01-01', category: 'VIP' }]),
      });

      const data = await api.get('/events', token);
      setEvents(extractList<Event>(data));
      setLoading(false);
    } catch (err: any) {
      setApiErrors((prev) => ({ ...prev, create: err.message || 'Error al crear evento' }));
      addError('Crear evento', err.message || 'Error al crear evento');
      setLoading(false);
    }
  };

  const handleRefund = async (orderId: string) => {
    if (!confirm('¿Estás seguro de que quieres reembolsar esta orden?')) return;
    try {
      await api.post(`/admin/orders/${orderId}/refund`, { reason: 'EVENT_CANCELLED' }, token);
      setSuccess('Reembolso solicitado correctamente');
      incStat('refundsRequested');
      const data = await api.get('/orders', token);
      const list = extractList<Order>(data);
      setOrders(list);
    } catch (err: any) {
      setApiErrors((prev) => ({ ...prev, refund: err.message || 'Error al reembolsar' }));
      addError('Reembolsar orden', err.message || 'Error al reembolsar');
      setSuccess('');
    }
  };

  if (loading) return <div style={styles.loader}>Cargando panel de organizador...</div>;

  const draftEvents = events.filter((e) => e.status === 'DRAFT');
  const publishedEvents = events.filter((e) => e.status === 'PUBLISHED');
  const confirmedOrders = orders.filter((o) => o.status === 'CONFIRMED');

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.welcome}>
          <h1 style={styles.title}>Panel Organizador</h1>
          <p style={styles.subtitle}>
            Gestiona tus eventos y visualiza la actividad de la plataforma
          </p>
        </div>
        <div style={styles.roleChip}>
          <span style={styles.roleText}>Rol: ORGANIZADOR</span>
        </div>
      </header>

      {success && <div style={styles.successBanner}>{success}</div>}
      {error && <div style={styles.errorBanner}>{error}</div>}
      {apiErrors.create && <div style={styles.errorBanner}>Crear evento: {apiErrors.create}</div>}
      {apiErrors.publish && <div style={styles.errorBanner}>Publicar: {apiErrors.publish}</div>}
      {apiErrors.delete && <div style={styles.errorBanner}>Eliminar: {apiErrors.delete}</div>}
      {apiErrors.events && <div style={styles.errorBanner}>{apiErrors.events}</div>}

      {/* Estadísticas */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>📊</div>
          <div style={styles.statValue}>{events.length}</div>
          <div style={styles.statLabel}>Total eventos</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>⏳</div>
          <div style={styles.statValue}>{draftEvents.length}</div>
          <div style={styles.statLabel}>Borradores</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🟢</div>
          <div style={styles.statValue}>{publishedEvents.length}</div>
          <div style={styles.statLabel}>Publicados</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🎫</div>
          <div style={styles.statValue}>{confirmedOrders.length}</div>
          <div style={styles.statLabel}>Órdenes confirmadas</div>
        </div>
      </div>

      {/* Monitoreo en tiempo real */}
      <section style={{ ...styles.card, marginTop: 24 }}>
        <div style={styles.monitorHeader}>
          <h2 style={styles.sectionTitle}>📈 Monitoreo en Tiempo Real</h2>
          <p style={styles.hint}>
            Errores de peticiones del organizador y peticiones completadas con éxito.
          </p>
        </div>
        <div style={styles.monitorColumns}>
          {/* Columna izquierda: errores recientes */}
          <section style={styles.monitorPanel}>
            <h3 style={styles.monitorTitle}>❌ Errores Recientes</h3>
            {recentErrors.length === 0 ? (
              <p style={styles.empty}>Sin errores en las últimas peticiones.</p>
            ) : (
              <div style={styles.errorList}>
                {recentErrors.map((err, i) => (
                  <div key={i} style={styles.errorRow}>
                    <div style={styles.errorOp}>{err.operation}</div>
                    <div style={styles.errorMsg}>{err.message}</div>
                    <div style={styles.errorTime}>{err.timestamp}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Columna derecha: éxitos (gráfico de barras) */}
          <section style={styles.monitorPanel}>
            <h3 style={styles.monitorTitle}>✅ Peticiones Completadas con Éxito</h3>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Eventos creados</span>
              <span style={styles.statValue}>{successStats.eventsCreated}</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Eventos publicados</span>
              <span style={styles.statValue}>{successStats.eventsPublished}</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Órdenes confirmadas</span>
              <span style={styles.statValue}>{confirmedOrders.length}</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Reembolsos solicitados</span>
              <span style={styles.statValue}>{successStats.refundsRequested}</span>
            </div>
            <div style={styles.barChart}>
              {[
                { label: 'Eventos creados', value: successStats.eventsCreated },
                { label: 'Eventos publicados', value: successStats.eventsPublished },
                { label: 'Órdenes confirmadas', value: confirmedOrders.length },
                { label: 'Reembolsos', value: successStats.refundsRequested },
              ].map((item) => (
                <div key={item.label} style={styles.barItem}>
                  <div style={styles.barLabel}>{item.label}</div>
                  <div style={styles.barTrack}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${Math.max(0, Math.min(100, (item.value / Math.max(1, ...Object.values(successStats), confirmedOrders.length))) * 100)}%`,
                      }}
                    />
                  </div>
                  <div style={styles.barValue}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <div style={styles.twoColumns}>
        {/* Columna izquierda: Crear evento */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>➕ Crear Evento</h2>
          <p style={styles.hint}>
            Completa los datos del evento. Los campos de categorías y asientos usan formato JSON.
          </p>
          <form onSubmit={handleCreateEvent} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Nombre del evento</label>
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Ej: World Tour 2026"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Artista</label>
              <input
                type="text"
                value={createForm.artist}
                onChange={(e) => setCreateForm({ ...createForm, artist: e.target.value })}
                placeholder="Ej: The Headliners"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Venue - Nombre</label>
              <input
                type="text"
                value={createForm.venueName}
                onChange={(e) => setCreateForm({ ...createForm, venueName: e.target.value })}
                placeholder="Ej: Estadio El Campín"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Venue - Ciudad</label>
              <input
                type="text"
                value={createForm.venueCity}
                onChange={(e) => setCreateForm({ ...createForm, venueCity: e.target.value })}
                placeholder="Ej: Bogotá"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Fecha y hora del evento (ISO)</label>
              <input
                type="text"
                value={createForm.startsAt}
                onChange={(e) => setCreateForm({ ...createForm, startsAt: e.target.value })}
                placeholder="2026-12-20T23:00:00.000Z"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Fecha de inicio de venta (ISO)</label>
              <input
                type="text"
                value={createForm.saleStartsAt}
                onChange={(e) => setCreateForm({ ...createForm, saleStartsAt: e.target.value })}
                placeholder="2026-11-01T15:00:00.000Z"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Categorías de precio (JSON)</label>
              <textarea
                value={createForm.priceCategories}
                onChange={(e) => setCreateForm({ ...createForm, priceCategories: e.target.value })}
                placeholder='[{"category":"VIP","price":{"amount":45000000,"currency":"COP"}}]'
                style={styles.textarea}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Asientos (JSON)</label>
              <textarea
                value={createForm.seats}
                onChange={(e) => setCreateForm({ ...createForm, seats: e.target.value })}
                placeholder='[{"seatId":"A-01-01","category":"VIP"}]'
                style={styles.textarea}
                required
              />
            </div>
            <button type="submit" style={styles.createBtn}>Crear Evento</button>
          </form>
        </section>

        {/* Columna derecha: Eventos */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>🎪 Mis Eventos</h2>
          {events.length === 0 ? (
            <p style={styles.empty}>No tienes eventos creados.</p>
          ) : (
            <div style={styles.eventList}>
              {events.map((event) => (
                <div key={event.eventId} style={styles.eventRow}>
                  <div style={styles.eventInfo}>
                    <strong style={styles.eventName}>{event.name}</strong>
                    <p style={styles.eventDetail}>
                      {event.venue.name} · {event.venue.city}
                    </p>
                    <p style={styles.eventDetail}>
                      {new Date(event.startsAt).toLocaleDateString('es-CO')}
                    </p>
                  </div>
                  <div style={styles.eventActions}>
                    <span style={getStatusBadgeStyle(event.status)}>{event.status}</span>
                    {event.status === 'DRAFT' && (
                      <button
                        onClick={() => handlePublish(event.eventId)}
                        style={styles.publishBtn}
                      >
                        Publicar
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteEvent(event.eventId)}
                      style={styles.deleteBtn}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Órdenes (si están disponibles) */}
        <section style={{ ...styles.card, marginTop: 24 }}>
          <h2 style={styles.sectionTitle}>💸 Órdenes Recientes</h2>
          {apiErrors.orders && (
            <p style={styles.emptyHint}>{apiErrors.orders}</p>
          )}
          {confirmedOrders.length === 0 && !apiErrors.orders ? (
            <p style={styles.empty}>No hay órdenes confirmadas todavía.</p>
          ) : (
            <div style={styles.orderList}>
              {confirmedOrders.map((order) => (
                <div key={order.orderId} style={styles.orderRow}>
                  <div style={styles.orderInfo}>
                    <strong style={styles.orderIdText}>#{order.orderId.slice(0, 8)}</strong>
                    <p style={styles.orderDetail}>
                      Evento: {order.eventId.slice(0, 8)}...
                    </p>
                    <p style={styles.orderDetail}>
                      Asientos: {order.seats.map((s) => s.seatId).join(', ')}
                    </p>
                    <p style={styles.orderDetail}>
                      {order.total.amount.toLocaleString('es-CO', {
                        style: 'currency',
                        currency: 'COP',
                      })}
                    </p>
                  </div>
                  <div style={styles.orderActions}>
                    <span style={getStatusBadgeStyle(order.status)}>{order.status}</span>
                    {order.status === 'CONFIRMED' && (
                      <button
                        onClick={() => handleRefund(order.orderId)}
                        style={styles.refundBtn}
                        disabled={loading}
                      >
                        Reembolsar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function getStatusBadgeStyle(status: string): React.CSSProperties {
  const colors: Record<string, string> = {
    DRAFT: '#fbbf24',
    PUBLISHED: '#059669',
    ON_SALE: '#2563eb',
    SOLD_OUT: '#9ca3af',
    CANCELLED: '#dc2626',
  };
  return {
    padding: '4px 10px',
    background: colors[status] || '#9ca3af',
    color: '#ffffff',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
  };
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
  successBanner: {
    marginBottom: 16,
    padding: 12,
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
    marginBottom: 24,
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
  twoColumns: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: 24,
  },
  card: {
    background: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: 24,
    marginBottom: 24,
  },
  sectionTitle: { margin: '0 0 12px 0', fontSize: 18, color: '#111827' },
  hint: { margin: '0 0 16px 0', fontSize: 13, color: '#6b7280' },
  empty: { color: '#6b7280', fontSize: 14, margin: 8 },
  emptyHint: { color: '#dc2626', fontSize: 14, margin: 8 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: {
    padding: 10,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
  },
  textarea: {
    padding: 10,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'monospace',
    minHeight: 80,
  },
  createBtn: {
    marginTop: 8,
    padding: 12,
    background: '#059669',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  eventList: { display: 'flex', flexDirection: 'column', gap: 12 },
  orderList: { display: 'flex', flexDirection: 'column', gap: 12 },
  eventRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
  },
  orderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
  },
  eventInfo: { flex: 1 },
  orderInfo: { flex: 1 },
  eventName: { display: 'block', margin: '0 0 4px 0', fontSize: 15, color: '#111827' },
  orderIdText: { display: 'block', margin: '0 0 4px 0', fontSize: 15, color: '#111827' },
  eventDetail: { margin: 0, fontSize: 13, color: '#6b7280' },
  orderDetail: { margin: 0, fontSize: 13, color: '#6b7280' },
  eventActions: { display: 'flex', alignItems: 'center', gap: 8 },
  orderActions: { display: 'flex', alignItems: 'center', gap: 8 },
  publishBtn: {
    padding: '6px 14px',
    background: '#059669',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  deleteBtn: {
    padding: '6px 14px',
    background: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  refundBtn: {
    padding: '6px 14px',
    background: '#d97706',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  monitorHeader: {
    marginBottom: 16,
  },
  monitorColumns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  monitorPanel: {
    background: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: 20,
  },
  monitorTitle: {
    margin: '0 0 12px 0',
    fontSize: 16,
    color: '#111827',
    fontWeight: 600,
  },
  errorList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 300,
    overflowY: 'auto',
  },
  errorRow: {
    display: 'flex',
    gap: 10,
    padding: '8px 10px',
    background: '#fef2f2',
    borderRadius: 6,
    borderLeft: '4px solid #dc2626',
    fontSize: 13,
  },
  errorOp: {
    fontWeight: 600,
    color: '#991b1b',
    minWidth: 130,
    fontSize: 12,
  },
  errorMsg: {
    flex: 1,
    color: '#7f1d1d',
    fontSize: 13,
  },
  errorTime: {
    fontSize: 11,
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
    fontSize: 14,
  },
  barChart: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  barItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  barLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
  },
  barTrack: {
    height: 20,
    background: '#e5e7eb',
    borderRadius: 10,
    overflow: 'hidden',
    width: '100%',
  },
  barFill: {
    height: '100%',
    background: '#2563eb',
    borderRadius: 10,
    transition: 'width 0.3s ease',
  },
  barValue: {
    fontSize: 13,
    fontWeight: 700,
    color: '#111827',
    marginTop: 2,
  },
};
