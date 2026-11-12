// Upload dropzone + camera capture. Files stay on the device: the browser hashes them (SubtleCrypto, < 200 MB), reads a
// short text sample for text/CSV/XML/JSON, and posts only metadata to POST /participant/ingest/files.
import { useRef, useState, type DragEvent } from 'react';
import { Upload, Camera, FolderUp } from 'lucide-react';
import type { UploadFileInput, UploadResult } from '@shared/api-types';
import { api } from '../api';
import { pushToast, toastError } from '../toast';
import { sha256Hex, textSample, formatBytes } from '../digest';
import { DemoOnlyHint } from './Brand';

export type UploadDropzoneProps = {
  maxFileBytes?: number | null;
  acceptedTypes?: string[];
  onDone?: (r: UploadResult) => void;
};

type Progress = { name: string; bytes: number; stage: 'hashing' | 'posting' | 'done' | 'rejected'; note?: string };

export async function describeFiles(files: File[], onProgress?: (p: Progress[]) => void): Promise<UploadFileInput[]> {
  const prog: Progress[] = files.map((f) => ({ name: f.name, bytes: f.size, stage: 'hashing' }));
  onProgress?.([...prog]);
  const out: UploadFileInput[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const [sha256, sample] = await Promise.all([sha256Hex(f), textSample(f)]);
    out.push({ name: f.name, bytes: f.size, mime: f.type || 'application/octet-stream', sha256, textSample: sample, lastModified: Number.isFinite(f.lastModified) ? new Date(f.lastModified).toISOString() : null });
    prog[i] = { ...prog[i], stage: 'posting' };
    onProgress?.([...prog]);
  }
  return out;
}

export function UploadDropzone({ maxFileBytes, acceptedTypes, onDone }: UploadDropzoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]);

  const handle = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0 || busy) return;
    setBusy(true);
    try {
      const inputs = await describeFiles(files, setProgress);
      const r = await api.post<UploadResult>('/participant/ingest/files', inputs);
      const parts: string[] = [];
      if (r.autoFiled > 0) parts.push(`${r.autoFiled} filed automatically`);
      if (r.needsReview > 0) parts.push(`${r.needsReview} to review`);
      if (r.rejected.length > 0) parts.push(`${r.rejected.length} rejected`);
      pushToast(r.rejected.length > 0 && r.autoFiled + r.needsReview === 0 ? 'error' : 'success', `${files.length} file${files.length === 1 ? '' : 's'} received: ${parts.join(', ') || 'queued'}${r.rewardCents > 0 ? ` · +$${(r.rewardCents / 100).toFixed(2)} reward` : ''}`);
      for (const rej of r.rejected) pushToast('error', `${rej.name}: ${rej.reason}`);
      setProgress([]);
      onDone?.(r);
    } catch (e) {
      toastError(e, 'Upload');
      setProgress([]);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files);
  };
  const accept = acceptedTypes && acceptedTypes.length > 0 ? acceptedTypes.join(',') : undefined;

  return (
    <div className="col gap-8">
      <div
        className={`dropzone${over ? ' dropzone--over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
        aria-label="Upload files"
      >
        <span className="dropzone__icon"><Upload /></span>
        <div className="dropzone__title">{busy ? 'Reading files…' : 'Drop files or a folder here'}</div>
        <div className="dropzone__sub">
          Lab PDFs, MRI / CT (DICOM), genome VCFs, device CSV exports, meal photos. Files are fingerprinted on your device; only the name, size and a hash leave it.
          {maxFileBytes ? ` Up to ${formatBytes(maxFileBytes)} per file.` : ''}
        </div>
        <DemoOnlyHint />
        <div className="dropzone__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => fileRef.current?.click()}><Upload /> Choose files</button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => folderRef.current?.click()}><FolderUp /> Upload a folder</button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => camRef.current?.click()}><Camera /> Take a photo</button>
        </div>
        <input ref={fileRef} type="file" multiple accept={accept} onChange={(e) => { void handle(e.target.files); e.target.value = ''; }} data-testid="upload-input" />
        <input ref={folderRef} type="file" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { void handle(e.target.files); e.target.value = ''; }} data-testid="upload-folder" />
        <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={(e) => { void handle(e.target.files); e.target.value = ''; }} data-testid="upload-camera" />
      </div>
      {progress.length > 0 && (
        <div className="upload-prog">
          {progress.map((p) => (
            <div className="upload-prog__row" key={p.name}>
              <span className="upload-prog__name">{p.name}</span>
              <span className="faint">{formatBytes(p.bytes)}</span>
              <span className="pill pill--neutral pill--sm">{p.stage === 'hashing' ? 'hashing' : p.stage === 'posting' ? 'classifying' : p.stage}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
