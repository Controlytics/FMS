import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

const configCards = [
  { title: 'Password Policy', description: 'Configure password complexity rules', href: '/config/password-policy', reauth: true },
  { title: 'Login Security', description: 'Failed attempts & lockout settings', href: '/config/login-security', reauth: true },
  { title: 'Session Timeout', description: 'Auto-logout configuration', href: '/config/session', reauth: true },
  { title: 'Date/Time Format', description: 'Set application date/time format', href: '/config/datetime', reauth: false },
];

export function ConfigIndexPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">System Configuration</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {configCards.map((card) => (
          <Link key={card.href} to={card.href}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
              <CardHeader>
                <CardTitle className="text-lg">{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {card.reauth && (
                  <span className="text-xs text-muted-foreground">Requires re-authentication</span>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
        {user?.role === 'SUPER_ADMIN' && (
          <Link to="/config/field-ids">
            <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
              <CardHeader>
                <CardTitle className="text-lg">Field ID Names</CardTitle>
                <CardDescription>Configure field display names globally</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs text-muted-foreground">Super Admin only</span>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
