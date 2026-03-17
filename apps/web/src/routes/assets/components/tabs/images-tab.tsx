import { useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';

interface BinaryFile {
  time: string;
  dataType: string;
  filePath: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  mimeType: string;
}

export function ImagesTab({ entityId }: { entityId: string }) {
  const { data, isLoading, mutate } = useSWR<{ data: BinaryFile[]; total: number }>(
    `/api/data/binaries/${entityId}`,
    { revalidateOnMount: true, dedupingInterval: 0 }
  );
  const [deleting, setDeleting] = useState<string | null>(null);

  const files = data?.data ?? [];

  const handleDelete = async (file: BinaryFile) => {
    if (!confirm(`Delete "${file.fileName}"?`)) return;
    setDeleting(file.filePath);
    try {
      await apiClient.delete(`/api/data/binaries/${entityId}?filePath=${encodeURIComponent(file.filePath)}`);
      mutate();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-slate-500">No images received yet.</p>
        <p className="text-xs text-slate-400 mt-1">Send images via POST /api/data/binary</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Received Images ({files.length})</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {files.map((file, idx) => {
          const isImage = file.mimeType?.startsWith('image/');
          const uploadsIdx = file.filePath?.indexOf('/uploads/') ?? -1;
          const imageUrl = uploadsIdx >= 0 ? file.filePath.substring(uploadsIdx) : file.filePath;
          const isDeleting = deleting === file.filePath;
          return (
            <div key={idx} className="relative border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow group">
              {isImage ? (
                <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                  <img src={imageUrl} alt={file.fileName} className="w-full h-32 object-cover bg-slate-50" />
                </a>
              ) : (
                <div className="w-full h-32 bg-slate-50 flex items-center justify-center">
                  <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              )}
              <button
                onClick={() => handleDelete(file)}
                disabled={isDeleting}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow-lg"
                title="Delete image"
              >
                {isDeleting ? (
                  <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
              <div className="p-2">
                <p className="text-xs font-medium text-slate-700 truncate">{file.fileName}</p>
                <p className="text-[10px] text-slate-400">{new Date(file.time).toLocaleString()} · {(file.fileSize / 1024).toFixed(1)} KB</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
