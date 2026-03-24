import { Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';
import { cn } from '@/lib/cn';
import { useBranding } from '@/hooks/use-branding';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  defaultRoles?: string[];
}

// All available nav items with their IDs matching the config
const allNavItems: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    id: "users",
    label: "Users",
    href: "/users",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>),
    defaultRoles: ["SUPER_ADMIN"],
  },
  {
    id: "organizations",
    label: "Organizations",
    href: "/organizations",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>),
    defaultRoles: ["SUPER_ADMIN", "ADMIN"],
  },
  {
    id: 'assets',
    label: 'Entities',
    href: '/assets',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    defaultRoles: ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR'],
  },
  {
    id: 'asset-templates',
    label: 'Entity Templates',
    href: '/assets/templates',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
    defaultRoles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    href: '/config',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    defaultRoles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    href: '/audit',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'system-health',
    label: 'System Health',
    href: '/system-health',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    defaultRoles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    id: 'rule-chains',
    label: 'Rule Chains',
    href: '/rule-chains',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    defaultRoles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    id: 'alarms',
    label: 'Alarms',
    href: '/alarms',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    id: 'debug-traces',
    label: 'Debug Traces',
    href: '/debug/traces',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
      </svg>
    ),
    defaultRoles: ['SUPER_ADMIN', 'ADMIN'],
  },
];

interface SidebarProps {
  userRole: string;
}

export function Sidebar({ userRole }: SidebarProps) {
  const location = useLocation();
  const { branding } = useBranding();

  // Fetch user's sidebar configuration
  const { data: config } = useSWR('/api/config/my-config');

  // Filter items based on configuration
  const filteredItems = allNavItems.filter((item) => {
    // If config exists and has sidebarItems array with items, use it
    if (config?.sidebarItems && Array.isArray(config.sidebarItems) && config.sidebarItems.length > 0) {
      return config.sidebarItems.includes(item.id);
    }

    // Fall back to default role-based filtering
    if (!item.defaultRoles) return true;
    return item.defaultRoles.includes(userRole);
  });

  return (
    <aside
      className="flex h-full w-64 flex-col"
      style={{ background: `linear-gradient(180deg, ${branding.primaryColor} 0%, ${branding.loginBgStart} 100%)` }}
    >
      {/* Logo Section */}
      <div className="flex flex-col items-center py-3 border-b border-white/10">
        <Link to="/" className="flex flex-col items-center w-full px-3">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.appName}
              className="max-w-full max-h-14 w-auto h-auto object-contain"
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl text-white text-sm font-bold shadow-lg"
              style={{ background: `linear-gradient(135deg, ${branding.secondaryColor} 0%, ${branding.accentColor} 100%)` }}
            >
              {branding.logoText}
            </div>
          )}
          <span className="text-lg font-semibold text-white mt-2">{branding.appName}</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
        <p className="px-3 mb-3 text-xs font-semibold text-white/40 uppercase tracking-wider">Menu</p>
        {filteredItems.map((item) => {
          const active = item.href === '/'
            ? location.pathname === '/'
            : item.href === '/assets'
              ? location.pathname === '/assets'
              : location.pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
                active
                  ? 'bg-white/15 text-white shadow-lg backdrop-blur-sm'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <span className={cn(
                'transition-colors',
                active ? 'text-white' : 'text-white/60'
              )}>
                {item.icon}
              </span>
              {item.label}
              {active && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <div className="rounded-xl bg-white/5 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium text-white/80">{branding.companyName}</p>
          <p className="text-xs text-white/40 mt-1">21 CFR Part 11 Compliant</p>
        </div>
      </div>
    </aside>
  );
}
