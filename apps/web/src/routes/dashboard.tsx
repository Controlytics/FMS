import { useAuth } from '@/hooks/use-auth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const { data: userStats } = useSWR(isAdmin ? '/api/users?limit=1' : null);
  const { data: templateStats } = useSWR('/api/templates?status=active');
  const { data: nodeStats } = useSWR('/api/hierarchy');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {user?.fullName}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isAdmin && (
          <Link to="/users">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{userStats?.total ?? '-'}</div>
              </CardContent>
            </Card>
          </Link>
        )}

        <Link to="/assets/templates">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Asset Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{templateStats?.length ?? '-'}</div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/assets">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Root Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{nodeStats?.length ?? '-'}</div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/audit">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">View</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
