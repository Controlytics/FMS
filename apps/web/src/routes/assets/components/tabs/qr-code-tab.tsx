import { useState, useRef } from 'react';
import useSWR from 'swr';
import { QRCodeSVG } from 'qrcode.react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export function QrCodeTab({ entityId, entityName }: { entityId: string; entityName: string }) {
  const [size, setSize] = useState(200);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const { data: existing } = useSWR<{ id?: string; qrData?: string }>(`/api/qr/${entityId}`);
  const qrUrl = `${window.location.origin}/checklist/${entityId}`;
  const svgRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await apiClient.post(`/api/qr/${entityId}/generate`, { size: size >= 300 ? 'LARGE' : size >= 200 ? 'MEDIUM' : 'SMALL', includeLabel: true });
      setGenerated(true);
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const handleDownloadSVG = () => {
    const svgEl = svgRef.current?.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityName}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPNG = () => {
    const svgEl = svgRef.current?.querySelector('svg');
    if (!svgEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = size * 2;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    const svgData = new XMLSerializer().serializeToString(svgEl);
    img.onload = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${entityName}-qr.png`;
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
        <h4 className="font-semibold text-slate-800 mb-4">QR Code for {entityName}</h4>
        <p className="text-sm text-slate-500 mb-4">Scan this QR code to open the checklist for this entity.</p>
        <div ref={svgRef} className="inline-block p-4 bg-white rounded-xl border-2 border-slate-100 shadow-sm">
          <QRCodeSVG value={qrUrl} size={size} level="M" includeMargin />
        </div>
        <p className="text-xs text-slate-400 mt-3 font-mono break-all">{qrUrl}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Options</h4>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-slate-600">Size:</label>
          {[150, 200, 300].map(s => (
            <button key={s} onClick={() => setSize(s)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', size === s ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {s}px
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <Button onClick={handleDownloadPNG} className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm">
            Download PNG
          </Button>
          <Button onClick={handleDownloadSVG} variant="outline" className="text-sm">
            Download SVG
          </Button>
          {!existing?.id && !generated && (
            <Button onClick={handleGenerate} disabled={generating} variant="outline" className="text-sm">
              {generating ? 'Saving...' : 'Save to Entity'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
