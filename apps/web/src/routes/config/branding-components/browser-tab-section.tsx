import type { RefObject } from 'react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import type { BrandingConfig } from '@digilog/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { DEFAULT_FAVICON_HREF } from '@/lib/document-branding';

interface BrowserTabSectionProps {
  browserTitle: string;
  faviconUrl: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFaviconUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFavicon: () => void;
  register: UseFormRegister<BrandingConfig>;
  errors: FieldErrors<BrandingConfig>;
}

/**
 * Browser tab identity — the name and icon shown on the browser tab itself.
 *
 * Title and icon live in ONE card rather than being split across App Identity
 * and a separate upload card: they are the same surface, and the operator can
 * only judge either of them against the mock tab below, which needs both.
 */
export function BrowserTabSection({
  browserTitle,
  faviconUrl,
  fileInputRef,
  onFaviconUpload,
  onRemoveFavicon,
  register,
  errors,
}: BrowserTabSectionProps) {
  // Empty === "use the bundled icon", which is exactly what the running app
  // does (applyFavicon falls back to DEFAULT_FAVICON_HREF), so the preview
  // cannot claim a blank tab icon the operator will never actually see.
  const previewIcon = faviconUrl || DEFAULT_FAVICON_HREF;

  return (
    <Card className="border-0 shadow-xl overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500" />
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white shadow-lg shadow-sky-500/25">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Browser Tab</h3>
            <p className="text-xs text-slate-500">Name and icon shown on the browser tab</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Tab Title</label>
            <Input
              {...register('browserTitle')}
              maxLength={60}
              placeholder="Filter Management System"
              className="rounded-xl h-11"
            />
            <p className="text-xs text-slate-400">
              Separate from App Name — this is what the browser tab and bookmarks show.
            </p>
            {errors.browserTitle && (
              <p className="text-xs text-red-500">{errors.browserTitle.message}</p>
            )}
          </div>

          <div className="flex items-start gap-6">
            <div className="flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-300 hover:border-sky-400 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden transition-all">
                <img src={previewIcon} alt="Tab icon preview" className="max-w-full max-h-full object-contain" />
              </div>
            </div>

            <div className="flex-1 space-y-3">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico,image/*"
                  onChange={onFaviconUpload}
                  className="hidden"
                  id="favicon-upload"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl hover:bg-sky-50 hover:text-sky-600 hover:border-sky-300"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload Icon
                </Button>
                {faviconUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onRemoveFavicon}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Reset
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
                PNG, SVG or ICO, square, 32-256px. Max size: 200KB — the icon is stored
                in the audit trail on every save, so keep it small. Reset restores the
                built-in icon.
              </p>
              <Input type="hidden" {...register('faviconUrl')} />
            </div>
          </div>

          {/* Mock tab so the operator sees the actual result, not a form field. */}
          <div className="pt-1">
            <p className="text-xs font-semibold text-slate-500 mb-2">Preview</p>
            <div className="rounded-t-xl bg-slate-200 px-2 pt-2">
              <div className="flex items-center gap-2 bg-white rounded-t-lg px-3 py-2 max-w-xs shadow-sm">
                <img src={previewIcon} alt="" className="w-4 h-4 object-contain flex-shrink-0" />
                <span className="text-xs text-slate-700 truncate">
                  {browserTitle || 'Filter Management System'}
                </span>
                <svg className="w-3 h-3 text-slate-400 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
