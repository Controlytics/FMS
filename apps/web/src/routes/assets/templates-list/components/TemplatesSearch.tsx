import { Input } from '@/components/ui/input';

interface TemplatesSearchProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

/**
 * Debounced search input for the Asset Templates list. Pure presentational
 * — debounce + page-reset live in the parent so the API key and pagination
 * stay co-located.
 */
export function TemplatesSearch({ searchTerm, onSearchChange }: TemplatesSearchProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <Input
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search templates..."
          className="pl-10"
        />
      </div>
    </div>
  );
}
