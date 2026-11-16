import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../lib/api';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

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
        <Button onClick={handleBack} variant="outline" style={styles.backBtn}>
          Ir al catálogo
        </Button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <nav style={styles.nav}>
        <Button type="button" onClick={handleBack} variant="ghost" style={styles.backBtn}>← Catálogo</Button>
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
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', background: colors.background, color: colors.text },
  nav: { marginBottom: 32 },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    cursor: 'pointer',
    padding: 0,
  },
  title: { fontSize: 28, color: colors.text, marginBottom: 24 },
  empty: {
    textAlign: 'center',
    padding: 60,
    background: colors.surface,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
  },
  ticketsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: 24,
  },
  ticketCard: {
    padding: 24,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  ticketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  ticketTitle: { margin: 0, fontSize: 20, color: colors.text },
  seatId: {
    padding: '4px 10px',
    background: colors.primary,
    color: '#ffffff',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    border: `1px solid ${colors.border}`,
  },
  qrCode: {
    height: 120,
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
  },
  ticketInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  ticketText: { margin: 0, fontSize: 14, color: colors.text },
};
