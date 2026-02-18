import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { brandingConfigSchema, type BrandingConfig } from '@digilog/shared';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function BrandingConfigPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data, mutate } = useSWR('/api/config/branding');

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<BrandingConfig>({
    resolver: zodResolver(brandingConfigSchema),
    defaultValues: brandingConfigSchema.parse({}),
  });

  // Reset form when data loads from API (only once)
  const [initialized, setInitialized] = useState(false);
  if (data && !initialized) {
    reset(data);
    setInitialized(true);
  }

  const watchedValues = watch();

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 500KB)
    if (file.size > 500 * 1024) {
      setError('Logo image must be less than 500KB');
      return;
    }

    // Convert to base64 data URI
    const reader = new FileReader();
    reader.onloadend = () => {
      setValue('logoUrl', reader.result as string);
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setValue('logoUrl', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onSubmit = async (formData: BrandingConfig) => {
    setError('');
    try {
      await apiClient.put('/api/config/branding', formData);
      // Refresh the global branding cache so sidebar/login page updates
      await globalMutate('/api/config/branding');
      setShowSuccessPopup(true);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to update';
      setError(errorMsg);
      setShowErrorPopup(true);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Enhanced Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-fuchsia-600 p-6 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/config"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 border border-white/10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Branding Configuration</h1>
                  <p className="text-violet-100/80 text-sm">Customize appearance, logo, colors, and company information</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Settings */}
          <div className="space-y-6">
            {/* Logo Upload Section */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Logo</h3>
                    <p className="text-xs text-slate-500">Upload your company logo</p>
                  </div>
                </div>

                <div className="flex items-start gap-6">
                  {/* Logo Preview */}
                  <div className="flex-shrink-0">
                    <div className="w-28 h-28 rounded-2xl border-2 border-dashed border-slate-300 hover:border-violet-400 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden transition-all">
                      {watchedValues.logoUrl ? (
                        <img
                          src={watchedValues.logoUrl}
                          alt="Logo preview"
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div
                          className="w-20 h-20 rounded-xl flex items-center justify-center text-white font-bold text-3xl shadow-lg"
                          style={{
                            background: `linear-gradient(135deg, ${watchedValues.primaryColor || '#1e3a5f'}, ${watchedValues.secondaryColor || '#3b82f6'})`
                          }}
                        >
                          {watchedValues.logoText || 'DL'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Upload Controls */}
                  <div className="flex-1 space-y-3">
                    <div className="flex gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                        id="logo-upload"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload Logo
                      </Button>
                      {watchedValues.logoUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleRemoveLogo}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
                      PNG, JPG, SVG. Max size: 500KB. If no logo, text will be displayed.
                    </p>
                    <Input type="hidden" {...register('logoUrl')} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* App Identity Section */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">App Identity</h3>
                    <p className="text-xs text-slate-500">Configure app name and branding text</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Logo Text (fallback)</label>
                    <Input {...register('logoText')} maxLength={5} placeholder="DL" className="rounded-xl h-11" />
                    <p className="text-xs text-slate-400">Used when no logo is set</p>
                    {errors.logoText && <p className="text-xs text-red-500">{errors.logoText.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">App Name</label>
                    <Input {...register('appName')} placeholder="DigiLog" className="rounded-xl h-11" />
                    {errors.appName && <p className="text-xs text-red-500">{errors.appName.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">App Tagline</label>
                    <Input {...register('appTagline')} placeholder="21 CFR Part 11 Compliant" className="rounded-xl h-11" />
                    {errors.appTagline && <p className="text-xs text-red-500">{errors.appTagline.message}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Company Info Section */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Company Information</h3>
                    <p className="text-xs text-slate-500">Your company details</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Company Name</label>
                    <Input {...register('companyName')} placeholder="Company Name" className="rounded-xl h-11" />
                    {errors.companyName && <p className="text-xs text-red-500">{errors.companyName.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Version</label>
                    <Input {...register('version')} placeholder="1.0" className="rounded-xl h-11" />
                    {errors.version && <p className="text-xs text-red-500">{errors.version.message}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Primary Colors Section */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Primary Colors</h3>
                    <p className="text-xs text-slate-500">Main theme colors</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Primary Color</label>
                    <div className="flex gap-2">
                      <div className="relative">
                        <input
                          type="color"
                          {...register('primaryColor')}
                          className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                        />
                      </div>
                      <Input {...register('primaryColor')} placeholder="#1e3a5f" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                    {errors.primaryColor && <p className="text-xs text-red-500">{errors.primaryColor.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Secondary Color</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('secondaryColor')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('secondaryColor')} placeholder="#3b82f6" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                    {errors.secondaryColor && <p className="text-xs text-red-500">{errors.secondaryColor.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Accent Color</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('accentColor')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('accentColor')} placeholder="#8b5cf6" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                    {errors.accentColor && <p className="text-xs text-red-500">{errors.accentColor.message}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Gradient Colors Section */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Gradient Colors</h3>
                    <p className="text-xs text-slate-500">Decorative bar gradient</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Gradient Start</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('gradientStart')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('gradientStart')} placeholder="#3b82f6" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Gradient Middle</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('gradientMiddle')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('gradientMiddle')} placeholder="#8b5cf6" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Gradient End</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('gradientEnd')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('gradientEnd')} placeholder="#ec4899" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                  </div>
                </div>
                {/* Gradient Preview */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Preview</label>
                  <div
                    className="h-4 rounded-full shadow-inner"
                    style={{
                      background: `linear-gradient(to right, ${watchedValues.gradientStart || '#3b82f6'}, ${watchedValues.gradientMiddle || '#8b5cf6'}, ${watchedValues.gradientEnd || '#ec4899'})`
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Login Background Section */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-slate-600 via-slate-500 to-slate-400" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-lg shadow-slate-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Login Background</h3>
                    <p className="text-xs text-slate-500">Login page gradient background</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Background Start</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('loginBgStart')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('loginBgStart')} placeholder="#0f172a" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Background End</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        {...register('loginBgEnd')}
                        className="h-11 w-14 rounded-xl border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-colors"
                      />
                      <Input {...register('loginBgEnd')} placeholder="#1e3a5f" className="flex-1 rounded-xl h-11 font-mono text-sm" />
                    </div>
                  </div>
                </div>
                {/* Background Preview */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Preview</label>
                  <div
                    className="h-24 rounded-xl flex items-center justify-center shadow-inner"
                    style={{
                      background: `linear-gradient(to bottom right, ${watchedValues.loginBgStart || '#0f172a'}, ${watchedValues.loginBgEnd || '#1e3a5f'})`
                    }}
                  >
                    <span className="text-white/60 text-sm font-medium">Login Background</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Live Preview */}
          <div className="lg:sticky lg:top-6 space-y-6">
            <Card className="border-0 shadow-xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" />
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Live Preview</h3>
                    <p className="text-xs text-slate-500">See your changes in real-time</p>
                  </div>
                </div>

                {/* Login Preview */}
                <div
                  className="rounded-2xl p-8 shadow-2xl"
                  style={{
                    background: `linear-gradient(to bottom right, ${watchedValues.loginBgStart || '#0f172a'}, ${watchedValues.loginBgEnd || '#1e3a5f'})`
                  }}
                >
                  <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden max-w-sm mx-auto">
                    <div
                      className="h-2"
                      style={{
                        background: `linear-gradient(to right, ${watchedValues.gradientStart || '#3b82f6'}, ${watchedValues.gradientMiddle || '#8b5cf6'}, ${watchedValues.gradientEnd || '#ec4899'})`
                      }}
                    />
                    <div className="p-8 text-center">
                      {/* Logo Preview */}
                      {watchedValues.logoUrl ? (
                        <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
                          <img
                            src={watchedValues.logoUrl}
                            alt="Logo preview"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                      ) : (
                        <div
                          className="inline-flex items-center justify-center w-16 h-16 rounded-xl mb-4 shadow-xl"
                          style={{
                            background: `linear-gradient(to bottom right, ${watchedValues.primaryColor || '#1e3a5f'}, ${watchedValues.secondaryColor || '#3b82f6'})`
                          }}
                        >
                          <span className="text-2xl font-bold text-white">{watchedValues.logoText || 'DL'}</span>
                        </div>
                      )}
                      <h2
                        className="text-2xl font-bold mb-1"
                        style={{
                          background: `linear-gradient(to right, ${watchedValues.primaryColor || '#1e3a5f'}, ${watchedValues.secondaryColor || '#3b82f6'})`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                        }}
                      >
                        {watchedValues.appName || 'DigiLog'}
                      </h2>
                      <p className="text-xs text-slate-500 mb-6">{watchedValues.appTagline || '21 CFR Part 11 Compliant'}</p>

                      {/* Mock Login Form */}
                      <div className="space-y-3 mb-6">
                        <div className="h-10 rounded-lg bg-slate-100 border border-slate-200" />
                        <div className="h-10 rounded-lg bg-slate-100 border border-slate-200" />
                        <div
                          className="h-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold"
                          style={{
                            background: `linear-gradient(to right, ${watchedValues.primaryColor || '#1e3a5f'}, ${watchedValues.secondaryColor || '#3b82f6'})`
                          }}
                        >
                          Sign In
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-100">
                        <p className="text-sm font-semibold text-slate-600">{watchedValues.companyName || 'Company Name'}</p>
                        <p className="text-xs text-slate-400">Version {watchedValues.version || '1.0'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <Card className="border-0 shadow-xl overflow-hidden">
              <CardContent className="p-6">
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/config')}
                    className="flex-1 h-12 rounded-xl text-slate-600 hover:bg-slate-50"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 h-12 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-lg shadow-violet-500/25"
                  >
                    {isSubmitting ? (
                      <>
                        <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Info Banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-50 via-purple-50 to-fuchsia-50 border border-violet-100/50 p-5">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-violet-500/10 to-purple-500/10 rounded-full blur-3xl" />
              <div className="relative flex items-start gap-4">
                <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-violet-900 mb-1">Branding Tips</h3>
                  <p className="text-sm text-violet-700">
                    Changes apply globally across the application. Use consistent colors that reflect your company brand.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Success Popup */}
      <Dialog open={showSuccessPopup} onClose={() => setShowSuccessPopup(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-emerald-700 text-xl font-bold">Success!</span>
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-slate-600">Branding configuration has been updated successfully. Changes are now live across the application.</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => setShowSuccessPopup(false)} className="rounded-xl bg-gradient-to-r from-emerald-500 to-green-600">
            Done
          </Button>
        </div>
      </Dialog>

      {/* Error Popup */}
      <Dialog open={showErrorPopup} onClose={() => setShowErrorPopup(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/25">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <span className="text-red-700 text-xl font-bold">Update Failed</span>
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-slate-600">{error || 'Failed to update branding configuration. Please try again.'}</p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setShowErrorPopup(false)} className="rounded-xl">
            Close
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
