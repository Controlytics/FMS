import { useRef } from 'react';

// PHOTO â€” file input
export interface PhotoInputProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}
export function PhotoInput({ value, onChange }: PhotoInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

  const compressImage = (dataUrl: string, quality: number, maxDim: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;

      // Check if base64 size exceeds limit
      if (dataUrl.length > MAX_PHOTO_BYTES) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        const shouldCompress = window.confirm(
          `Photo is ${sizeMB} MB which exceeds the 5 MB limit.\n\nWould you like to compress it automatically? The image will be resized and quality reduced to fit.`
        );
        if (!shouldCompress) {
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
        // Progressively compress until under limit
        let compressed = dataUrl;
        const attempts = [
          { quality: 0.7, maxDim: 1920 },
          { quality: 0.5, maxDim: 1280 },
          { quality: 0.3, maxDim: 800 },
        ];
        for (const { quality, maxDim } of attempts) {
          compressed = await compressImage(dataUrl, quality, maxDim);
          if (compressed.length <= MAX_PHOTO_BYTES) break;
        }
        if (compressed.length > MAX_PHOTO_BYTES) {
          alert('Could not compress the image enough. Please use a smaller photo.');
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
        const compressedMB = (compressed.length / 1024 / 1024).toFixed(1);
        onChange(compressed);
        return;
      }
      onChange(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    onChange(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Captured"
            className="w-full max-h-48 object-cover rounded-xl border border-slate-200"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md hover:bg-red-700 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full py-8 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-blue-400 transition-all flex flex-col items-center gap-2 text-slate-500 hover:text-blue-600"
        >
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-sm font-medium">Tap to capture photo</span>
          <span className="text-xs text-slate-400">Camera or gallery</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
