import { Monitor, Smartphone } from 'lucide-react';
import { Badge, EmptyRow, Table, TD, TH } from '@laneos/ui';
import { EndSessionButton } from '@/components/backoffice/StaffForm';
import { ago, fmtDateTime } from '@/lib/server/dates';

export interface SessionRow { id: string; createdAt: string; lastActive: string; userAgent: string | null; current: boolean; aal: string | null }

/** "Chrome on Windows" from a user-agent string; enough to recognise a device. */
function device(ua: string | null): { text: string; mobile: boolean } {
  if (!ua) return { text: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { text: os ? `${browser} on ${os}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

export function SessionsTable({ rows, empty }: { rows: SessionRow[]; empty: string }) {
  return (
    <Table>
      <thead><tr><TH>Device</TH><TH>Signed in</TH><TH>Last active</TH><TH>2-step</TH><TH /></tr></thead>
      <tbody>
        {rows.map((s) => {
          const d = device(s.userAgent);
          const Icon = d.mobile ? Smartphone : Monitor;
          return (
            <tr key={s.id}>
              <TD><span className="flex items-center gap-2 font-medium"><Icon size={16} className="text-text-muted" aria-hidden />{d.text}{s.current ? <Badge tone="brand">This device</Badge> : null}</span></TD>
              <TD>{fmtDateTime(s.createdAt)}</TD>
              <TD>{ago(s.lastActive)}</TD>
              <TD>{s.aal === 'aal2' ? <Badge tone="success">Verified</Badge> : <Badge>Password only</Badge>}</TD>
              <TD className="text-right"><EndSessionButton id={s.id} current={s.current} /></TD>
            </tr>
          );
        })}
        {rows.length === 0 ? <EmptyRow colSpan={5}>{empty}</EmptyRow> : null}
      </tbody>
    </Table>
  );
}
