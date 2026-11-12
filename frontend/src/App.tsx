import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import MainLayout from './layout/MainLayout';
import FanDashboard from './pages/FanDashboard';
import AdminDashboard from './pages/AdminDashboard';
import EventSeats from './pages/EventSeats';
import Hold from './pages/Hold';
import Order from './pages/Order';
import Orders from './pages/Orders';
import Tickets from './pages/Tickets';

function FanRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'ORGANIZER') return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function OrganizerRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'ORGANIZER') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <MainLayout />
            }
          >
            <Route index element={<FanDashboard />} />
            <Route path="/" element={<FanDashboard />} />
            <Route path="/events/:eventId/seats" element={<EventSeats />} />
            <Route path="/hold" element={<Hold />} />
            <Route path="/order" element={<Order />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/orders" element={<Orders />} />
            <Route
              path="/admin"
              element={
                <OrganizerRoute>
                  <AdminDashboard />
                </OrganizerRoute>
              }
            />
            <Route
              path="/admin/events"
              element={
                <OrganizerRoute>
                  <AdminDashboard />
                </OrganizerRoute>
              }
            />
            <Route
              path="/admin/create"
              element={
                <OrganizerRoute>
                  <AdminDashboard />
                </OrganizerRoute>
              }
            />
            <Route
              path="/admin/refunds"
              element={
                <OrganizerRoute>
                  <AdminDashboard />
                </OrganizerRoute>
              }
            />
          </Route>

          <Route
            path="/fan"
            element={
              <FanRoute>
                <FanDashboard />
              </FanRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
