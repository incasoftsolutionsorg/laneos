'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, DollarSign, Minus, Plus, QrCode, Receipt as ReceiptIcon, ScanBarcode, Search } from 'lucide-react';
import { ERROR_TEXT, formatAmount, formatQty, formatRs, parseRupees, type ErrorCode } from '@laneos/core';
import { priceBasket } from '@laneos/pricing';
import { Alert, Badge, Button, Field, Input, ProductCard, buttonClass, chipClass, cn } from '@laneos/ui';
import {
  addLine, indexCatalog, resolveScan, setQty, toBasket, toPromotions, type CartLine, type CatalogItem, type LaneCatalog,
} from '@/lib/lane/cart';
import { getLaneKey, rememberLane } from '@/lib/lane/device';
import { publishDisplay } from '@/lib/lane/display';
import { holdBill, listHeld, takeHeld, type HeldBill } from '@/lib/lane/held';
import { printJob } from '@/lib/lane/print';
import { postSale, useSaleQueue } from '@/lib/lane/sync';
import { lockLane, type CustomerHit } from '@/app/(lane)/lane/actions';
import type { ReceiptData, ReceiptSettings } from '@/components/print/Receipt';
import { Dialog } from './Dialog';
import { LaneBar } from './LaneBar';
import { CustomerDialog, type AppliedNote } from './dialogs/CustomerDialog';
import { HoldDialog, RecallDialog } from './dialogs/HeldDialogs';
import { OfflineDialog } from './dialogs/OfflineDialog';
import { PaymentDialog, type Tender } from './dialogs/PaymentDialog';
import { PriceCheckDialog } from './dialogs/PriceCheckDialog';

type Pending =
  | { kind: 'weight' | 'price'; item: CatalogItem }
  | { kind: 'qty'; itemId: string }
  | { kind: 'pay'; mode: 'cash' | 'card' | 'lankaqr' | 'credit_note' | 'split' }
  | { kind: 'customer'; tab: 'member' | 'note' }
  | { kind: 'hold' } | { kind: 'recall' } | { kind: 'priceCheck' } | { kind: 'offline' }
  | null;

interface SaleDone { invoiceNo: string; totalCents: number; changeCents: number; offline: boolean; receipt: ReceiptData }

const colorIndex = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
const pad6 = (n: number) => String(n).padStart(6, '0');

function itemPrice(item: CatalogItem) {
  if (item.itemType === 'open_price' || item.priceCents == null) return 'Open price';
  return item.itemType === 'weighed' ? `${formatRs(item.priceCents)} / kg` : formatRs(item.priceCents);
}

function itemMeta(item: CatalogItem) {
  if (item.itemType === 'weighed') return 'Weighed';
  if (item.itemType === 'open_price') return '—';
  return `Stock ${Math.trunc(item.stockMilli / 1000)}`;
}

export function Checkout({ catalog, cashier, cashierRole, receipt, lockMinutes = 3 }: {
  catalog: LaneCatalog; cashier: string; cashierRole: string;
  receipt?: { settings: ReceiptSettings; address: string | null; phone: string | null };
  /** Settings → Security "Lane locks after" (blueprint §27.5.2, default 3 min). */
  lockMinutes?: number;
}) {
  const router = useRouter();
  const laneId = catalog.lane.id;
  const index = useMemo(() => indexCatalog(catalog.items), [catalog.items]);
  const promotions = useMemo(() => toPromotions(catalog.promotions), [catalog.promotions]);
  const promoName = useMemo(() => new Map(catalog.promotions.map((p) => [p.id, p.name])), [catalog.promotions]);

  const [laneKey, setLaneKeyState] = useState<string | null>(null);
  const sync = useSaleQueue(laneId, laneKey);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>(catalog.items.some((i) => i.isPinned) ? 'pinned' : 'all');
  const [recent, setRecent] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [appliedNote, setAppliedNote] = useState<AppliedNote | null>(null);
  const [held, setHeld] = useState<HeldBill[]>([]);
  const [done, setDone] = useState<SaleDone | null>(null);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID()); // one per sale, reused on retry
  const searchRef = useRef<HTMLInputElement>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    rememberLane(laneId);
    getLaneKey(laneId).then((k) => setLaneKeyState(k ?? null)).catch(() => undefined);
    setHeld(listHeld(laneId));
  }, [laneId]);

  const totals = useMemo(
    () => priceBasket(toBasket(cart, index), promotions, { roundingUnitCents: catalog.tenant.roundingUnitCents }),
    [cart, index, promotions, catalog.tenant.roundingUnitCents],
  );
  const pricedById = useMemo(() => new Map(totals.lines.map((l) => [l.itemId, l])), [totals.lines]);

  // Customer display (second screen) follows the basket.
  useEffect(() => {
    const promo = catalog.promotions[0];
    publishDisplay(laneId, {
      tenantName: catalog.tenant.name,
      status: done ? 'paid' : cart.length ? 'selling' : 'idle',
      changeCents: done?.changeCents,
      totalCents: done ? done.totalCents : totals.totalCents,
      savingsCents: totals.promoCents,
      promotion: promo ? { name: promo.name, detail: promo.kind === 'multi_buy' ? `${promo.buyQty} for ${formatRs(promo.bundlePriceCents ?? 0, { decimals: 0 })}` : `${(promo.percentBp ?? 0) / 100}% off` } : null,
      lines: cart.map((l) => {
        const item = index.byId.get(l.itemId)!;
        const p = pricedById.get(l.itemId);
        return {
          name: item.name,
          detail: item.itemType === 'weighed' ? formatQty(l.qtyMilli, 'weighed') : `${l.qtyMilli / 1000} × ${formatAmount(l.openPriceCents ?? item.priceCents ?? 0)}`,
          amountCents: p?.grossCents ?? 0,
          promo: p?.promoCents ? { name: promoName.get(p.promotionId ?? '') ?? 'Promotion', cents: p.promoCents } : undefined,
        };
      }),
    });
  }, [cart, done, totals, index, pricedById, promoName, laneId, catalog.tenant.name, catalog.promotions]);

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

  const resetSale = useCallback(() => {
    setCart([]); setCustomer(null); setAppliedNote(null); setNotice(null); setClientUuid(crypto.randomUUID());
  }, []);

  const lock = useCallback(async () => {
    // An unfinished bill is held, not lost, when the lane locks.
    if (cart.length) holdBill(laneId, { note: 'Held when the lane locked', cart, customer, totalCents: totals.totalCents });
    await lockLane(laneId);
    router.replace(`/lane/${laneId}/pin`);
  }, [cart, customer, laneId, router, totals.totalCents]);

  // Idle lock on registered lanes.
  useEffect(() => {
    if (!catalog.lane.registered) return;
    const touch = () => { lastActivity.current = Date.now(); };
    window.addEventListener('keydown', touch);
    window.addEventListener('pointerdown', touch);
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current > lockMinutes * 60_000 && !pending) void lock();
    }, 15_000);
    return () => { window.removeEventListener('keydown', touch); window.removeEventListener('pointerdown', touch); clearInterval(t); };
  }, [catalog.lane.registered, lock, pending, lockMinutes]);

  // Keyboard: F1 search, F2 qty, F4 void last line, F6 price check, F7 customer, F8 hold, F9 recall, F12 pay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pending || done) return;
      const last = cart.at(-1);
      const keys: Record<string, () => void> = {
        F1: () => searchRef.current?.focus(),
        F2: () => last && setPending({ kind: 'qty', itemId: last.itemId }),
        F4: () => last && setCart((c) => c.slice(0, -1)),
        F6: () => setPending({ kind: 'priceCheck' }),
        F7: () => setPending({ kind: 'customer', tab: 'member' }),
        F8: () => cart.length && setPending({ kind: 'hold' }),
        F9: () => setPending({ kind: 'recall' }),
        F12: () => cart.length && setPending({ kind: 'pay', mode: 'cash' }),
      };
      const fn = keys[e.key];
      if (fn) { e.preventDefault(); fn(); }
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

  // Lane-reserved invoice numbers (open-shift toggle): the receipt shows the final number even offline.
  const invKey = catalog.shift ? `laneos-inv-${catalog.shift.id}` : null;
  const nextReserved = (): number | null => {
    const s = catalog.shift;
    if (!s?.reservedFrom || !s.reservedTo || !invKey) return null;
    let stored = 0;
    try { stored = Number(localStorage.getItem(invKey)) || 0; } catch { /* ignore */ }
    const n = Math.max(stored, s.nextReserved ?? s.reservedFrom);
    return n <= s.reservedTo ? n : null;
  };
  const consumeReserved = (n: number | null) => {
    if (n != null && invKey) try { localStorage.setItem(invKey, String(n + 1)); } catch { /* ignore */ }
  };

  const buildReceipt = (invoiceNo: string, tenders: Tender[], changeCents: number, offline: boolean, token?: string): ReceiptData => ({
    tenant: catalog.tenant.name,
    shop: { name: catalog.shop.name, address: receipt?.address, phone: receipt?.phone },
    settings: receipt?.settings,
    invoiceNo,
    createdAt: new Date().toISOString(),
    lane: catalog.lane.code,
    cashier: cashier.split(' ')[0]!,
    customer: customer ? `${customer.name} · ${customer.phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3')}` : null,
    lines: cart.map((l) => {
      const item = index.byId.get(l.itemId)!;
      const p = pricedById.get(l.itemId);
      return {
        name: item.name,
        qtyLabel: item.itemType === 'weighed' ? (l.qtyMilli / 1000).toFixed(3) : String(l.qtyMilli / 1000),
        unitCents: l.openPriceCents ?? item.priceCents ?? 0,
        amountCents: p?.grossCents ?? 0,
        promo: p?.promoCents ? { name: promoName.get(p.promotionId ?? '') ?? 'Promotion', cents: p.promoCents } : null,
      };
    }),
    itemCount: cart.reduce((n, l) => n + (index.byId.get(l.itemId)?.itemType === 'weighed' ? 1 : l.qtyMilli / 1000), 0),
    subtotalCents: totals.subtotalCents,
    savedCents: totals.promoCents,
    roundingCents: totals.roundingCents,
    totalCents: totals.totalCents,
    payments: tenders.map((t) => ({ label: t.label, amountCents: t.amountCents })),
    changeCents,
    receiptUrl: token ? `${window.location.origin}/r/${token}` : null,
    offline,
  });

  const submit = async (tenders: Tender[], print: boolean): Promise<string | null> => {
    const reserved = nextReserved();
    const invoiceNo = reserved != null ? `${catalog.shop.code}-${catalog.lane.code}-${pad6(reserved)}` : undefined;
    const hasNote = tenders.some((t) => t.method === 'credit_note');
    const payload = {
      clientUuid,
      laneId,
      customerId: customer?.id ?? null,
      lines: cart.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, ...(l.openPriceCents ? { openPriceCents: l.openPriceCents } : {}) })),
      payments: tenders.map((t) => ({ method: t.method, amountCents: t.amountCents, ...(t.reference ? { reference: t.reference } : {}) })),
      expectedTotalCents: totals.totalCents,
      ...(invoiceNo ? { invoiceNo } : {}),
    };
    const paid = tenders.reduce((s, t) => s + t.amountCents, 0);

    const finish = (no: string, offline: boolean, token?: string, changeCents = paid - totals.totalCents) => {
      const receipt = buildReceipt(no, tenders, changeCents, offline, token);
      if (print) printJob({ kind: 'receipt', receipt });
      setPending(null);
      setDone({ invoiceNo: no, totalCents: totals.totalCents, changeCents, offline, receipt });
      return null;
    };
    const queue = async () => {
      if (hasNote) return ERROR_TEXT.CREDIT_NOTE_OFFLINE!;
      await sync.enqueue({ clientUuid, laneId, invoiceNo: invoiceNo ?? null, totalCents: totals.totalCents, queuedAt: new Date().toISOString(), attempts: 0, status: 'queued', payload });
      consumeReserved(reserved);
      return finish(invoiceNo ?? 'Number at sync', true);
    };

    // While offline with sales already waiting, keep the order: queue behind them.
    if (!sync.online && sync.queue.length) return queue();

    const r = await postSale(payload, laneKey);
    if (r.kind === 'ok') {
      consumeReserved(reserved);
      return finish(r.data.invoiceNo, false, r.data.receiptToken, r.data.changeCents);
    }
    if (r.kind === 'network') return queue();
    if (r.code === 'PRICE_MISMATCH') router.refresh();
    return ERROR_TEXT[r.code as ErrorCode] ?? r.message ?? 'The sale could not be saved.';
  };

  const newSale = () => {
    setDone(null);
    resetSale();
    router.refresh(); // fresh stock figures and catalogue
    searchRef.current?.focus();
  };

  const openDisplay = () => window.open(`/lane/${laneId}/display`, `laneos-display-${laneId}`, 'popup,width=1024,height=640');

  const bar = (
    <LaneBar
      title={`${catalog.tenant.name} · ${catalog.shop.name}`}
      laneId={laneId}
      laneCode={catalog.lane.code}
      shift={catalog.shift}
      cashier={cashier}
      cashierRole={cashierRole}
      online={sync.online}
      queued={sync.queue.length}
      onStatus={() => setPending({ kind: 'offline' })}
      onLock={catalog.lane.registered ? () => void lock() : undefined}
      onDisplay={openDisplay}
    />
  );

  if (done) {
    return (
      <div className="flex h-screen flex-col bg-background">
        {bar}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-dialog bg-surface p-8 text-center shadow-sm">
            <Badge tone={done.offline ? 'warning' : 'success'}>{done.offline ? 'Saved on this lane · will sync' : 'Paid'}</Badge>
            <p className="font-mono text-xs text-text-muted">{done.invoiceNo}</p>
            <p className="text-[28px] font-bold text-brand-primary">{formatRs(done.totalCents)}</p>
            {done.changeCents > 0 ? <p className="text-lg font-semibold">Change {formatRs(done.changeCents)}</p> : null}
            <div className="flex w-full gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => printJob({ kind: 'receipt', receipt: done.receipt })}>
                <ReceiptIcon size={16} aria-hidden /> Reprint
              </Button>
              <Button onClick={newSale} className="flex-1" autoFocus>New sale</Button>
            </div>
          </div>
        </div>
        {pending?.kind === 'offline' ? <OfflineDialog queue={sync.queue} online={sync.online} offlineSince={sync.offlineSince} nextRetryAt={sync.nextRetryAt} onRetry={() => void sync.syncNow()} onClose={() => setPending(null)} /> : null}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {bar}
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
              <button type="button" onClick={() => setPending({ kind: 'customer', tab: 'member' })} className={buttonClass('secondary')}>+ Customer</button>
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
          {appliedNote ? <Row label={`Credit note ${appliedNote.noteNo}`} value={`balance ${formatRs(appliedNote.balanceCents)}`} /> : null}
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-bold">Total</span>
            <span className="text-[28px] font-bold text-brand-primary tabular-nums">{formatRs(totals.totalCents)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <PayButton icon={<DollarSign size={18} aria-hidden />} label="Cash" className="bg-brand-primary text-white" disabled={!cart.length} onClick={() => setPending({ kind: 'pay', mode: appliedNote ? 'split' : 'cash' })} />
            <PayButton icon={<CreditCard size={18} aria-hidden />} label="Card" className="bg-info text-white" disabled={!cart.length} onClick={() => setPending({ kind: 'pay', mode: 'card' })} />
            <PayButton icon={<QrCode size={18} aria-hidden />} label="LankaQR" className="bg-lankaqr text-white" disabled={!cart.length} onClick={() => setPending({ kind: 'pay', mode: 'lankaqr' })} />
            <PayButton icon={<ReceiptIcon size={18} aria-hidden />} label="Credit note" className="bg-brand-light text-brand-primary" disabled={!cart.length || !sync.online} onClick={() => setPending({ kind: 'customer', tab: 'note' })} />
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button type="button" className={chipClass(false)} disabled={!cart.length} onClick={() => { const l = cart.at(-1); if (l) setPending({ kind: 'qty', itemId: l.itemId }); }}>F2 Qty</button>
            <button type="button" className={chipClass(false)} disabled={!cart.length} onClick={() => setCart((c) => c.slice(0, -1))}>F4 Void line</button>
            <button type="button" className={chipClass(false)} onClick={() => setPending({ kind: 'priceCheck' })}>F6 Price check</button>
            <button type="button" className={chipClass(false)} disabled={!cart.length} onClick={() => setPending({ kind: 'hold' })}>F8 Hold</button>
            <button type="button" className={chipClass(false)} onClick={() => setPending({ kind: 'recall' })}>F9 Recall{held.length ? ` (${held.length})` : ''}</button>
            {cart.length ? <button type="button" onClick={resetSale} className={chipClass(false)}>Clear sale</button> : null}
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
              if (cart.some((l) => l.itemId === pending.item.id)) setCart((c) => setQty(c, pending.item.id, grams)); else add(pending.item, grams);
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
        <CustomerDialog
          laneId={laneId}
          offline={!sync.online}
          initialTab={pending.tab}
          onClose={() => setPending(null)}
          onAttach={(c) => { setCustomer(c); setPending(null); }}
          onApplyNote={(n) => { setAppliedNote(n); setPending({ kind: 'pay', mode: n.balanceCents >= totals.totalCents ? 'credit_note' : 'split' }); }}
        />
      ) : null}

      {pending?.kind === 'pay' ? (
        <PaymentDialog
          totalCents={totals.totalCents}
          laneId={laneId}
          offline={!sync.online}
          initialMode={pending.mode}
          appliedNote={appliedNote}
          customer={customer}
          onClose={() => setPending(null)}
          submit={submit}
        />
      ) : null}

      {pending?.kind === 'hold' ? (
        <HoldDialog
          onClose={() => setPending(null)}
          onHold={(note) => {
            holdBill(laneId, { note, cart, customer, totalCents: totals.totalCents });
            setHeld(listHeld(laneId));
            resetSale();
            setPending(null);
          }}
        />
      ) : null}

      {pending?.kind === 'recall' ? (
        <RecallDialog
          bills={held}
          onClose={() => setPending(null)}
          onRecall={(id) => {
            if (cart.length) holdBill(laneId, { note: 'Swapped for a recalled bill', cart, customer, totalCents: totals.totalCents });
            const bill = takeHeld(laneId, id);
            setHeld(listHeld(laneId));
            if (bill) {
              setCart(bill.cart);
              setCustomer(bill.customer ? { ...bill.customer, loyaltyPoints: bill.customer.loyaltyPoints ?? 0, marketingConsent: false, since: new Date().toISOString() } : null);
              setClientUuid(crypto.randomUUID());
            }
            setPending(null);
          }}
        />
      ) : null}

      {pending?.kind === 'priceCheck' ? (
        <PriceCheckDialog
          index={index} items={catalog.items} promotions={catalog.promotions} mode={catalog.tenant.embeddedBarcodeMode}
          shopCode={catalog.shop.code} onClose={() => setPending(null)} onAdd={(item) => { setPending(null); pick(item); }}
        />
      ) : null}

      {pending?.kind === 'offline' ? (
        <OfflineDialog queue={sync.queue} online={sync.online} offlineSince={sync.offlineSince} nextRetryAt={sync.nextRetryAt} onRetry={() => void sync.syncNow()} onClose={() => setPending(null)} />
      ) : null}
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
    <Dialog title={title} onClose={onClose} width={380}>
      <form onSubmit={(e) => { e.preventDefault(); setError(onSubmit(value)); }} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Field label={label}><Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus /></Field>
        <Button type="submit">OK</Button>
      </form>
    </Dialog>
  );
}

