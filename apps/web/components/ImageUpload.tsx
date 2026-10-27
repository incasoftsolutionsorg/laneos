'use client';

import { useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { Alert, Button, cn } from '@laneos/ui';
import { createClient } from '@/lib/supabase/browser';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Uploads one image straight to Supabase Storage (the policies check tenant and permission), then hands the path
 *  to `onChange` — or keeps it in a hidden input `name` for plain forms. */
export function ImageUpload({
  bucket, folder, base, value, previewUrl, onChange, name, label = 'Upload image', maxMb = 2, allowSvg = false, className,
}: {
  bucket: string; folder: string; base: string; value?: string | null; previewUrl?: string | null;
  onChange?: (path: string | null) => Promise<string | null | void> | void; name?: string;
  label?: string; maxMb?: number; allowSvg?: boolean; className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState(value ?? null);
  const [preview, setPreview] = useState<string | null>(previewUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    setError(null);
    const types = allowSvg ? TYPES : TYPES.filter((t) => t !== 'image/svg+xml');
    if (!types.includes(file.type)) return setError(`Use ${allowSvg ? 'PNG, JPG, WebP or SVG' : 'PNG, JPG or WebP'}.`);
    if (file.size > maxMb * 1024 * 1024) return setError(`The file is larger than ${maxMb} MB.`);
    const ext = file.type === 'image/svg+xml' ? 'svg' : file.type.split('/')[1]!.replace('jpeg', 'jpg');
    const target = `${folder}/${base}-${Date.now()}.${ext}`;
    setBusy(true);
    const { error: e } = await createClient().storage.from(bucket).upload(target, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });
    if (e) { setBusy(false); return setError(e.message.includes('row-level security') ? 'You do not have permission to upload here.' : e.message); }
    const err = await onChange?.(target);
    setBusy(false);
    if (err) return setError(err);
    setPath(target);
    setPreview(URL.createObjectURL(file));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-16 rounded-control border border-border object-contain" />
        ) : null}
        <input ref={input} type="file" accept={(allowSvg ? TYPES : TYPES.slice(0, 3)).join(',')} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          <ImageUp size={16} aria-hidden /> {busy ? 'Uploading…' : preview ? 'Replace' : label}
        </Button>
        {preview ? (
          <button type="button" disabled={busy} className="flex items-center gap-1 text-xs font-semibold text-danger hover:underline"
            onClick={async () => { const err = await onChange?.(null); if (err) return setError(err); setPath(null); setPreview(null); }}>
            <Trash2 size={13} aria-hidden /> Remove
          </button>
        ) : null}
      </div>
      {name ? <input type="hidden" name={name} value={path ?? ''} /> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
