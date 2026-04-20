import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/**
 * Redirect non-admins to / (which might redirect to /login if unauthenticated).
 * Only renders children if the current user has the 'admin' role.
 */
export function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
