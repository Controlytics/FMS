import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: 'LayoutDashboard' },
  { label: 'Users', href: '/users', icon: 'Users', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Configuration', href: '/config', icon: 'Settings', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Asset Templates', href: '/assets/templates', icon: 'FileBox' },
  { label: 'Asset Hierarchy', href: '/assets', icon: 'Network' },
  { label: 'Audit Trail', href: '/audit', icon: 'ScrollText' },
];

// Simple icon map using unicode/emoji-like chars (keeps it dependency-free for now)
const icons: Record<string, string> = {
  LayoutDashboard: '\u2302',
  Users: '\u263A',
  Settings: '\u2699',
  FileBox: '\u2750',
  Network: '\u26B1',
  ScrollText: '\u2637',
};

interface SidebarProps {
  userRole: string;
}

export function Sidebar({ userRole }: SidebarProps) {
  const location = useLocation();

  const filteredItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(userRole),
  );

  return (
    <aside className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            DL
          </div>
          <span className="text-lg font-semibold">DigiLog</span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {filteredItems.map((item) => {
          const active = item.href === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
            >
              <span className="w-5 text-center">{icons[item.icon] ?? '?'}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-4 text-xs text-muted-foreground">
        DigiLog v0.1.0 — Phase 1
      </div>
    </aside>
  );
}
