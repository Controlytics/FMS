import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface HeaderProps {
  user: { fullName: string; role: string; username: string } | undefined;
  onLogout: () => void;
}

const roleColors: Record<string, 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'> = {
  SUPER_ADMIN: 'destructive',
  ADMIN: 'default',
  SUPERVISOR: 'warning',
  MAINTENANCE: 'success',
  OPERATOR: 'secondary',
  VIEWER: 'outline',
};

export function Header({ user, onLogout }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      <div />
      <div className="flex items-center gap-4">
        {user && (
          <>
            <span className="text-sm text-muted-foreground">{user.fullName}</span>
            <Badge variant={roleColors[user.role] ?? 'outline'}>
              {user.role.replace('_', ' ')}
            </Badge>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              Logout
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
