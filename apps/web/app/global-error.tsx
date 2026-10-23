'use client';

// Last-resort error page (the root layout itself failed), so it brings its own <html> and plain styles.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>LaneOS could not load</h1>
          <p style={{ fontSize: 14, opacity: 0.7 }}>Nothing was lost. Reload the page; if it keeps happening, contact LaneOS support.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 8, border: 0, cursor: 'pointer' }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
