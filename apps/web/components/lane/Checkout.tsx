'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, DollarSign, Minus, Plus, QrCode, ScanBarcode, Search } from 'lucide-react';
import { ERROR_TEXT, formatAmount, formatQty, formatRs, parseRupees, type ErrorCode, type PaymentMethod } from '@laneos/core';
import { priceBasket } from '@laneos/pricing';
import { Alert, Badge, Button, Field, Input, ProductCard, buttonClass, chipClass, cn } from '@laneos/ui';
import {
  addLine, indexCatalog, quickTenders, resolveScan, setQty, toBasket, toPromotions, type CartLine, type CatalogItem,
  type LaneCatalog,
} from '@/lib/lane/cart';
import { findCustomer, type CustomerHit } from '@/app/(lane)/lane/actions';
import { Dialog } from './Dialog';
import { LaneBar } from './LaneBar';
import { CloseShiftDialog } from './ShiftPanels';

type Pending =
  | { kind: 'weight' | 'price'; item: CatalogItem }
  | { kind: 'qty'; itemId: string }
  | { kind: 'pay'; method: PaymentMethod }
  | { kind: 'customer' }
  | { kind: 'closeShift' }
  | null;

interface SaleDone { invoiceNo: string; totalCents: number; changeCents: number }

const colorIndex = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);

function itemPrice(item: CatalogItem) {
  if (item.itemType === 'open_price' || item.priceCents == null) return 'Open price';
  return item.itemType === 'weighed' ? `${formatRs(item.priceCents)} / kg` : formatRs(item.priceCents);
}

function itemMeta(item: CatalogItem) {
  if (item.itemType === 'weighed') return 'Weighed';
  if (item.itemType === 'open_price') return '—';
  return `Stock ${Math.trunc(item.stockMilli / 1000)}`;
}

export function Checkout({ catalog, cashier }: { catalog: LaneCatalog; cashier: string }) {
  const router = useRouter();
  const index = useMemo(() => indexCatalog(catalog.items), [catalog.items]);
  const promotions = useMemo(() => toPromotions(catalog.promotions), [catalog.promotions]);
  const promoName = useMemo(() => new Map(catalog.promotions.map((p) => [p.id, p.name])), [catalog.promotions]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>(catalog.items.some((i) => i.isPinned) ? 'pinned' : 'all');
  const [recent, setRecent] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [done, setDone] = useState<SaleDone | null>(null);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID()); // one per sale, reused on retry
  const searchRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(
    () => priceBasket(toBasket(cart, index), promotions, { roundingUnitCents: catalog.tenant.roundingUnitCents }),
    [cart, index, promotions, catalog.tenant.roundingUnitCents],
  );
  const pricedById = useMemo(() => new Map(totals.lines.map((l) => [l.itemId, l])), [totals.lines]);

  const add = useCallback((item: CatalogItem, qtyMilli: number, openPriceCents?: number) => {
    setCart((c) => addLine(c, { itemId: item.id, qtyMilli, openPriceCents }));
    setRecent((r) => [item.id, ...r.filter((id) => id !== item.id)].slice(0, 30));
    setNotice(null);
  }, []);

  const pick = useCallback((item: CatalogItem) => {
    if (item.itemType === 'weighed') return setPending({ kind: 'weight', item });
    if (item.itemType === 'open_price' || item.priceCents == null) return setPending({ kind: 'price', item });
    add(item, 1000);
  }, [add]);

  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    // Text that is not a code just filters the grid; Enter on a single match adds it.
    if (!/^[0-9A-Z-]+$/i.test(code)) {
      const matches = catalog.items.filter((i) => i.name.toLowerCase().includes(code.toLowerCase()));
      if (matches.length === 1) { pick(matches[0]!); setQuery(''); }
      return;
    }
    const outcome = resolveScan(index, code, catalog.tenant.embeddedBarcodeMode);
    if (!outcome.ok) { setNotice(outcome.message); setQuery(''); return; }
    if (outcome.needs) setPending({ kind: outcome.needs, item: outcome.item });
    else add(outcome.item, outcome.qtyMilli);
    setQuery('');
  };

  // Keyboard: F1 search, F2 quantity of the last line, F4 void the last line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pending || done) return;
      const last = cart.at(-1);
      if (e.key === 'F1') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F2' && last) { e.preventDefault(); setPending({ kind: 'qty', itemId: last.itemId }); }
      if (e.key === 'F4' && last) { e.preventDefault(); setCart((c) => c.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, pending, done]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items = catalog.items;
    if (q && !/^\d+$/.test(q)) items = items.filter((i) => i.name.toLowerCase().includes(q));
    else if (filter === 'pinned') items = items.filter((i) => i.isPinned);
    else if (filter === 'recent') items = recent.map((id) => index.byId.get(id)).filter((i): i is CatalogItem => !!i);
    else if (filter !== 'all') items = items.filter((i) => i.departmentId === filter);
    return items.slice(0, 120);
  }, [catalog.items, query, filter, recent, index]);

  const newSale = () => {
    setCart([]); setCustomer(null); setDone(null); setNotice(null); setClientUuid(crypto.randomUUID());
    router.refresh(); // fresh stock figures and catalogue version
    searchRef.current?.focus();
  };

  if (done) {
    return (
      <Screen catalog={catalog} cashier={cashier} onCloseShift={() => setPending({ kind: 'closeShift' })}>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-dialog bg-surface p-8 text-center shadow-sm">
            <Badge tone="success">Paid</Badge>
            <p className="font-mono text-xs text-text-muted">{done.invoiceNo}</p>
            <p className="text-[28px] font-bold text-brand-primary">{formatRs(done.totalCents)}</p>
            {done.changeCents > 0 ? <p className="text-lg font-semibold">Change {formatRs(done.changeCents)}</p> : null}
            <p className="text-xs text-text-muted">Receipt printing comes with the device task (QZ Tray).</p>
            <Button onClick={newSale} className="w-full" autoFocus>New sale</Button>
          </div>
        </div>
        {pending?.kind === 'closeShift' && catalog.shift ? <CloseShiftDialog shiftId={catalog.shift.id} onClose={() => setPending(null)} /> : null}
      </Screen>
    );
  }

  return (
    <Screen catalog={catalog} cashier={cashier} onCloseShift={() => setPending({ kind: 'closeShift' })}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Items */}
        <section className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5" aria-label="Items">
          <div className="flex gap-2.5">
            <form onSubmit={onScan} className="relative flex-1">
              <Search size={20} className="absolute top-1/2 left-4 -translate-y-1/2 text-text-placeholder" aria-hidden />
              <input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search item name, PLU or scan barcode…"
                aria-label="Search or scan"
                className="w-full rounded-[10px] border border-brand-primary bg-surface py-3.5 pr-14 pl-12 text-[15px] placeholder:text-text-placeholder focus:ring-2 focus:ring-brand-light focus:outline-none"
              />
              <Badge className="absolute top-1/2 right-4 -translate-y-1/2">F1</Badge>
            </form>
            <span className="hidden items-center gap-2 rounded-[10px] bg-brand-primary px-4 text-[13px] font-semibold text-white sm:flex">
              <ScanBarcode size={20} aria-hidden /> Scanner ready
            </span>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter items">
            {[['all', 'All'], ['pinned', 'Pinned'], ['recent', 'Recent'], ...catalog.departments.map((d) => [d.id, d.name])].map(([key, label]) => (
              <button key={key} type="button" onClick={() => { setFilter(key!); setQuery(''); }} className={chipClass(filter === key && !query)} aria-pressed={filter === key}>
                {label}
              </button>
            ))}
          </div>

          {notice ? <Alert tone="warning">{notice}</Alert> : null}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {visible.map((item) => (
              <ProductCard key={item.id} name={item.name} price={itemPrice(item)} meta={itemMeta(item)} colorIndex={colorIndex(item.id)} onClick={() => pick(item)} />
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-text-muted">
              {filter === 'recent' ? 'Items you sell appear here.' : catalog.items.length === 0 ? 'No items in the catalogue yet. Add items in the back office.' : 'No items match.'}
            </p>
          ) : null}
        </section>

        {/* Current sale */}
        <aside className="flex w-full shrink-0 flex-col gap-3 border-l border-border bg-surface p-5 lg:w-[460px]" aria-label="Current sale">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <h2 className="text-[17px] font-bold">Current sale</h2>
              <p className="text-xs text-text-muted">{catalog.shop.code}-{catalog.lane.code} · {cart.length} {cart.length === 1 ? 'line' : 'lines'}</p>
            </div>
            {customer ? (
              <button type="button" onClick={() => setCustomer(null)} className={buttonClass('soft')} title="Remove customer">{customer.name} ✕</button>
            ) : (
              <button type="button" onClick={() => setPending({ kind: 'customer' })} className={buttonClass('secondary')}>+ Customer</button>
            )}
          </div>

          <ul className="flex min-h-[120px] flex-1 flex-col overflow-y-auto">
            {cart.map((line) => {
              const item = index.byId.get(line.itemId)!;
              const priced = pricedById.get(line.itemId);
              const unit = line.openPriceCents ?? item.priceCents ?? 0;
              const promo = priced?.promotionId ? promoName.get(priced.promotionId) : null;
              const weighed = item.itemType === 'weighed';
              return (
                <li key={line.itemId} className="flex items-center gap-2.5 rounded-md px-1.5 py-2.5 hover:bg-surface-muted">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{item.name}</p>
                    <p className="text-xs text-text-muted">
                      {formatQty(line.qtyMilli, item.itemType)} × {formatAmount(unit)}{promo ? ` · ${promo}` : ''}
                    </p>
                  </div>
                  {weighed ? (
                    <button type="button" onClick={() => setPending({ kind: 'weight', item })} className="text-xs font-semibold text-brand-primary">Weight</button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button type="button" aria-label={`One less ${item.name}`} onClick={() => setCart((c) => setQty(c, line.itemId, line.qtyMilli - 1000))} className="flex size-[26px] items-center justify-center rounded-md border border-border"><Minus size={14} aria-hidden /></button>
                      <button type="button" onClick={() => setPending({ kind: 'qty', itemId: line.itemId })} className="min-w-6 text-center text-[13px] font-semibold">{line.qtyMilli / 1000}</button>
                      <button type="button" aria-label={`One more ${item.name}`} onClick={() => setCart((c) => setQty(c, line.itemId, line.qtyMilli + 1000))} className="flex size-[26px] items-center justify-center rounded-md border border-border"><Plus size={14} aria-hidden /></button>
                    </div>
                  )}
                  <p className="w-[76px] text-right text-[13px] font-bold tabular-nums">{formatAmount(priced?.grossCents ?? 0)}</p>
                </li>
              );
            })}
            {cart.length === 0 ? <li className="py-10 text-center text-[13px] text-text-muted">Scan an item or tap a card to start.</li> : null}
          </ul>

          <div className="h-px bg-border" />
          <Row label="Subtotal" value={formatRs(totals.subtotalCents)} />
          <Row label="Promotions & savings" value={totals.promoCents ? `− ${formatRs(totals.promoCents)}` : formatRs(0)} />
          <Row label="Cash rounding" value={`${totals.roundingCents < 0 ? '−' : '+'} ${formatRs(Math.abs(totals.roundingCents))}`} />
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-bold">Total</span>
            <span className="text-[28px] font-bold text-brand-primary tabular-nums">{formatRs(totals.totalCents)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <PayButton icon={<DollarSign size={18} aria-hidden />} label="Cash" className="bg-brand-primary text-white" disabled={!cart.length} onClick={() => setPending({ kind: 'pay', method: 'cash' })} />
            <PayButton icon={<CreditCard size={18} aria-hidden />} label="Card" className="bg-info text-white" disabled={!cart.length} onClick={() => setPending({ kind: 'pay', method: 'card' })} />
            <PayButton icon={<QrCode size={18} aria-hidden />} label="LankaQR" className="bg-lankaqr text-white" disabled={!cart.length} onClick={() => setPending({ kind: 'pay', method: 'lankaqr' })} />
            <PayButton icon={null} label="Credit note · M3" className="bg-brand-light text-brand-primary" disabled onClick={() => undefined} />
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className={chipClass(false)}>F2 Qty</span>
            <span className={chipClass(false)}>F4 Void line</span>
            {cart.length ? <button type="button" onClick={() => setCart([])} className={chipClass(false)}>Clear sale</button> : null}
          </div>
        </aside>
      </div>

      {pending?.kind === 'weight' || pending?.kind === 'price' ? (
        <AmountDialog
          title={pending.kind === 'weight' ? `Weight · ${pending.item.name}` : `Price · ${pending.item.name}`}
          label={pending.kind === 'weight' ? 'Weight (kg)' : 'Price (Rs)'}
          onClose={() => setPending(null)}
          onSubmit={(text) => {
            if (pending.kind === 'weight') {
              const kg = Number(text);
              if (!(kg > 0 && kg <= 100)) return 'Enter a weight between 0.001 and 100 kg.';
              const grams = Math.round(kg * 1000);
              const existing = cart.find((l) => l.itemId === pending.item.id);
              if (existing) setCart((c) => setQty(c, pending.item.id, grams)); else add(pending.item, grams);
            } else {
              const cents = parseRupees(text);
              if (!cents) return 'Enter a price, e.g. 250.00';
              if (pending.item.mrpCents != null && cents > pending.item.mrpCents) return `Above the MRP of ${formatRs(pending.item.mrpCents)}.`;
              add(pending.item, 1000, cents);
            }
            setPending(null);
            return null;
          }}
        />
      ) : null}

      {pending?.kind === 'qty' ? (
        <AmountDialog
          title={`Quantity · ${index.byId.get(pending.itemId)?.name ?? ''}`}
          label="Quantity"
          initial={String((cart.find((l) => l.itemId === pending.itemId)?.qtyMilli ?? 1000) / 1000)}
          onClose={() => setPending(null)}
          onSubmit={(text) => {
            const n = Number(text);
            if (!Number.isInteger(n) || n < 0 || n > 9999) return 'Enter a whole number (0 removes the line).';
            setCart((c) => setQty(c, pending.itemId, n * 1000));
            setPending(null);
            return null;
          }}
        />
      ) : null}

      {pending?.kind === 'customer' ? (
        <CustomerDialog onClose={() => setPending(null)} onPick={(c) => { setCustomer(c); setPending(null); }} />
      ) : null}

      {pending?.kind === 'pay' ? (
        <PaymentDialog
          method={pending.method}
          totalCents={totals.totalCents}
          onClose={() => setPending(null)}
          submit={async (payments) => {
            const body = {
              clientUuid,
              laneId: catalog.lane.id,
              customerId: customer?.id ?? null,
              lines: cart.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, ...(l.openPriceCents ? { openPriceCents: l.openPriceCents } : {}) })),
              payments,
              expectedTotalCents: totals.totalCents,
            };
            let res: Response;
            try {
              res = await fetch('/api/lane/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientUuid },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(8000),
              });
            } catch {
              return 'No connection to the server. Check the network and press Pay again — the sale will not be charged twice.';
            }
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
              setPending(null);
              setDone({ invoiceNo: json.invoiceNo, totalCents: json.totalCents, changeCents: json.changeCents });
              return null;
            }
            const code = json?.error?.code as ErrorCode | undefined;
            if (code === 'PRICE_MISMATCH') router.refresh();
            return (code && ERROR_TEXT[code]) || 'The sale could not be saved.';
          }}
        />
      ) : null}

      {pending?.kind === 'closeShift' && catalog.shift ? <CloseShiftDialog shiftId={catalog.shift.id} onClose={() => setPending(null)} /> : null}
    </Screen>
  );
}

function Screen({ catalog, cashier, onCloseShift, children }: { catalog: LaneCatalog; cashier: string; onCloseShift: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <LaneBar title={`${catalog.tenant.name} · ${catalog.shop.name}`} laneCode={catalog.lane.code} shift={catalog.shift} cashier={cashier} onCloseShift={onCloseShift} />
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function PayButton({ icon, label, className, onClick, disabled }: { icon: React.ReactNode; label: string; className: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn('flex items-center justify-center gap-2 rounded-[10px] py-4 text-sm font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50', className)}>
      {icon}{label}
    </button>
  );
}

function AmountDialog({ title, label, initial = '', onClose, onSubmit }: {
  title: string; label: string; initial?: string; onClose: () => void; onSubmit: (text: string) => string | null;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} onClose={onClose} width={360}>
      <form onSubmit={(e) => { e.preventDefault(); setError(onSubmit(value)); }} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Field label={label}><Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus /></Field>
        <Button type="submit">OK</Button>
      </form>
    </Dialog>
  );
}

function CustomerDialog({ onClose, onPick }: { onClose: () => void; onPick: (c: CustomerHit) => void }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Add customer to sale" onClose={onClose} width={360}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const hit = await findCustomer(phone);
          setBusy(false);
          if (hit) onPick(hit); else setError('No customer with that mobile number. Add them in the back office.');
        }}
        className="flex flex-col gap-4"
      >
        {error ? <Alert tone="warning">{error}</Alert> : null}
        <Field label="Mobile number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="077 123 4567" autoFocus /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Looking up…' : 'Find customer'}</Button>
      </form>
    </Dialog>
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', lankaqr: 'LankaQR', credit_note: 'Credit note' };

function PaymentDialog({ method, totalCents, onClose, submit }: {
  method: PaymentMethod;
  totalCents: number;
  onClose: () => void;
  submit: (payments: { method: PaymentMethod; amountCents: number; reference?: string }[]) => Promise<string | null>;
}) {
  const [tendered, setTendered] = useState(method === 'cash' ? '' : formatAmount(totalCents));
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cents = method === 'cash' ? parseRupees(tendered) : totalCents;
  const change = cents != null ? cents - totalCents : null;

  return (
    <Dialog title={`${METHOD_LABEL[method]} payment`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (cents == null || cents < totalCents) return setError('The amount is less than the total.');
          setBusy(true);
          setError(await submit([{ method, amountCents: cents, ...(reference ? { reference } : {}) }]));
          setBusy(false);
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-text-muted">Total due</span>
          <span className="text-2xl font-bold text-brand-primary">{formatRs(totalCents)}</span>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {method === 'cash' ? (
          <>
            <Field label="Cash received (Rs)"><Input value={tendered} onChange={(e) => setTendered(e.target.value)} inputMode="decimal" autoFocus /></Field>
            <div className="flex flex-wrap gap-2">
              {quickTenders(totalCents).map((q) => (
                <button key={q} type="button" onClick={() => setTendered(formatAmount(q))} className={chipClass(cents === q)}>
                  {q === totalCents ? 'Exact' : formatRs(q, { decimals: 0 })}
                </button>
              ))}
            </div>
            <div className="flex items-baseline justify-between rounded-control bg-surface-muted px-3 py-2.5">
              <span className="text-[13px] text-text-muted">Change</span>
              <span className={cn('text-lg font-bold', change != null && change < 0 ? 'text-danger' : 'text-text')}>
                {change == null ? '—' : change < 0 ? `Short ${formatRs(-change)}` : formatRs(change)}
              </span>
            </div>
          </>
        ) : (
          <Field label="Reference (optional)" hint="Last 4 digits or approval code — never the full card number">
            <Input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 64))} autoFocus />
          </Field>
        )}
        <Button type="submit" disabled={busy || cents == null || cents < totalCents}>
          {busy ? 'Saving…' : `Pay ${formatRs(totalCents)}`}
        </Button>
      </form>
    </Dialog>
  );
}
