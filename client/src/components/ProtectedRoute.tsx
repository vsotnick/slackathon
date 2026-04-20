import { type ReactNode, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/** Redirect unauthenticated users to /login */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const jwt = useAuthStore((s) => s.jwt);
  const rehydrateXmpp = useAuthStore((s) => s.rehydrateXmpp);

  useEffect(() => {
    // On mount, if we have credentials from localStorage but no live WS,
    // reconnect the XMPP singleton (handles browser refreshes).
    rehydrateXmpp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!jwt) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
