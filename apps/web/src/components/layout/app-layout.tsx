import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useSession } from '@/hooks/use-session';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import useSWR from 'swr';

export function AppLayout() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { data: sessionConfig } = useSWR(isAuthenticated ? '/api/config/session' : null);
  const { showWarning, countdown, continueSession } = useSession(
    sessionConfig ?? null,
    logout,
  );

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Force password change redirect
  if (user?.forcePasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar userRole={user?.role ?? ''} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header user={user} onLogout={logout} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      <Dialog open={showWarning} onClose={continueSession}>
        <DialogHeader>
          <DialogTitle>Session Timeout Warning</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your session will expire due to inactivity in{' '}
          <span className="font-bold text-destructive">{countdown}</span> seconds.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={logout}>Logout Now</Button>
          <Button onClick={continueSession}>Continue Session</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
