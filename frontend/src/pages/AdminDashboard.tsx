import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const API_BASE = '/v1';

interface Event {
  event_id: string;
  name: string;
  description: string;
  artist: string;
  venue_name: string;
  venue_city: string;
  starts_at: string;
  sale_starts_at: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ON_SALE' | 'SOLD_OUT' | 'CANCELLED';
  total_seats: number;
  price_amount: number;
  created_at: string;
}

interface Order {
  order_id: string;
  user_id: string;
  user_email: string;
  event_id: string;
  hold_id: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';
  total_amount: number;
  failure_reason: string | null;
  created_at: string;
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
      const [eventsData, ordersData] = await Promise.all([
        (await apiFetch('/events')) as Event[],
        (await apiFetch('/orders')) as Order[],
      ]);
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
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 10)
          .map((o) => ({
            operation: 'Checkout',
            message: o.failure_reason || 'Orden cancelada',
            timestamp: o.created_at,
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
      const seats = Array.from({ length: Math.max(parseInt(createForm.totalSeats) || 10, 1) }, (_, i) => ({
        seatId: `A-${Math.floor(i / 10) + 1}-${(i % 10) + 1}`,
        category: 'General',
      }));
      await apiFetch('/admin/events', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name,
          artist: createForm.name || createForm.description || 'Evento',
          venue_name: 'Estadio Local',
          venue_city: 'Bogota',
          starts_at: new Date(Date.now() + 86400000 * 30).toISOString(),
          sale_starts_at: new Date(Date.now() + 86400000).toISOString(),
          status: 'DRAFT',
          priceCategories: [{ category: 'General', price: { amount: parseInt(createForm.price) || 100, currency: 'COP' } }],
          seats,
        }),
      });
      setMessage({ text: 'Evento creado en estado DRAFT', type: 'success' });
      setCreating(false);
      setCreateForm({ name: '', description: '', totalSeats: '', price: '' });
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

  const statusColor = (status: string) => {
    switch (status) {
      case 'PUBLISHED': return 'bg-green-100 text-green-800';
      case 'ON_SALE': return 'bg-blue-100 text-blue-800';
      case 'DRAFT': return 'bg-yellow-100 text-yellow-800';
      case 'CANCELLED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const orderStatusColor = (status: string) => {
    switch (status) {
      case 'CONFIRMED': return 'bg-green-100 text-green-800';
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'FAILED': return 'bg-red-100 text-red-800';
      case 'CANCELLED': return 'bg-gray-100 text-gray-800';
      case 'REFUND_PENDING': return 'bg-orange-100 text-orange-800';
      case 'REFUNDED': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Panel Organizador</h1>
          <p className="text-gray-600">Gestiona tus eventos, ordenes y monitorea la plataforma</p>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem('flashtix_token');
            window.location.href = '/';
          }}
          className="px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
        >
          Cerrar sesion
        </button>
      </div>

      {message.text && (
        <div className={`mb-4 p-4 rounded-lg border ${
          message.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex border-b mb-6">
        <button
          onClick={() => {
            setActiveTab('events');
            setShowCreateForm(false);
          }}
          className={`px-6 py-4 border-b-2 font-medium transition ${
            activeTab === 'events' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Todos los Eventos
        </button>
        <button
          onClick={() => {
            setActiveTab('my-events');
            setShowCreateForm(false);
          }}
          className={`px-6 py-4 border-b-2 font-medium transition ${
            activeTab === 'my-events' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Mis Eventos
        </button>
        <button
          onClick={() => {
            setActiveTab('orders');
            setShowCreateForm(false);
          }}
          className={`px-6 py-4 border-b-2 font-medium transition ${
            activeTab === 'orders' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Ordenes
        </button>
        <button
          onClick={() => {
            setActiveTab('monitoring');
            setShowCreateForm(false);
          }}
          className={`px-6 py-4 border-b-2 font-medium transition ${
            activeTab === 'monitoring' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Monitoreo
        </button>
      </div>

      {activeTab === 'events' && (
        <div>
          {/* Boton para mostrar/ocultar el formulario de crear evento */}
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="mb-4 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition flex items-center gap-2"
          >
            {showCreateForm ? 'Ocultar formulario' : '+'} Crear Evento
          </button>

          {showCreateForm && (
            <div className="bg-white p-6 rounded-xl shadow mb-6 border border-gray-200">
              <h2 className="text-xl font-semibold mb-4">Crear Evento</h2>
              <form onSubmit={handleCreateEvent} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del evento</label>
                  <input
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="Ej. Concierto Rock 2026"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descripcion</label>
                  <input
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="Descripcion del evento"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Boletas disponibles</label>
                  <input
                    type="number"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="Ej. 200"
                    value={createForm.totalSeats}
                    onChange={(e) => setCreateForm({ ...createForm, totalSeats: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Costo por boleta (COP)</label>
                  <input
                    type="number"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="Ej. 45000"
                    value={createForm.price}
                    onChange={(e) => setCreateForm({ ...createForm, price: e.target.value })}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={creating || loading}
                  className="w-full md:w-auto px-8 py-4 bg-blue-600 text-white rounded-lg font-semibold text-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {creating ? 'Creando...' : 'Crear Evento'}
                </button>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Eventos del Sistema</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Nombre</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Descripcion</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Boletas</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Precio</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Estado</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {events.map((event) => (
                    <tr key={event.event_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium">{event.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">{event.description || '—'}</td>
                      <td className="px-6 py-4">{event.total_seats}</td>
                      <td className="px-6 py-4">${event.price_amount.toLocaleString()} COP</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${statusColor(event.status)}`}>
                          {event.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {event.status === 'DRAFT' && (
                          <button
                            onClick={() => handlePublish(event.event_id)}
                            disabled={loading}
                            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            Publicar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
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
          <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Mis Eventos</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Nombre</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Descripcion</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Boletas</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Precio</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Estado</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {myEvents.map((event) => (
                    <tr key={event.event_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium">{event.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">{event.description || '—'}</td>
                      <td className="px-6 py-4">{event.total_seats}</td>
                      <td className="px-6 py-4">${event.price_amount.toLocaleString()} COP</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${statusColor(event.status)}`}>
                          {event.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {editing === event.event_id ? (
                          <form onSubmit={handleUpdateEvent} className="flex flex-col sm:flex-row gap-2 items-end">
                            <input
                              className="px-3 py-2 border border-gray-300 rounded text-sm w-40 sm:w-48"
                              value={editForm.name}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              required
                            />
                            <input
                              className="px-3 py-2 border border-gray-300 rounded text-sm w-40 sm:w-48"
                              value={editForm.description}
                              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            />
                            <input
                              type="number"
                              className="px-3 py-2 border border-gray-300 rounded text-sm w-24 sm:w-32"
                              value={editForm.totalSeats}
                              onChange={(e) => setEditForm({ ...editForm, totalSeats: e.target.value })}
                              required
                            />
                            <input
                              type="number"
                              className="px-3 py-2 border border-gray-300 rounded text-sm w-24 sm:w-32"
                              value={editForm.price}
                              onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                              required
                            />
                            <button
                              type="submit"
                              disabled={loading}
                              className="px-5 py-2.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="px-5 py-2.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                            >
                              Cancelar
                            </button>
                          </form>
                        ) : (
                          <>
                            {event.status === 'DRAFT' && (
                              <button
                                onClick={() => {
                                  setEditing(event.event_id);
                                  setEditForm({
                                    name: event.name,
                                    description: event.description,
                                    totalSeats: String(event.total_seats),
                                    price: String(event.price_amount),
                                  });
                                }}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                              >
                                Editar
                              </button>
                            )}
                            {event.status === 'DRAFT' && (
                              <button
                                onClick={() => handlePublish(event.event_id)}
                                disabled={loading}
                                className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 ml-2"
                              >
                                Publicar
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {myEvents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
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
          <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Ordenes del Sistema</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Orden ID</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Usuario</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Monto</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Estado</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {orders.map((order) => (
                    <tr key={order.order_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono text-sm">{order.order_id}</td>
                      <td className="px-6 py-4">{order.user_email}</td>
                      <td className="px-6 py-4">${order.total_amount.toLocaleString()} COP</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${orderStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {order.status === 'CONFIRMED' && (
                          <button
                            onClick={() => handleRefund(order.order_id)}
                            disabled={loading}
                            className="px-5 py-2.5 bg-orange-600 text-white text-sm rounded hover:bg-orange-700 disabled:opacity-50"
                          >
                            Reembolsar
                          </button>
                        )}
                        {order.status !== 'CONFIRMED' && (
                          <span className="text-xs text-gray-400">No reembolsable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                        No hay ordenes registradas.
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Grafico 1: Errores en la compra */}
          <div className="bg-white rounded-xl shadow border border-gray-200">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900">Errores en la Compra</h2>
              <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-1 rounded">{errorLogs.length}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {errorLogs.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">Sin errores de compra recientes</div>
              ) : (
                errorLogs.map((err, i) => (
                  <div key={i} className="p-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{err.operation}</p>
                        <p className="text-sm text-gray-600">{err.message}</p>
                      </div>
                      <span className="text-xs text-gray-400">{new Date(err.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Grafico 2: Compras de boletos exitosas */}
          <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Compras de Boletos Exitosas</h2>
              <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded">{stats.ordersConfirmed}</span>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-gray-50 p-6 rounded-xl">
                <div className="text-3xl font-bold text-green-600">{stats.ordersConfirmed}</div>
                <div className="text-sm text-gray-500 mt-1">Ordenes confirmadas</div>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl">
                <div className="text-3xl font-bold text-blue-600">{stats.eventsPublished}</div>
                <div className="text-sm text-gray-500 mt-1">Eventos publicados</div>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl">
                <div className="text-3xl font-bold text-indigo-600">{stats.eventsCreated}</div>
                <div className="text-sm text-gray-500 mt-1">Eventos creados</div>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl">
                <div className="text-3xl font-bold text-orange-600">{stats.refundsRequested}</div>
                <div className="text-sm text-gray-500 mt-1">Reembolsos solicitados</div>
              </div>
            </div>

            <div className="mt-6 h-64">
              <svg className="w-full h-full" viewBox="0 0 700 350">
                <defs>
                  <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop stopColor="rgb(99,102,241)" stopOpacity="1" offset="0%" />
                    <stop stopColor="rgb(79,70,229)" stopOpacity="1" offset="100%" />
                  </linearGradient>
                </defs>
                <rect x="60" y="120" width="140" height="160" fill="url(#grad1)" rx="10" />
                <rect x="230" y="60" width="140" height="220" fill="url(#grad1)" rx="10" />
                <rect x="400" y="170" width="140" height="100" fill="url(#grad1)" rx="10" />
                <rect x="570" y="90" width="140" height="140" fill="url(#grad1)" rx="10" />
                <text x="130" y="310" text-anchor="middle" font-size="14" fill="#6b7280">Confirmadas</text>
                <text x="300" y="310" text-anchor="middle" font-size="14" fill="#6b7280">Publicadas</text>
                <text x="470" y="310" text-anchor="middle" font-size="14" fill="#6b7280">Creadas</text>
                <text x="640" y="310" text-anchor="middle" font-size="14" fill="#6b7280">Reembolsos</text>
                <text x="130" y="105" text-anchor="middle" font-size="16" font-weight="bold" fill="#ffffff">{stats.ordersConfirmed}</text>
                <text x="300" y="45" text-anchor="middle" font-size="16" font-weight="bold" fill="#ffffff">{stats.eventsPublished}</text>
                <text x="470" y="160" text-anchor="middle" font-size="16" font-weight="bold" fill="#ffffff">{stats.eventsCreated}</text>
                <text x="640" y="75" text-anchor="middle" font-size="16" font-weight="bold" fill="#ffffff">{stats.refundsRequested}</text>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
