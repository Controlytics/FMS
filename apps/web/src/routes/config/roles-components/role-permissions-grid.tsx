import { Button } from '@/components/ui/button';
import { PERMISSION_CATEGORIES } from '@digilog/shared';

interface RolePermissionsGridProps {
  permissions: string[];
  onTogglePermission: (key: string) => void;
  onToggleCategory: (category: string, enable: boolean) => void;
}

export function RolePermissionsGrid({
  permissions,
  onTogglePermission,
  onToggleCategory,
}: RolePermissionsGridProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Permissions</h3>
      {Object.entries(PERMISSION_CATEGORIES).map(([category, categoryPerms]) => {
        const allEnabled = categoryPerms.every(p => permissions.includes(p.key));
        return (
          <div key={category} className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
              <span className="font-semibold text-slate-700">{category}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleCategory(category, !allEnabled)}
                className="text-xs"
              >
                {allEnabled ? 'Disable All' : 'Enable All'}
              </Button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2">
              {categoryPerms.map((perm) => (
                <label
                  key={perm.key}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                    permissions.includes(perm.key)
                      ? 'bg-purple-50 border-purple-200 border'
                      : 'bg-white border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm.key)}
                    onChange={() => onTogglePermission(perm.key)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                    permissions.includes(perm.key)
                      ? 'bg-purple-500 border-purple-500'
                      : 'border-slate-300'
                  }`}>
                    {permissions.includes(perm.key) && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-slate-700">{perm.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
