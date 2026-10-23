'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Alert, EmptyRow, StatCard, Table, TD, TH, cn } from '@laneos/ui';
import { importChunk } from '@/app/(tenant)/backoffice/items/import/actions';
import { MAX_BYTES, TEMPLATE_VERSION, parseCsv, validateItems, type ImportProblem } from '@/lib/import/items';

interface Result { rows: number; processed: number; created: number; updated: number; problems: ImportProblem[] }

// Import items (Figma 11-4551): validate the whole file first, then send valid rows in chunks.
export function ImportItems() {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (file: File) => {
    setError(null); setResult(null); setFileName(file.name);
    if (file.size > MAX_BYTES) return setError('The file is larger than 10 MB.');
    const { rows, problems, headerError } = validateItems(parseCsv(await file.text()));
    if (headerError) return setError(headerError);
    const total = rows.length + new Set(problems.map((p) => p.row)).size;
    const res: Result = { rows: total, processed: total - rows.length, created: 0, updated: 0, problems };
    setResult({ ...res });
    setBusy(true);
    for (let i = 0; i < rows.length; i += 250) {
      const chunk = rows.slice(i, i + 250);
      const r = await importChunk(chunk);
      if (r.error) { setError(r.error); break; }
      res.created += r.created; res.updated += r.updated; res.processed += chunk.length;
      res.problems = [...res.problems, ...r.problems].sort((a, b) => a.row - b.row);
      setResult({ ...res });
    }
    setBusy(false);
  };

  const imported = result ? result.created + result.updated : 0;
  const pct = (n: number) => (result?.rows ? `${((n / result.rows) * 100).toFixed(1)}%` : '—');
  const errorRows = result ? new Set(result.problems.map((p) => p.row)).size : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void run(f); }}
        disabled={busy}
        className={cn('flex w-full flex-col items-center gap-2 rounded-card border-2 border-dashed bg-surface px-6 py-8 text-center transition',
          drag ? 'border-brand-primary bg-brand-light' : 'border-border-strong hover:border-brand-primary')}
      >
        <Upload size={24} className="text-text-muted" aria-hidden />
        <span className="text-[15px] font-semibold">{busy ? `Importing ${fileName}…` : `Drop ${TEMPLATE_VERSION}.csv here or click to choose`}</span>
        <span className="text-xs text-text-muted">Up to 10 MB · CSV saved from Excel or Google Sheets</span>
      </button>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ''; }} />
      {error ? <Alert>{error}</Alert> : null}

      {result ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Rows" value={result.rows.toLocaleString('en-US')} delta={pct(result.processed)} note="processed" />
            <StatCard label="Imported" value={imported.toLocaleString('en-US')} delta={pct(imported)} note={`${result.created} new + ${result.updated} updated`} />
            <StatCard label="Errors" value={errorRows.toLocaleString('en-US')} delta={errorRows ? 'fix and re-upload' : 'none'} deltaTone={errorRows ? 'danger' : 'success'} note={errorRows ? 'per row' : ''} />
          </section>
          <Table>
            <thead><tr><TH>Row</TH><TH>Column</TH><TH>Value</TH><TH>Problem</TH></tr></thead>
            <tbody>
              {result.problems.slice(0, 500).map((p, i) => (
                <tr key={i}><TD className="tabular-nums">{p.row}</TD><TD className="font-mono text-xs">{p.column}</TD><TD>{p.value || '—'}</TD><TD>{p.problem}</TD></tr>
              ))}
              {result.problems.length === 0 ? <EmptyRow colSpan={4}>{busy ? 'Importing…' : 'No problems. Every row was imported.'}</EmptyRow> : null}
            </tbody>
          </Table>
          {result.problems.length > 500 ? <p className="text-xs text-text-muted">Showing the first 500 problems.</p> : null}
        </>
      ) : null}
    </>
  );
}
