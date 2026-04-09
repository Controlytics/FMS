import { useAuth } from '@/hooks/use-auth';
import { useBranding } from '@/hooks/use-branding';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { useMemo } from 'react';

const statCardIcons = {
  users: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  audit: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  notifications: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  href: string;
  gradient: string;
  delay?: string;
}

function StatCard({ title, value, icon, href, gradient, delay = '0ms' }: StatCardProps) {
  return (
    <Link to={href} className="group" style={{ animationDelay: delay }}>
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200/60 shadow-soft hover:shadow-elevated transition-all duration-300 hover:-translate-y-1">
        {/* Gradient accent bar */}
        <div className={`absolute top-0 left-0 right-0 h-1 ${gradient}`} />

        <div className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{title}</p>
              <p className="text-4xl font-bold text-slate-800">{value}</p>
            </div>
            <div className={`p-3 rounded-xl ${gradient} text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
              {icon}
            </div>
          </div>

          <div className="mt-4 flex items-center text-sm text-slate-500 group-hover:text-slate-700 transition-colors">
            <span>View details</span>
            <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { branding } = useBranding();
  const { formatDate } = useDatetimeFormat();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdmin = isSuperAdmin || (user?.permissions?.includes('USER_READ') ?? false);

  const swrOpts = { revalidateOnMount: true, revalidateOnFocus: true, dedupingInterval: 2000, refreshInterval: 30000 };
  const { data: userStats } = useSWR(isAdmin ? '/api/users/stats' : null, swrOpts);
  const { data: auditStats } = useSWR('/api/audit?limit=1', swrOpts);
  const { data: notifStats } = useSWR('/api/notifications?limit=1', swrOpts);
  const { data: dashStats } = useSWR<any>('/api/filters/dashboard-stats', { ...swrOpts, refreshInterval: 60000 });
  const { data: cardConfig } = useSWR<any>('/api/config/dashboard-cards/current', { revalidateOnFocus: false, dedupingInterval: 10000 });

  // Resolve visible cards for current user's role
  const visibleCards = useMemo(() => {
    const roleName = user?.role ?? '';
    const rolesMap: Record<string, string[]> = cardConfig?.roles ?? {};
    // If no config exists yet, show all cards
    return rolesMap[roleName] ?? null;
  }, [cardConfig, user?.role]);
  const showCard = (key: string) => visibleCards === null || visibleCards.includes(key);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#1e3a5f] to-[#3b82f6] p-8 text-white shadow-elevated">
        <div className="relative z-10">
          <p className="text-blue-200 text-sm font-medium mb-1">Welcome back,</p>
          <h1 className="text-3xl font-bold mb-2">{user?.fullName}</h1>
          <p className="text-blue-100 text-sm">
            {branding.appName} - {branding.appTagline}
          </p>
        </div>

        {/* Background decoration */}
        <div className="absolute right-0 top-0 w-64 h-64 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="100" cy="100" r="80" fill="currentColor" />
            <circle cx="150" cy="50" r="40" fill="currentColor" />
          </svg>
        </div>

        {/* Quick stats in welcome banner */}
        <div className="relative z-10 mt-6 pt-6 border-t border-white/20 flex items-center gap-8">
          <div>
            <p className="text-blue-200 text-xs uppercase tracking-wider">Role</p>
            <p className="text-lg font-semibold">{user?.role?.replace('_', ' ')}</p>
          </div>
          <div className="h-10 w-px bg-white/20" />
          <div>
            <p className="text-blue-200 text-xs uppercase tracking-wider">Today</p>
            <p className="text-lg font-semibold">
              {formatDate(new Date())}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Quick Overview</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {isAdmin && showCard('total_users') && (
            <StatCard
              title="Total Users"
              value={userStats?.total ?? '-'}
              icon={statCardIcons.users}
              href="/users"
              gradient="bg-gradient-to-r from-blue-500 to-indigo-600"
              delay="0ms"
            />
          )}

          {showCard('audit_trail') && (
            <StatCard
              title="Audit Trail"
              value={auditStats?.total ?? '-'}
              icon={statCardIcons.audit}
              href="/audit"
              gradient="bg-gradient-to-r from-purple-500 to-pink-600"
              delay="50ms"
            />
          )}

          {showCard('notifications') && (
            <StatCard
              title="Notifications"
              value={notifStats?.total ?? '-'}
              icon={statCardIcons.notifications}
              href="/notifications"
              gradient="bg-gradient-to-r from-amber-500 to-orange-600"
              delay="100ms"
            />
          )}
        </div>
      </div>

      {/* Filter Cleaning Analytics */}
      {dashStats && showCard('filter_analytics') && <FilterAnalytics stats={dashStats} showCard={showCard} />}

      {/* Quick Actions */}
      {showCard('quick_actions') && <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isAdmin && (
            <Link to="/users/create">
              <Card className="group cursor-pointer hover:border-blue-200">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">Create User</p>
                    <p className="text-sm text-slate-500">Add a new user account</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}

          <Link to="/audit">
            <Card className="group cursor-pointer hover:border-purple-200">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-purple-50 text-purple-600 group-hover:bg-purple-100 transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">View Audit Trail</p>
                  <p className="text-sm text-slate-500">Check system activities</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {isAdmin && (
            <Link to="/config">
              <Card className="group cursor-pointer hover:border-emerald-200">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">System Configuration</p>
                    <p className="text-sm text-slate-500">Manage system settings</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      </div>}

      {/* Compliance Badge */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="p-2 rounded-lg bg-emerald-100 text-emerald-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">21 CFR Part 11 Compliant</p>
            <p className="text-xs text-slate-500">{branding.companyName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Cleaning Analytics ──────────────────────────────────────
const STAGE_CFG: Record<string, { label: string; color: string; bg: string }> = {
  WASH_IN: { label: 'Wash In', color: 'bg-sky-500', bg: 'bg-sky-50 text-sky-700' },
  WASH_OUT: { label: 'Wash Out', color: 'bg-sky-400', bg: 'bg-sky-50 text-sky-600' },
  DRY_IN: { label: 'Dry In', color: 'bg-amber-500', bg: 'bg-amber-50 text-amber-700' },
  DRY_OUT: { label: 'Dry Out', color: 'bg-amber-400', bg: 'bg-amber-50 text-amber-600' },
  STORAGE_IN: { label: 'Storage In', color: 'bg-slate-400', bg: 'bg-slate-100 text-slate-600' },
  STORAGE_OUT: { label: 'Storage Out', color: 'bg-slate-300', bg: 'bg-slate-100 text-slate-500' },
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-500' },
  COMPLETED: { label: 'Completed', color: 'bg-green-500' },
  TERMINATED: { label: 'Terminated', color: 'bg-red-500' },
};

function BarChart({ data, labelKey, valueKey, color }: { data: any[]; labelKey: string; valueKey: string; color: string }) {
  const max = Math.max(...data.map(d => d[valueKey] ?? 0), 1);
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => {
        const val = d[valueKey] ?? 0;
        const pct = (val / max) * 100;
        return (
          <div key={i} className="flex flex-col items-center flex-1 min-w-0 group">
            <span className="text-[9px] text-slate-500 font-medium mb-1 opacity-0 group-hover:opacity-100 transition-opacity">{val}</span>
            <div className={`w-full ${color} rounded-t-sm transition-all hover:opacity-80`} style={{ height: `${Math.max(pct, 2)}%` }} />
            <span className="text-[8px] text-slate-400 mt-1 truncate w-full text-center">{d[labelKey]}</span>
          </div>
        );
      })}
    </div>
  );
}

function FilterAnalytics({ stats, showCard }: { stats: any; showCard: (key: string) => boolean }) {
  const { stageCounts = {}, statusCounts = {}, dailyCycles = [], monthlyCycles = [], totalFilters = 0, activeCycles = 0, completedToday = 0 } = stats;

  const totalStageFilters = Object.values(stageCounts).reduce((a: number, b: any) => a + (b ?? 0), 0) as number;
  const totalCyclesAll = Object.values(statusCounts).reduce((a: number, b: any) => a + (b ?? 0), 0) as number;

  // Format daily labels as short day
  const dailyFormatted = useMemo(() => dailyCycles.map((d: any) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
  })), [dailyCycles]);

  // Format monthly labels
  const monthlyFormatted = useMemo(() => monthlyCycles.map((d: any) => ({
    ...d,
    label: new Date(d.month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
  })), [monthlyCycles]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Filter Cleaning Analytics</h2>
        <Link to="/filters" className="text-sm text-cyan-600 hover:text-cyan-700 font-medium flex items-center gap-1">
          Go to Operations
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {/* Summary cards row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {showCard('total_filters') && <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Total Filters</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{totalFilters}</div>
        </div>}
        {showCard('active_cycles') && <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Active Cycles</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{activeCycles}</div>
        </div>}
        {showCard('completed_today') && <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Completed Today</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{completedToday}</div>
        </div>}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Total Cycles</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{totalCyclesAll}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Stage distribution */}
        {showCard('stage_distribution') && <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Filters by Current Stage</h3>
          {totalStageFilters === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">No filters in cleaning stages</div>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(STAGE_CFG).map(([key, cfg]) => {
                const count = stageCounts[key] ?? 0;
                const pct = totalStageFilters > 0 ? (count / totalStageFilters) * 100 : 0;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-[12px] font-medium text-slate-600 w-24 shrink-0">{cfg.label}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div className={`h-full ${cfg.color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[12px] font-bold text-slate-700 w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>}

        {/* Cycle status breakdown */}
        {showCard('cycle_status') && <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Cycle Status Breakdown</h3>
          {totalCyclesAll === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">No cycles yet</div>
          ) : (
            <>
              {/* Donut-style summary */}
              <div className="flex items-center justify-center gap-6 mb-4">
                <div className="relative w-28 h-28">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    {(() => {
                      let offset = 0;
                      const entries = Object.entries(STATUS_CFG);
                      const colors: Record<string, string> = { IN_PROGRESS: '#3b82f6', COMPLETED: '#22c55e', TERMINATED: '#ef4444' };
                      return entries.map(([key]) => {
                        const count = statusCounts[key] ?? 0;
                        const pct = (count / totalCyclesAll) * 100;
                        const dashArray = `${pct * 2.51} ${251 - pct * 2.51}`;
                        const el = <circle key={key} cx="50" cy="50" r="40" fill="none" stroke={colors[key] ?? '#94a3b8'} strokeWidth="12" strokeDasharray={dashArray} strokeDashoffset={-offset * 2.51} />;
                        offset += pct;
                        return el;
                      });
                    })()}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold text-slate-800">{totalCyclesAll}</span>
                    <span className="text-[9px] text-slate-400">total</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${cfg.color}`} />
                      <span className="text-[12px] text-slate-600">{cfg.label}</span>
                      <span className="text-[12px] font-bold text-slate-800">{statusCounts[key] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Daily chart */}
        {showCard('daily_chart') && <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Daily Cycles (Last 30 Days)</h3>
          {dailyFormatted.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">No data</div>
          ) : (
            <BarChart data={dailyFormatted} labelKey="label" valueKey="count" color="bg-sky-500" />
          )}
        </div>}

        {/* Monthly chart */}
        {showCard('monthly_chart') && <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Monthly Cycles (Last 12 Months)</h3>
          {monthlyFormatted.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">No data</div>
          ) : (
            <BarChart data={monthlyFormatted} labelKey="label" valueKey="count" color="bg-indigo-500" />
          )}
        </div>}
      </div>
    </div>
  );
}
