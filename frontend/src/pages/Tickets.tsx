import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';

interface Ticket {
  ticketId: string;
  seatId: string;
  qrPayload: string;
  downloadUrl: string;
}

export default function Tickets() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/tickets', token)
      .then((data: Ticket[] | Ticket) => {
        const list = Array.isArray(data) ? data : data ? [data] : [];
        setTickets(list);
      })
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

  const handleBack = () => navigate('/');

  if (loading) return <div>Cargando boletos...</div>;
  if (error) return <div>Error: {error}</div>;
  if (tickets.length === 0) {
    return (
      <div style={styles.empty}>
        <h2>No tienes boletos</h2>
        <p>Compra entradas para tus eventos favoritos.</p>
        <button onClick={handleBack} style={styles.backBtn}>
          Ir al catálogo
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <button onClick={handleBack} style={styles.backBtn}>← Catálogo</button>
      </nav>

      <h1 style={styles.title}>Mis boletos</h1>

      <div style={styles.ticketsGrid}>
        {tickets.map((ticket) => (
          <div key={ticket.ticketId} style={styles.ticketCard}>
            <div style={styles.ticketHeader}>
              <h3 style={styles.ticketTitle}>FlashTix</h3>
              <span style={styles.seatId}>{ticket.seatId}</span>
            </div>
            <div style={styles.qrCode}>
              <div style={styles.qrPlaceholder}>
                {ticket.qrPayload}
              </div>
            </div>
            <div style={styles.ticketInfo}>
              <p style={styles.ticketText}>ID: {ticket.ticketId}</p>
              <p style={styles.ticketText}>
                Descarga: <a href={ticket.downloadUrl} target="_blank" rel="noopener noreferrer">PDF</a>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#f1f5f9' },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'none',
    border: '1px solid #334155',
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    color: '#94a3b8',
  },
  title: { fontSize: 28, color: '#ffffff', marginBottom: 24 },
  empty: {
    textAlign: 'center',
    padding: 60,
    background: '#1e293b',
    borderRadius: 12,
    border: '1px solid #334155',
  },
  ticketsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: 24,
  },
  ticketCard: {
    padding: 24,
    background: '#1e293b',
    border: '2px solid #2563eb',
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  ticketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  ticketTitle: { margin: 0, fontSize: 20, color: '#ffffff' },
  seatId: {
    padding: '4px 10px',
    background: '#1e3a8a',
    color: '#bfdbfe',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid #3b82f6',
  },
  qrCode: {
    height: 120,
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
  },
  ticketInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  ticketText: { margin: 0, fontSize: 14, color: '#cbd5e1' },
};
