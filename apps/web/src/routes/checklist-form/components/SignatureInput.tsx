import { useEffect, useRef } from 'react';
import SignaturePad from 'signature_pad';

// SIGNATURE â€” canvas pad
export interface SignatureInputProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}
export function SignatureInput({ value, onChange }: SignatureInputProps) {
  const canvasRef = useRef<HTMLCanvasElement>(undefined as unknown as HTMLCanvasElement);
  const padRef = useRef<SignaturePad>(undefined as unknown as SignaturePad);

  useEffect(() => {
    if (!canvasRef.current) return;
    const pad = new SignaturePad(canvasRef.current, {
      backgroundColor: 'rgb(248, 250, 252)',
      penColor: '#1e3a5f',
      minWidth: 1,
      maxWidth: 3,
    });
    padRef.current = pad;
    pad.addEventListener('endStroke', () => {
      onChange(pad.isEmpty() ? null : pad.toDataURL('image/png'));
    });
    // Resize canvas to display size
    const canvas = canvasRef.current;
    const ratio = Math.max(window.devicePixelRatio ?? 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);
    pad.clear();
    return () => {
      pad.off();
    };
  }, [onChange]);

  // Restore existing signature if provided
  useEffect(() => {
    if (!padRef.current || !value) return;
    padRef.current.fromDataURL(value);
  }, [value]);

  const handleClear = () => {
    padRef.current?.clear();
    onChange(null);
  };

  const handleUndo = () => {
    if (!padRef.current) return;
    const data = padRef.current.toData();
    if (data && data.length > 0) {
      data.pop();
      padRef.current.fromData(data);
      onChange(
        padRef.current.isEmpty()
          ? null
          : padRef.current.toDataURL('image/png'),
      );
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-slate-200 overflow-hidden bg-slate-50">
        <canvas
          ref={canvasRef}
          className="w-full touch-none"
          style={{ height: '160px', display: 'block' }}
        />
        {!value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-slate-400 italic">Sign here...</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleUndo}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
          Undo
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
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
          Clear
        </button>
        {value && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 bg-emerald-50">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Signed
          </span>
        )}
      </div>
    </div>
  );
}
