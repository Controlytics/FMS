import useSWR from 'swr';

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
  const { data, isLoading } = useSWR<{ data: BinaryFile[]; total: number }>(
    `/api/data/binaries/${entityId}`,
    { revalidateOnMount: true, dedupingInterval: 0 }
  );

  const files = data?.data ?? [];

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
          return (
            <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
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
