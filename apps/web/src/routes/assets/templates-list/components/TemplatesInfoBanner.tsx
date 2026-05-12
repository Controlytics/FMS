/**
 * Static help banner shown beneath the templates table. Pure presentational
 * — extracted verbatim from templates.tsx (no DOM/class changes).
 */
export function TemplatesInfoBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 border border-purple-100/50 p-5">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/25">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-purple-900 mb-1">About Entity Templates</h3>
          <p className="text-sm text-purple-700">
            Templates define the blueprint for entity types, including attribute schemas,
            expected identifiers, and alarm rules. When you create an entity instance, it inherits the
            structure defined in its template. Templates can be versioned to track changes over time.
          </p>
        </div>
      </div>
    </div>
  );
}
