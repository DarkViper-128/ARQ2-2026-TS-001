import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';
import { extractList } from '../lib/apiHelper';

const API_BASE = '/v1';

/** Exactly what the Catalog Service returns (spec.md, GET /events). */
interface Event {
  eventId: string;
  name: string;
  artist: string;
  venue: { venueId: string; name: string; city: string };
  startsAt: string;
  saleStartsAt: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ON_SALE' | 'SOLD_OUT' | 'CANCELLED';
  totalSeats: number;
  priceFrom: { amount: number; currency: string } | null;
}

/** Exactly what the Order Service returns (spec.md, GET /orders). */
interface Order {
  orderId: string;
  userId: string;
  userEmail?: string;
  eventId: string;
  holdId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';
  total: { amount: number; currency: string };
  failureReason: string | null;
  createdAt: string;
}

interface ErrorLog {
  operation: string;
  message: string;
  timestamp: string;
}

const AdminDashboard: React.FC = () => {
  const location = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'my-events' | 'orders' | 'monitoring'>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [myEvents, setMyEvents] = useState<Event[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [stats, setStats] = useState({
    eventsCreated: 0,
    eventsPublished: 0,
    ordersConfirmed: 0,
    refundsRequested: 0,
  });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    artist: '',
    description: '',
    totalSeats: '',
    price: '',
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    totalSeats: '',
    price: '',
  });
  const [message, setMessage] = useState({ text: '', type: 'success' as 'success' | 'error' });
  const [loading, setLoading] = useState(false);
  const [refundSearch, setRefundSearch] = useState('');
  const filteredOrders = orders.filter((o) =>
    refundSearch === '' || o.orderId.toLowerCase().includes(refundSearch.toLowerCase())
  );

  // Sincronizar la ruta de la URL con la tab activa (cada ruta = un dashboard)
  useEffect(() => {
    const path = location.pathname;
    if (path === '/admin/refunds') {
      setActiveTab('orders');
      setShowCreateForm(false);
    } else if (path === '/admin/create') {
      setActiveTab('events');
      setShowCreateForm(true);
    } else {
      // /admin, /admin/events y cualquier otra
      setActiveTab('events');
      setShowCreateForm(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    const t = localStorage.getItem('flashtix_token');
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token, activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      // GET /events answers { events: [...] } while GET /orders answers a bare array.
      // Casting both to an array put an object into state and the render then blew up
      // on events.map. extractList normalises either shape.
      const [eventsRaw, ordersRaw] = await Promise.all([
        apiFetch('/events'),
        apiFetch('/orders'),
      ]);
      const eventsData = extractList<Event>(eventsRaw);
      const ordersData = extractList<Order>(ordersRaw);
      setEvents(eventsData);
      setMyEvents(eventsData.filter((e) => e.status !== 'CANCELLED'));
      setOrders(ordersData);

      setStats({
        eventsCreated: eventsData.length,
        eventsPublished: eventsData.filter((e) => e.status === 'PUBLISHED' || e.status === 'ON_SALE').length,
        ordersConfirmed: ordersData.filter((o) => o.status === 'CONFIRMED').length,
        refundsRequested: ordersData.filter((o) => o.status === 'REFUND_PENDING' || o.status === 'REFUNDED').length,
      });

      const failed = ordersData.filter((o) => o.status === 'FAILED' || o.status === 'CANCELLED');
      setErrorLogs(
        failed
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10)
          .map((o) => ({
            operation: 'Checkout',
            message: o.failureReason || 'Orden cancelada',
            timestamp: o.createdAt,
          }))
      );
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const apiFetch = async (path: string, options: RequestInit = {}): Promise<any> => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Error ${res.status}`);
    }
    return res.json();
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const totalSeats = Math.max(parseInt(createForm.totalSeats) || 10, 1);
      const seats = Array.from({ length: totalSeats }, (_, i) => {
        const section = Math.floor(i / 10) + 1;
        const row = (i % 10) + 1;
        const seatNumber = (i % 10) + 1;
        return {
          seatId: `A-${String(section).padStart(2, '0')}-${String(row).padStart(2, '0')}`,
          section: 'A',
          row: String(row).padStart(2, '0'),
          number: String(seatNumber).padStart(2, '0'),
          category: 'General',
        };
      });
      await apiFetch('/admin/events', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name,
          artist: createForm.artist || createForm.name,
          venue: { name: 'Estadio Local', city: 'Bogota' },
          startsAt: new Date(Date.now() + 86400000 * 30).toISOString(),
          saleStartsAt: new Date(Date.now() + 86400000).toISOString(),
          status: 'DRAFT',
          priceCategories: [{ category: 'General', price: { amount: parseInt(createForm.price) || 100, currency: 'COP' } }],
          seats,
        }),
      });
      setMessage({ text: 'Evento creado en estado DRAFT', type: 'success' });
      setCreating(false);
      setCreateForm({ name: '', artist: '', description: '', totalSeats: '', price: '' });
      setShowCreateForm(false);
      loadData();
    } catch (err: any) {
      setMessage({ text: err.message || 'Error creando evento', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async (eventId: string) => {
    setLoading(true);
    try {
      await apiFetch(`/admin/events/${eventId}/publish`, { method: 'POST' });
      setMessage({ text: 'Evento publicado', type: 'success' });
      loadData();
    } catch (err: any) {
      setMessage({ text: err.message || 'Error publicando', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setLoading(true);
    try {
      const seatsCount = Math.max(parseInt(editForm.totalSeats) || 1, 1);
      await apiFetch(`/admin/events/${editing}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          priceCategories: [{ category: 'General', price: { amount: parseInt(editForm.price) || 100, currency: 'COP' } }],
          seats: Array.from({ length: seatsCount }, (_, i) => ({
            seatId: `A-${Math.floor(i / 10) + 1}-${(i % 10) + 1}`,
            category: 'General',
          })),
        }),
      });
      setEditing(null);
      setMessage({ text: 'Evento actualizado', type: 'success' });
      loadData();
    } catch (err: any) {
      setMessage({ text: err.message || 'Error actualizando evento', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (orderId: string) => {
    if (!confirm('¿Seguro que deseas solicitar el reembolso de esta orden?')) return;
    setLoading(true);
    try {
      await apiFetch(`/admin/orders/${orderId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'EVENT_CANCELLED' }),
      });
      setMessage({ text: 'Reembolso solicitado (transaccional)', type: 'success' });
      loadData();
    } catch (err: any) {
      setMessage({ text: err.message || 'Error solicitando reembolso', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (status: string): React.CSSProperties => {
    switch (status) {
      case 'PUBLISHED': return { background: colors.accent, color: '#15042D', border: `1px solid ${colors.border}` };
      case 'ON_SALE': return { background: colors.primary, color: '#ffffff', border: 'none' };
      case 'DRAFT': return { background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` };
      case 'CANCELLED': return { background: colors.errorBg, color: colors.error, border: `1px solid ${colors.errorBorder}` };
      default: return { background: colors.surface, color: colors.muted, border: `1px solid ${colors.border}` };
    }
  };

  const orderStatusColor = (status: string): React.CSSProperties => {
    switch (status) {
      case 'CONFIRMED': return { background: colors.accent, color: '#15042D', border: `1px solid ${colors.border}` };
      case 'PENDING': return { background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` };
      case 'FAILED': return { background: colors.errorBg, color: colors.error, border: `1px solid ${colors.errorBorder}` };
      case 'CANCELLED': return { background: colors.surface, color: colors.muted, border: `1px solid ${colors.border}` };
      case 'REFUND_PENDING': return { background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` };
      case 'REFUNDED': return { background: colors.primary, color: '#ffffff', border: 'none' };
      default: return { background: colors.surface, color: colors.muted, border: `1px solid ${colors.border}` };
    }
  };

  return (
    <div style={styles.root}>
      <div style={styles.headerBar}>
        <div>
          <h1 style={styles.title}>Panel Organizador</h1>
          <p style={styles.subtitle}>Gestiona tus eventos, ordenes y monitorea la plataforma</p>
        </div>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            localStorage.removeItem('flashtix_token');
            window.location.href = '/';
          }}
          style={styles.logoutBtn}
        >
          Cerrar sesion
        </Button>
      </div>

      {message.text && (
        <div style={{ ...styles.messageBanner, ...(message.type === 'success' ? styles.messageSuccess : styles.messageError) }}>
          {message.text}
        </div>
      )}

      <div style={styles.tabBar}>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setActiveTab('events');
            setShowCreateForm(false);
          }}
          style={{ ...styles.tabBtn, ...(activeTab === 'events' ? styles.tabBtnActive : {}) }}
        >
          Todos los Eventos
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setActiveTab('my-events');
            setShowCreateForm(false);
          }}
          style={{ ...styles.tabBtn, ...(activeTab === 'my-events' ? styles.tabBtnActive : {}) }}
        >
          Mis Eventos
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setActiveTab('orders');
            setShowCreateForm(false);
          }}
          style={{ ...styles.tabBtn, ...(activeTab === 'orders' ? styles.tabBtnActive : {}) }}
        >
          Ordenes
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setActiveTab('monitoring');
            setShowCreateForm(false);
          }}
          style={{ ...styles.tabBtn, ...(activeTab === 'monitoring' ? styles.tabBtnActive : {}) }}
        >
          Monitoreo
        </Button>
      </div>

      {activeTab === 'events' && (
        <div>
          <Button
            type="button"
            variant="primary"
            onClick={() => setShowCreateForm(!showCreateForm)}
            style={styles.createEventBtn}
          >
            {showCreateForm ? 'Ocultar formulario' : '+'} Crear Evento
          </Button>

          {showCreateForm && (
            <div style={styles.createFormCard}>
              <h2 style={styles.formTitle}>Crear Evento</h2>
              <form onSubmit={handleCreateEvent} style={styles.createForm}>
                <div style={styles.formFull}>
                  <label style={styles.formLabel}>Nombre del evento</label>
                  <input
                    style={styles.formInput}
                    placeholder="Ej. Concierto Rock 2026"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    required
                  />
                </div>
                <div style={styles.formFull}>
                  <label style={styles.formLabel}>Artista</label>
                  <input
                    style={styles.formInput}
                    placeholder="Ej. The Headliners"
                    value={createForm.artist}
                    onChange={(e) => setCreateForm({ ...createForm, artist: e.target.value })}
                    required
                  />
                </div>
                <div style={styles.formFull}>
                  <label style={styles.formLabel}>Descripcion</label>
                  <input
                    style={styles.formInput}
                    placeholder="Descripcion del evento"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  />
                </div>
                <div style={styles.formHalf}>
                  <label style={styles.formLabel}>Boletas disponibles</label>
                  <input
                    type="number"
                    style={styles.formInput}
                    placeholder="Ej. 200"
                    value={createForm.totalSeats}
                    onChange={(e) => setCreateForm({ ...createForm, totalSeats: e.target.value })}
                    required
                  />
                </div>
                <div style={styles.formHalf}>
                  <label style={styles.formLabel}>Costo por boleta (COP)</label>
                  <input
                    type="number"
                    style={styles.formInput}
                    placeholder="Ej. 45000"
                    value={createForm.price}
                    onChange={(e) => setCreateForm({ ...createForm, price: e.target.value })}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={creating || loading}
                  variant="primary"
                  style={styles.createSubmitBtn}
                >
                  {creating ? 'Creando...' : 'Crear Evento'}
                </Button>
              </form>
            </div>
          )}

          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Eventos del Sistema</h2>
            </div>
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead style={styles.tableHead}>
                  <tr style={styles.tableRow}>
                    <th style={styles.tableCell}>Nombre</th>
                    <th style={styles.tableCell}>Descripcion</th>
                    <th style={styles.tableCell}>Boletas</th>
                    <th style={styles.tableCell}>Precio</th>
                    <th style={styles.tableCell}>Estado</th>
                    <th style={styles.tableCell}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.eventId} style={styles.tableRow}>
                      <td style={styles.tableCell}>{event.name}</td>
                      <td style={{ ...styles.tableCell, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {event.artist} · {event.venue?.name ?? '—'}
                      </td>
                      <td style={styles.tableCell}>{event.totalSeats ?? 0}</td>
                      <td style={styles.tableCell}>
                        {event.priceFrom
                          ? `$${event.priceFrom.amount.toLocaleString()} ${event.priceFrom.currency}`
                          : '—'}
                      </td>
                      <td style={styles.tableCell}>
                        <span style={{ ...styles.badge, ...statusColor(event.status) }}>{event.status}</span>
                      </td>
                      <td style={styles.tableCell}>
                        {event.status === 'DRAFT' && (
                          <Button
                            type="button"
                            onClick={() => handlePublish(event.eventId)}
                            disabled={loading}
                            variant="primary"
                            style={styles.tableBtn}
                          >
                            Publicar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ ...styles.tableCell, padding: 32, textAlign: 'center', color: colors.muted }}>
                        No hay eventos creados aun.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'my-events' && (
        <div>
          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Mis Eventos</h2>
            </div>
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead style={styles.tableHead}>
                  <tr style={styles.tableRow}>
                    <th style={styles.tableCell}>Nombre</th>
                    <th style={styles.tableCell}>Descripcion</th>
                    <th style={styles.tableCell}>Boletas</th>
                    <th style={styles.tableCell}>Precio</th>
                    <th style={styles.tableCell}>Estado</th>
                    <th style={styles.tableCell}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {myEvents.map((event) => (
                    <tr key={event.eventId} style={styles.tableRow}>
                      <td style={styles.tableCell}>{event.name}</td>
                      <td style={{ ...styles.tableCell, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {event.artist} · {event.venue?.name ?? '—'}
                      </td>
                      <td style={styles.tableCell}>{event.totalSeats ?? 0}</td>
                      <td style={styles.tableCell}>
                        {event.priceFrom
                          ? `$${event.priceFrom.amount.toLocaleString()} ${event.priceFrom.currency}`
                          : '—'}
                      </td>
                      <td style={styles.tableCell}>
                        <span style={{ ...styles.badge, ...statusColor(event.status) }}>{event.status}</span>
                      </td>
                      <td style={styles.tableCell}>
                        {editing === event.eventId ? (
                          <form onSubmit={handleUpdateEvent} style={styles.editForm}>
                            <input
                              style={styles.editInput}
                              value={editForm.name}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              required
                            />
                            <input
                              style={styles.editInput}
                              value={editForm.description}
                              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            />
                            <input
                              type="number"
                              style={styles.editInputSmall}
                              value={editForm.totalSeats}
                              onChange={(e) => setEditForm({ ...editForm, totalSeats: e.target.value })}
                              required
                            />
                            <input
                              type="number"
                              style={styles.editInputSmall}
                              value={editForm.price}
                              onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                              required
                            />
                            <Button type="submit" disabled={loading} variant="primary" style={styles.editBtn}>
                              Guardar
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setEditing(null)} style={styles.editCancelBtn}>
                              Cancelar
                            </Button>
                          </form>
                        ) : (
                          <>
                            {event.status === 'DRAFT' && (
                              <Button
                                type="button"
                                onClick={() => {
                                  setEditing(event.eventId);
                                  setEditForm({
                                    name: event.name,
                                    description: event.artist,
                                    totalSeats: String(event.totalSeats ?? 0),
                                    price: String(event.priceFrom?.amount ?? 0),
                                  });
                                }}
                                variant="primary"
                                style={styles.tableBtn}
                              >
                                Editar
                              </Button>
                            )}
                            {event.status === 'DRAFT' && (
                              <Button
                                type="button"
                                onClick={() => handlePublish(event.eventId)}
                                disabled={loading}
                                variant="primary"
                                style={{ ...styles.tableBtn, marginLeft: 8 }}
                              >
                                Publicar
                              </Button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {myEvents.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ ...styles.tableCell, padding: 32, textAlign: 'center', color: colors.muted }}>
                        No tienes eventos creados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div>
          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div style={styles.ordersSearchBar}>
                <div>
                  <h2 style={styles.sectionTitle}>Ordenes del Sistema</h2>
                  <p style={styles.subtitle}>Busca por ID de transacción para reembolsar</p>
                </div>
                <div style={styles.searchInputWrap}>
                  <input
                    type="text"
                    placeholder="ID de transacción (order_id)"
                    value={refundSearch}
                    onChange={(e) => setRefundSearch(e.target.value)}
                    style={styles.searchInput}
                  />
                </div>
              </div>
            </div>
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead style={styles.tableHead}>
                  <tr style={styles.tableRow}>
                    <th style={styles.tableCell}>ID de Transacción</th>
                    <th style={styles.tableCell}>Usuario</th>
                    <th style={styles.tableCell}>Monto</th>
                    <th style={styles.tableCell}>Estado</th>
                    <th style={styles.tableCell}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr key={order.orderId} style={styles.tableRow}>
                      <td style={styles.tableCell}>{order.orderId}</td>
                      <td style={styles.tableCell}>{order.userEmail ?? order.userId}</td>
                      <td style={styles.tableCell}>${order.total.amount.toLocaleString()} COP</td>
                      <td style={styles.tableCell}>
                        <span style={{ ...styles.badge, ...orderStatusColor(order.status) }}>{order.status}</span>
                      </td>
                      <td style={styles.tableCell}>
                        {order.status === 'CONFIRMED' && (
                          <Button
                            type="button"
                            onClick={() => handleRefund(order.orderId)}
                            disabled={loading}
                            variant="danger"
                            style={styles.tableBtn}
                          >
                            Reembolsar
                          </Button>
                        )}
                        {order.status !== 'CONFIRMED' && (
                          <span style={{ ...styles.badge, color: colors.muted, background: 'transparent', border: 'none' }}>No reembolsable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...styles.tableCell, padding: 32, textAlign: 'center', color: colors.muted }}>
                        No hay ordenes registradas con ese ID de transacción.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'monitoring' && (
        <div style={styles.monitoringGrid}>
          {/* Grafico 1: Errores en la compra */}
          <div style={styles.monitoringCard}>
            <div style={styles.monitoringCardHeader}>
              <h2 style={styles.monitoringCardTitle}>Errores en la Compra</h2>
              <span style={styles.statPill}>{errorLogs.length}</span>
            </div>
            <div style={styles.monitoringList}>
              {errorLogs.length === 0 ? (
                <div style={styles.emptyState}>Sin errores de compra recientes</div>
              ) : (
                errorLogs.map((err, i) => (
                  <div key={i} style={styles.errorLogItem}>
                    <div>
                      <p style={styles.errorLogOp}>{err.operation}</p>
                      <p style={styles.errorLogMsg}>{err.message}</p>
                    </div>
                    <span style={styles.errorLogTime}>{new Date(err.timestamp).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Grafico 2: Compras de boletos exitosas */}
          <div style={styles.monitoringCardWide}>
            <div style={styles.monitoringCardHeader}>
              <h2 style={styles.monitoringCardTitle}>Compras de Boletos Exitosas</h2>
              <span style={styles.statPill}>{stats.ordersConfirmed}</span>
            </div>
            <div style={styles.statTiles}>
              <div style={styles.statTile}>
                <div style={styles.statValue}>{stats.ordersConfirmed}</div>
                <div style={styles.statLabel}>Ordenes confirmadas</div>
              </div>
              <div style={styles.statTile}>
                <div style={styles.statValue}>{stats.eventsPublished}</div>
                <div style={styles.statLabel}>Eventos publicados</div>
              </div>
              <div style={styles.statTile}>
                <div style={styles.statValue}>{stats.eventsCreated}</div>
                <div style={styles.statLabel}>Eventos creados</div>
              </div>
              <div style={styles.statTile}>
                <div style={styles.statValue}>{stats.refundsRequested}</div>
                <div style={styles.statLabel}>Reembolsos solicitados</div>
              </div>
            </div>
            <div style={styles.chartWrap}>
              <svg style={styles.chartSvg} viewBox="0 0 700 350">
                <defs>
                  <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop stopColor={colors.primary} stopOpacity={1} offset="0%" />
                    <stop stopColor={colors.primary} stopOpacity={1} offset="100%" />
                  </linearGradient>
                </defs>
                <rect x="60" y="120" width="140" height="160" fill="url(#grad1)" rx="10" />
                <rect x="230" y="60" width="140" height="220" fill="url(#grad1)" rx="10" />
                <rect x="400" y="170" width="140" height="100" fill="url(#grad1)" rx="10" />
                <rect x="570" y="90" width="140" height="140" fill="url(#grad1)" rx="10" />
                <text x="130" y="310" textAnchor="middle" fontSize="14" fill={colors.muted}>Confirmadas</text>
                <text x="300" y="310" textAnchor="middle" fontSize="14" fill={colors.muted}>Publicadas</text>
                <text x="470" y="310" textAnchor="middle" fontSize="14" fill={colors.muted}>Creadas</text>
                <text x="640" y="310" textAnchor="middle" fontSize="14" fill={colors.muted}>Reembolsos</text>
                <text x="130" y="105" textAnchor="middle" fontSize="16" fontWeight="bold" fill={colors.text}>{stats.ordersConfirmed}</text>
                <text x="300" y="45" textAnchor="middle" fontSize="16" fontWeight="bold" fill={colors.text}>{stats.eventsPublished}</text>
                <text x="470" y="160" textAnchor="middle" fontSize="16" fontWeight="bold" fill={colors.text}>{stats.eventsCreated}</text>
                <text x="640" y="75" textAnchor="middle" fontSize="16" fontWeight="bold" fill={colors.text}>{stats.refundsRequested}</text>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    padding: 24,
    maxWidth: 1400,
    margin: '0 auto',
    background: colors.background,
    color: colors.text,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  headerBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: { margin: 0, fontSize: 24, fontWeight: 700, color: colors.text },
  subtitle: { margin: 0, color: colors.muted, fontSize: 14 },
  logoutBtn: { padding: '10px 20px', fontSize: 14 },
  messageBanner: {
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
    border: `1px solid ${colors.border}`,
    fontSize: 14,
  },
  messageSuccess: {
    background: 'rgba(172, 228, 170, 0.15)',
    color: colors.accent,
    border: `1px solid ${colors.accent}`,
  },
  messageError: {
    background: colors.errorBg,
    color: colors.error,
    border: `1px solid ${colors.errorBorder}`,
  },
  tabBar: {
    display: 'flex',
    borderBottom: `1px solid ${colors.border}`,
    marginBottom: 24,
    gap: 0,
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid transparent`,
    color: colors.muted,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '16px 20px',
  },
  tabBtnActive: {
    color: colors.primary,
    borderBottom: `2px solid ${colors.primary}`,
  },
  sectionCard: {
    background: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
    marginBottom: 24,
    overflow: 'hidden',
  },
  sectionHeader: {
    padding: 20,
    borderBottom: `1px solid ${colors.border}`,
  },
  sectionTitle: { margin: 0, fontSize: 18, fontWeight: 600, color: colors.text },
  createEventBtn: {
    marginBottom: 16,
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  createFormCard: {
    background: colors.surface,
    padding: 24,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
    marginBottom: 24,
  },
  formTitle: { margin: '0 0 16px 0', fontSize: 20, fontWeight: 600, color: colors.text },
  createForm: { display: 'grid', gap: 16 },
  formFull: { display: 'flex', flexDirection: 'column', gap: 6 },
  formHalf: { display: 'flex', flexDirection: 'column', gap: 6 },
  formLabel: { fontSize: 13, fontWeight: 600, marginBottom: 4, color: colors.muted },
  formInput: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    fontSize: 15,
    color: colors.text,
    background: colors.background,
  },
  createSubmitBtn: {
    width: 'fit-content',
    padding: '12px 28px',
    fontSize: 17,
    fontWeight: 600,
  },
  tableWrapper: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  tableHead: {},
  tableRow: { borderBottom: `1px solid ${colors.border}` },
  tableCell: { padding: '16px 20px', textAlign: 'left', fontSize: 14, color: colors.text },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tableBtn: {
    padding: '8px 16px',
    fontSize: 14,
    fontWeight: 600,
  },
  editForm: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  editInput: {
    padding: '8px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontSize: 13,
    color: colors.text,
    background: colors.background,
    minWidth: 120,
  },
  editInputSmall: {
    padding: '8px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontSize: 13,
    color: colors.text,
    background: colors.background,
    minWidth: 80,
  },
  editBtn: { padding: '8px 16px', fontSize: 14, fontWeight: 600 },
  editCancelBtn: { padding: '8px 16px', fontSize: 14, fontWeight: 600, color: colors.muted },
  ordersSearchBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'flex-start',
  },
  searchInputWrap: { width: '100%', maxWidth: 300 },
  searchInput: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    fontSize: 14,
    color: colors.text,
    background: colors.background,
  },
  monitoringGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 16,
  },
  monitoringCard: {
    background: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
  },
  monitoringCardWide: {
    background: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
  },
  monitoringCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottom: `1px solid ${colors.border}`,
  },
  monitoringCardTitle: { margin: 0, fontSize: 18, fontWeight: 600, color: colors.text },
  statPill: {
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    background: 'rgba(172, 228, 170, 0.15)',
    color: colors.accent,
    border: `1px solid ${colors.accent}`,
  },
  monitoringList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  emptyState: {
    padding: 32,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 14,
  },
  errorLogItem: {
    padding: 16,
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
  },
  errorLogOp: { margin: 0, fontSize: 14, fontWeight: 600, color: colors.text },
  errorLogMsg: { margin: '4px 0 0 0', fontSize: 14, color: colors.muted },
  errorLogTime: { fontSize: 12, color: colors.muted },
  statTiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    marginBottom: 24,
  },
  statTile: {
    background: colors.background,
    padding: 16,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 800,
    color: colors.text,
    margin: '0 0 4px 0',
  },
  statLabel: { fontSize: 12, color: colors.muted },
  chartWrap: { padding: 16 },
  chartSvg: { width: '100%', height: 200, display: 'block' },
};

// Apply responsive padding via inline media is not supported; root uses fixed 24px.
// Keep a desktop-friendly padding by noting md:p-6 intent is approximated.
