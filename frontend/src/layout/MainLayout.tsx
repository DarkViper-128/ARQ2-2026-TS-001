import { Outlet, useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';
import { Button } from '../components/Button';
import { colors } from '../lib/theme';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isOrganizer = user?.role === 'ORGANIZER';
  const [collapsed, setCollapsed] = useState(false);

  const navLinks = isOrganizer
    ? [
        { label: '📊', title: 'Panel Organizador', to: '/admin' },
        { label: '🎪', title: 'Mis Eventos', to: '/admin/events' },
        { label: '➕', title: 'Crear Evento', to: '/admin/create' },
        { label: '💸', title: 'Reembolsos', to: '/admin/refunds' },
      ]
    : [
        { label: '🎟️', title: 'Eventos Disponibles', to: '/' },
        { label: '🎫', title: 'Mis Boletos', to: '/tickets' },
        { label: '📋', title: 'Mis Órdenes', to: '/orders' },
      ];

  const sidebarWidth = collapsed ? 72 : 260;

  return (
    <div style={styles.layout}>
      <aside style={{ ...styles.sidebar, width: sidebarWidth }}>
        <div style={{ ...styles.brand, paddingLeft: collapsed ? 12 : 20, paddingRight: collapsed ? 12 : 20 }}>
          {!collapsed && (
            <>
              <h2 style={styles.brandTitle}>FlashTix</h2>
              <span style={getRoleBadgeStyle(isOrganizer)}>{isOrganizer ? 'ORGANIZADOR' : 'FAN'}</span>
            </>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={styles.toggleBtn}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
        <nav style={{ ...styles.nav, paddingLeft: collapsed ? 12 : 20, paddingRight: collapsed ? 12 : 20 }}>
          {navLinks.map((link) => (
            <a
              key={link.to}
              href={link.to}
              style={getNavLinkStyle(link.to === location.pathname, collapsed)}
              onClick={(e) => {
                e.preventDefault();
                navigate(link.to);
              }}
            >
              <span style={styles.navIcon}>{link.label}</span>
              {!collapsed && <span style={styles.navTitle}>{link.title}</span>}
            </a>
          ))}
        </nav>
        {!collapsed && (
          <div style={styles.userInfo}>
            <p style={styles.userName}>{user?.username}</p>
            <p style={styles.userRole}>{user?.role}</p>
            <Button
              type="button"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              variant="ghost"
              style={styles.logoutBtn}
            >
              Cerrar sesión
            </Button>
          </div>
        )}
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
    background: isOrganizer ? colors.primary : colors.accent,
    color: isOrganizer ? '#ffffff' : '#15042D',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
  };
}

function getNavLinkStyle(active: boolean, collapsed: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: 10,
    padding: collapsed ? '12px 0' : '10px 14px',
    borderRadius: 8,
    color: active ? colors.text : colors.muted,
    textDecoration: 'none',
    fontSize: 14,
    background: active ? colors.primary : 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: collapsed ? '100%' : '100%',
    textAlign: collapsed ? 'center' : 'left',
  };
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    height: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: colors.background,
  },
  sidebar: {
    width: 260,
    background: colors.surface,
    color: colors.text,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${colors.border}`,
    transition: 'width 0.2s ease',
  },
  brand: {
    padding: '24px 20px',
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    transition: 'padding 0.2s ease',
  },
  brandTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: colors.text },
  toggleBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.muted,
    cursor: 'pointer',
    fontSize: 16,
    padding: 6,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  nav: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
  },
  navIcon: { fontSize: 18 },
  navTitle: { fontSize: 14, fontWeight: 500, color: colors.text },
  userInfo: {
    padding: 20,
    borderTop: `1px solid ${colors.border}`,
  },
  userName: { margin: '0 0 4px 0', fontSize: 14, fontWeight: 600, color: colors.text },
  userRole: { margin: '0 0 12px 0', fontSize: 12, color: colors.muted },
  logoutBtn: {
    width: '100%',
    padding: 10,
    fontSize: 13,
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    overflow: 'auto',
    padding: 32,
    background: colors.background,
    color: colors.text,
    transition: 'padding 0.2s ease',
  },
};
