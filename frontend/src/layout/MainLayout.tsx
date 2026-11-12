import { Outlet, useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isOrganizer = user?.role === 'ORGANIZER';

  const navLinks = isOrganizer
    ? [
        { label: '📊 Panel Organizador', to: '/admin' },
        { label: '🎪 Mis Eventos', to: '/admin/events' },
        { label: '➕ Crear Evento', to: '/admin/create' },
        { label: '💸 Reembolsos', to: '/admin/refunds' },
      ]
    : [
        { label: '🎟️ Eventos Disponibles', to: '/' },
        { label: '🎫 Mis Boletos', to: '/tickets' },
        { label: '📋 Mis Órdenes', to: '/orders' },
      ];

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <h2 style={styles.brandTitle}>FlashTix</h2>
          <span style={getRoleBadgeStyle(isOrganizer)}>{isOrganizer ? 'ORGANIZADOR' : 'FAN'}</span>
        </div>
        <nav style={styles.nav}>
          {navLinks.map((link) => (
            <a
              key={link.to}
              href={link.to}
              style={getNavLinkStyle(link.to === location.pathname)}
              onClick={(e) => {
                e.preventDefault();
                navigate(link.to);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div style={styles.userInfo}>
          <p style={styles.userName}>{user?.username}</p>
          <p style={styles.userRole}>{user?.role}</p>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            style={styles.logoutBtn}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

function getRoleBadgeStyle(isOrganizer: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    background: isOrganizer ? '#2563eb' : '#059669',
    color: '#ffffff',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
  };
}

function getNavLinkStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 8,
    color: active ? '#ffffff' : '#d1d5db',
    textDecoration: 'none',
    fontSize: 14,
    background: active ? '#2563eb' : 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  };
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    height: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#f3f4f6',
  },
  sidebar: {
    width: 260,
    background: '#1f2937',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
  },
  brand: {
    padding: '24px 20px',
    borderBottom: '1px solid #374151',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandTitle: { margin: 0, fontSize: 20, fontWeight: 700 },
  nav: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
  },
  userInfo: {
    padding: 20,
    borderTop: '1px solid #374151',
  },
  userName: { margin: '0 0 4px 0', fontSize: 14, fontWeight: 600 },
  userRole: { margin: '0 0 12px 0', fontSize: 12, color: '#9ca3af' },
  logoutBtn: {
    width: '100%',
    padding: 10,
    background: 'transparent',
    border: '1px solid #374151',
    color: '#d1d5db',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    overflow: 'auto',
    padding: 32,
  },
};
