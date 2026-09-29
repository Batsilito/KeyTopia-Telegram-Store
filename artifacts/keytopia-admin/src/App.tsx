import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type FormEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useRoute } from 'wouter';
import {
  Activity, AlertTriangle, Archive, ArrowDownRight, ArrowUpRight, BarChart3, Bell, Boxes, Check, ChevronDown,
  CircleDollarSign, ClipboardList, Clock3, CreditCard, Database, FileClock, Filter, Gauge,
  FileSpreadsheet, Headphones, KeyRound, LayoutDashboard, LogOut, Menu, Package, Percent, Plus, RefreshCw,
  Image as ImageIcon, Link2, RotateCcw, Search, Settings2, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Tag, Ticket, Trash2,
  Truck, Unlink, Upload, UserRound, Users, WalletCards, X, type LucideIcon,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  useAdminLogin, useAdminLogout, useAdjustCustomerWallet, useConfirmPayment, useCreateFlashSale, useStopFlashSale, useCreateProduct, useDeleteProduct,
  useCreatePromoCode, useDeletePromoCode, useUpdatePromoCode, useDeliverOrder, useDisableInventory, useGetAdminSession,
  useGetAnalyticsSummary, useGetDashboardOverview, useGetInventorySummary, useGetStoreSettings,
  useImportInventory, useListCustomers, useListFlashSales, useListInventory, useListOrders,
  useListPayments, useListProducts, useListPromoCodes, useListSupportTickets, useGetSupportTicket,
  useRejectPayment, useReplyToSupportTicket, useUpdateOrderStatus, useUpdateProduct, useUpdateSupportTicket,
  useUpdateStoreSettings, getGetAdminSessionQueryKey, getGetAnalyticsSummaryQueryKey,
  getGetDashboardOverviewQueryKey, getGetInventorySummaryQueryKey, getGetStoreSettingsQueryKey,
  useRequestProductImageUpload, useSetManualProductStock,
  useSendAdminTelegramTest,
  getListCustomersQueryKey, getListFlashSalesQueryKey, getListInventoryQueryKey,
  getListOrdersQueryKey, getListPaymentsQueryKey, getListProductsQueryKey,
  getListPromoCodesQueryKey, getListSupportTicketsQueryKey,
  useGetVenteBotCatalog, useTestVenteBotConnection, useRefreshVenteBotCatalog,
  useCreateVenteBotStorefrontProduct,
  useUpdateVenteBotMapping, useListVenteBotOrders, useRetryVenteBotOrder,
  getGetVenteBotCatalogQueryKey, getListVenteBotOrdersQueryKey,
} from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/error-boundary';

const queryClient = new QueryClient();

type AdminSessionCacheData = {
  authenticated: boolean;
  admin: { id: string; email: string; name: string; role: string } | null;
};

function updateAdminSessionCache(session: AdminSessionCacheData) {
  const sessionKey = getGetAdminSessionQueryKey();
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== sessionKey[0],
  });
  queryClient.setQueryData(sessionKey, session);
}

const navGroups: { label: string; items: { href: string; label: string; icon: LucideIcon; count?: string }[] }[] = [
  { label: 'Command', items: [{ href: '/', label: 'Overview', icon: LayoutDashboard }, { href: '/orders', label: 'Orders', icon: ShoppingBag }, { href: '/payments', label: 'Payment review', icon: CreditCard, count: 'live' }, { href: '/support', label: 'Support queue', icon: Headphones }] },
  { label: 'Merchandising', items: [{ href: '/products', label: 'Products', icon: Package }, { href: '/inventory', label: 'Inventory', icon: Boxes }, { href: '/flash-sales', label: 'Flash sales', icon: Tag }, { href: '/promo-codes', label: 'Promo codes', icon: Percent }] },
  { label: 'Intelligence', items: [{ href: '/customers', label: 'Customers', icon: Users }, { href: '/analytics', label: 'Analytics', icon: BarChart3 }] },
  { label: 'Control', items: [{ href: '/settings', label: 'Store settings', icon: Settings2 }, { href: '/ventebot', label: 'VenteBot', icon: Link2 }, { href: '/audit-logs', label: 'Audit logs', icon: FileClock }] },
];

const money = (value?: number | null) => `$${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const initials = (value?: string | null) => (value || 'KT').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

function Button({ children, variant = 'primary', className = '', ...props }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = { primary: 'bg-primary text-primary-foreground hover:brightness-95', secondary: 'bg-secondary text-secondary-foreground hover:bg-muted', quiet: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground', danger: 'bg-destructive text-destructive-foreground hover:brightness-95' };
  return <button className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`} {...props}>{children}</button>;
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'orange' | 'red' | 'blue' }) {
  const tones = { neutral: 'bg-muted text-muted-foreground', green: 'bg-primary/12 text-primary', orange: 'bg-accent/16 text-accent-foreground', red: 'bg-destructive/12 text-destructive', blue: 'bg-sky-500/12 text-sky-700' };
  return <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold uppercase tracking-[.08em] ${tones[tone]}`}>{children}</span>;
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card panel-shadow ${className}`}>{children}</section>;
}

function Skeleton({ className = '' }: { className?: string }) { return <div className={`skeleton rounded-lg ${className}`} />; }
function LoadingBlock() { return <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-64 md:col-span-2" /><Skeleton className="h-64" /></div>; }
function EmptyState({ icon: Icon = Archive, title, body, action }: { icon?: LucideIcon; title: string; body: string; action?: ReactNode }) { return <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center"><div className="mb-4 rounded-2xl bg-muted p-3 text-primary"><Icon size={22} /></div><h3 className="font-extrabold">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>{action && <div className="mt-4">{action}</div>}</div>; }
function ErrorState({ retry }: { retry?: () => void }) { return <div className="flex min-h-48 flex-col items-center justify-center text-center"><div className="rounded-full bg-destructive/10 p-3 text-destructive"><X size={20} /></div><p className="mt-3 font-bold">Could not load this queue</p><p className="mt-1 text-sm text-muted-foreground">The operations API did not respond. Try again in a moment.</p>{retry && <Button variant="secondary" className="mt-4" onClick={retry}><RefreshCw size={15} /> Retry</Button>}</div>; }

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="grid gap-1.5 text-sm font-bold"><span>{label}</span>{children}{hint && <span className="text-xs font-medium text-muted-foreground">{hint}</span>}</label>; }
function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/15 ${props.className || ''}`} />; }
function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${props.className || ''}`} />; }
function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/15 ${props.className || ''}`} />; }
function Modal({
  title,
  children,
  onClose,
  footer,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  return createPortal(
    <div className="fixed inset-0 z-40 overflow-y-auto bg-foreground/30 p-3 backdrop-blur-sm md:p-5">
      <div className="flex min-h-full items-center justify-center">
        <div className={`my-1 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card p-5 shadow-2xl md:max-h-[calc(100dvh-2.5rem)] ${className}`}>
          <div className="mb-5 flex shrink-0 items-center justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Operator action</p>
              <h2 className="mt-1 text-xl font-extrabold">{title}</h2>
            </div>
            <Button variant="quiet" className="px-2" onClick={onClose} aria-label="Close dialog"><X size={18} /></Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">{children}</div>
          {footer && <div className="mt-4 shrink-0 border-t border-border pt-4">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), staleTime: 60_000 } });
  const logout = useAdminLogout();
  const admin = session.data?.admin;
  const current = navGroups.flatMap((group) => group.items).find((item) => item.href === location);
  if (session.isLoading) return <div className="min-h-[100dvh] bg-background p-5"><div className="mx-auto max-w-7xl"><Skeleton className="h-16" /><div className="mt-8"><LoadingBlock /></div></div></div>;
  if (!session.data?.authenticated) return <Login />;
  const logoutNow = () => logout.mutate(undefined, {
    onSuccess: () => {
      updateAdminSessionCache({ authenticated: false, admin: null });
      setLocation('/login');
    },
  });
  return <div className="noise min-h-[100dvh] bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[270px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-3"><Link href="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)} data-testid="link-brand"><span className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><KeyRound size={18} strokeWidth={2.5} /></span><span><strong className="block text-[15px] tracking-tight">KeyTopia</strong><span className="font-mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/55">control room</span></span></Link><button className="rounded-md p-1 text-sidebar-foreground/60 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="mt-8 flex-1 overflow-y-auto pr-1">{navGroups.map((group) => <div key={group.label} className="mb-6"><p className="mb-2 px-3 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-sidebar-foreground/40">{group.label}</p><div className="grid gap-1">{group.items.map(({ href, label, icon: Icon, count }) => { const active = location === href; return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-bold transition ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/66 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><span className="flex items-center gap-3"><Icon size={17} strokeWidth={active ? 2.4 : 1.8} />{label}</span>{count === 'live' && <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-sidebar-primary-foreground' : 'bg-accent'}`} />}</Link>; })}</div></div>)}</div>
      <div className="border-t border-sidebar-border pt-4"><div className="mb-3 flex items-center gap-3 rounded-xl bg-sidebar-accent/60 p-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-black text-accent-foreground">{initials(admin?.name)}</div><div className="min-w-0"><p className="truncate text-xs font-bold">{admin?.name || 'Operator'}</p><p className="truncate font-mono text-[10px] text-sidebar-foreground/45">{admin?.email || 'admin@keytopia'}</p></div></div><button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold text-sidebar-foreground/60 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={logoutNow} data-testid="button-logout"><LogOut size={16} /> Sign out</button></div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-20 bg-foreground/20 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
    <main className="min-h-[100dvh] md:pl-[270px]"><header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-md md:px-8"><div className="flex items-center gap-3"><button className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div><p className="font-mono text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">KeyTopia / operations</p><h1 className="mt-0.5 text-lg font-extrabold tracking-tight">{current?.label || 'Overview'}</h1></div></div><div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full bg-primary/8 px-3 py-1.5 text-xs font-bold text-primary sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> API online</div><button className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications" data-testid="button-notifications"><Bell size={18} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /></button></div></header><div className="mx-auto max-w-[1480px] p-5 md:p-8">{children}</div></main>
  </div>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p><h2 className="mt-2 text-3xl font-extrabold tracking-[-.04em] md:text-4xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action && <div className="shrink-0">{action}</div>}</div>; }

function StatCard({ label, value, sub, icon: Icon, tone = 'green' }: { label: string; value: string | number; sub: ReactNode; icon: LucideIcon; tone?: 'green' | 'orange' | 'blue' | 'red' }) { return <Card className="relative overflow-hidden p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-extrabold tracking-[-.05em]">{value}</p><p className="mt-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">{sub}</p></div><div className={`rounded-xl p-2.5 ${tone === 'green' ? 'bg-primary/10 text-primary' : tone === 'orange' ? 'bg-accent/15 text-accent' : tone === 'blue' ? 'bg-sky-500/10 text-sky-700' : 'bg-destructive/10 text-destructive'}`}><Icon size={19} /></div></div><div className={`absolute bottom-0 left-0 h-1 w-1/3 ${tone === 'green' ? 'bg-primary' : tone === 'orange' ? 'bg-accent' : tone === 'blue' ? 'bg-sky-500' : 'bg-destructive'}`} /></Card>; }

function Overview() {
  const query = useGetDashboardOverview({ query: { queryKey: getGetDashboardOverviewQueryKey(), staleTime: 30_000 } });
  if (query.isLoading) return <><PageIntro eyebrow="Daily pulse" title="Good morning, operator." description="Loading your live operational picture." /><LoadingBlock /></>;
  if (query.isError || !query.data) return <><PageIntro eyebrow="Daily pulse" title="Good morning, operator." description="Your control room is temporarily out of reach." /><Card><ErrorState retry={() => query.refetch()} /></Card></>;
  const d = { ...query.data, recentTickets: query.data.recentTickets as Array<{ status: string; [key: string]: any }> };
  return (
    <div className="animate-rise">
      <section className="relative isolate mb-7 min-h-[240px] overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-950 shadow-xl">
        <img src="/keytopia-hero.png" alt="KeyTopia software subscriptions and digital tools" className="absolute inset-0 h-full w-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/60 to-slate-950/10" />
        <div className="relative flex min-h-[240px] max-w-xl flex-col justify-center p-7 text-white md:p-10">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[.24em] text-cyan-200">KeyTopia Store</p>
          <h2 className="mt-3 max-w-md text-3xl font-extrabold tracking-[-.04em] md:text-4xl">Unlock more possibilities.</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/75">Software accounts, subscriptions, and digital tools — managed from one focused control room.</p>
        </div>
      </section>
      <PageIntro
        eyebrow="Daily pulse"
        title="Good morning, operator."
        description="A clear view of what needs attention across KeyTopia today."
        action={<Button variant="secondary" onClick={() => query.refetch()} data-testid="button-refresh-overview"><RefreshCw size={15} /> Refresh board</Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Gross revenue today" value={money(d.revenueTodayUsd)} sub="Order value before tracked costs" icon={CircleDollarSign} />
        <StatCard label="Net profit today" value={money(d.realizedProfitTodayUsd)} sub="Delivered sales minus tracked costs; fees excluded" icon={ArrowUpRight} tone="blue" />
        <StatCard label="Orders today" value={d.ordersToday} sub="Orders created today" icon={ShoppingBag} tone="blue" />
        <StatCard label="Payment review" value={d.pendingPayments} sub="Waiting for confirmation" icon={Clock3} tone="orange" />
        <StatCard label="Awaiting delivery" value={d.awaitingDelivery} sub="Paid, not fulfilled" icon={Truck} tone="red" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div><h3 className="font-extrabold">Recent orders</h3><p className="mt-1 text-xs text-muted-foreground">Latest storefront activity</p></div>
            <Link href="/orders" className="text-xs font-extrabold text-primary hover:underline" data-testid="link-view-orders">View queue</Link>
          </div>
          {d.recentOrders.length ? <div className="divide-y divide-border">{d.recentOrders.slice(0, 6).map((order) => <OrderRow key={order.id} order={order} />)}</div> : <EmptyState icon={ShoppingBag} title="No orders yet" body="New storefront orders will show up here." />}
        </Card>
        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div><p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Pressure points</p><h3 className="mt-2 text-xl font-extrabold">Queues to watch</h3></div>
              <Gauge className="text-primary" size={21} />
            </div>
            <div className="mt-5 grid gap-3">
              <QueueLink href="/support" label="Open support tickets" value={d.openSupportTickets} icon={Headphones} tone="orange" />
              <QueueLink href="/inventory" label="Low-stock products" value={d.lowStockProducts} icon={Boxes} tone="red" />
              <QueueLink href="/flash-sales" label="Active flash sales" value={d.activeFlashSales} icon={Tag} tone="green" />
              <QueueLink href="/customers" label="New customers" value={d.newCustomers} icon={Users} tone="blue" />
            </div>
          </Card>
          <Card>
            <div className="border-b border-border px-5 py-4"><h3 className="font-extrabold">Payment review</h3><p className="mt-1 text-xs text-muted-foreground">Most recent submissions</p></div>
            {d.recentPayments.length ? <div className="divide-y divide-border">{d.recentPayments.slice(0, 4).map((payment) => <PaymentRow key={payment.id} payment={payment} compact />)}</div> : <EmptyState icon={CreditCard} title="No payment submissions" body="Payment reviews will appear here." />}
          </Card>
        </div>
      </div>
      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div><h3 className="font-extrabold">Support radar</h3><p className="mt-1 text-xs text-muted-foreground">Tickets with the latest customer touch</p></div>
          <Link href="/support" className="text-xs font-extrabold text-primary hover:underline" data-testid="link-view-support">Open support</Link>
        </div>
        {d.recentTickets.length ? <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">{d.recentTickets.slice(0, 3).map((ticket) => <div key={ticket.id} className="p-5"><div className="flex items-center justify-between"><Badge tone={ticket.status === 'open' ? 'orange' : 'neutral'}>{titleCase(ticket.status)}</Badge><span className="font-mono text-[10px] text-muted-foreground">{date(ticket.updatedAt)}</span></div><p className="mt-3 text-sm font-extrabold">{ticket.subject}</p><p className="mt-1 text-xs text-muted-foreground">{ticket.customerName} · {ticket.lastMessage}</p></div>)}</div> : <EmptyState icon={Headphones} title="No support activity" body="The support radar is quiet." />}
      </Card>
    </div>
  );
}

function QueueLink({ href, label, value, icon: Icon, tone }: { href: string; label: string; value: number; icon: LucideIcon; tone: 'green' | 'orange' | 'red' | 'blue' }) { return <Link href={href} className="flex items-center justify-between rounded-xl border border-border bg-background/60 p-3 transition hover:border-primary/40 hover:bg-primary/5" data-testid={`link-queue-${label.toLowerCase().replaceAll(' ', '-')}`}><span className="flex items-center gap-3 text-sm font-bold"><span className={`rounded-lg p-2 ${tone === 'green' ? 'bg-primary/10 text-primary' : tone === 'orange' ? 'bg-accent/15 text-accent' : tone === 'red' ? 'bg-destructive/10 text-destructive' : 'bg-sky-500/10 text-sky-700'}`}><Icon size={16} /></span>{label}</span><strong className="font-mono text-lg">{value}</strong></Link>; }

function OrderRow({ order }: { order: any }) { return <div className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-primary"><ShoppingBag size={16} /></div><div className="min-w-0"><p className="truncate text-sm font-extrabold">{order.productName}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{order.orderNumber} · {order.customerName}</p></div></div><div className="text-right"><p className="font-mono text-sm font-bold">{money(order.priceUsd)}</p><Badge tone={order.status === 'delivered' ? 'green' : order.status === 'cancelled' ? 'red' : order.status === 'processing' ? 'blue' : 'orange'}>{order.status}</Badge></div></div>; }
function PaymentRow({ payment, compact = false }: { payment: any; compact?: boolean }) { return <div className="flex items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-extrabold">{payment.customerName}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{payment.orderNumber || 'Unlinked'} · {titleCase(payment.paymentMethod)}</p></div><div className="text-right"><p className="font-mono text-sm font-bold">{money(payment.usdAmount)}</p>{!compact && <p className="mt-1 text-xs text-muted-foreground">{date(payment.submittedAt)}</p>}<Badge tone={payment.status === 'confirmed' ? 'green' : payment.status === 'rejected' ? 'red' : 'orange'}>{payment.status}</Badge></div></div>; }

function Orders() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<any>('all'); const [page, setPage] = useState(1); const [deliverId, setDeliverId] = useState<string | null>(null); const [deliveryInfo, setDeliveryInfo] = useState(''); const [acquisitionCostText, setAcquisitionCostText] = useState('');
  const params = useMemo(() => ({ page, pageSize: 20, search: search || undefined, status }), [page, search, status]);
  const query = useListOrders(params); const update = useUpdateOrderStatus(); const deliver = useDeliverOrder(); const qc = useQueryClient();
  const refresh = () => { query.refetch(); qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }); };
  const statusNow = (id: string, next: any) => update.mutate({ orderId: id, data: { status: next } }, { onSuccess: refresh });
  const acquisitionCostUsd = Number(acquisitionCostText);
  const validAcquisitionCost = /^\d{1,10}(?:\.\d{1,2})?$/.test(acquisitionCostText.trim()) &&
    Number.isFinite(acquisitionCostUsd) &&
    acquisitionCostUsd >= 0 &&
    acquisitionCostUsd <= 9999999999.99;
  return <div className="animate-rise">
    <PageIntro eyebrow="Fulfillment desk" title="Orders" description="Find an order, move it through fulfillment, and keep the storefront promise intact." action={<Button variant="secondary" onClick={refresh} data-testid="button-refresh-orders"><RefreshCw size={15} /> Refresh</Button>} />
    <Card>
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} /><Input className="pl-9" placeholder="Search order number or customer" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-search-orders" /></div>
        <Select className="md:w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="select-order-status">
          <option value="all">All statuses</option><option value="paid">Paid</option><option value="processing">Processing</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
        </Select>
        <Button variant="quiet"><Filter size={15} /> Filters</Button>
      </div>
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data?.items.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-muted/55 text-[10px] uppercase tracking-[.12em] text-muted-foreground">
            <tr><th className="px-5 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Acquisition cost</th><th className="px-4 py-3">Profit</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.data.items.map((order: any) => <tr key={order.id} className="transition hover:bg-muted/30" data-testid={`row-order-${order.id}`}>
              <td className="px-5 py-4"><p className="font-mono text-xs font-bold">{order.orderNumber}</p><p className="mt-1 text-xs text-muted-foreground">{date(order.createdAt)}</p></td>
              <td className="px-4 py-4"><p className="font-bold">{order.customerName}</p><p className="mt-1 text-xs text-muted-foreground">{order.productName}</p></td>
              <td className="px-4 py-4 text-xs font-semibold">{titleCase(order.paymentMethod)}</td>
              <td className="px-4 py-4 font-mono font-bold">{money(order.priceUsd)}</td>
              <td className="px-4 py-4 font-mono text-xs">{order.acquisitionCostUsd == null ? '—' : money(order.acquisitionCostUsd)}</td>
              <td className={`px-4 py-4 font-mono text-xs font-bold ${order.realizedProfitUsd < 0 ? 'text-destructive' : 'text-primary'}`}>{order.realizedProfitUsd == null ? '—' : money(order.realizedProfitUsd)}</td>
              <td className="px-4 py-4"><Badge tone={order.status === 'delivered' ? 'green' : order.status === 'cancelled' ? 'red' : order.status === 'processing' ? 'blue' : 'orange'}>{order.status}</Badge></td>
              <td className="px-5 py-4 text-right">
                {order.status === 'paid' && <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => statusNow(order.id, 'processing')} disabled={update.isPending} data-testid={`button-process-order-${order.id}`}>Start processing</Button>}
                {order.status === 'processing' && order.deliveryType === 'manual' && <Button className="px-2.5 py-1.5 text-xs" onClick={() => { setDeliverId(order.id); setDeliveryInfo(order.deliveryInfo || ''); setAcquisitionCostText(''); }} data-testid={`button-deliver-order-${order.id}`}><Truck size={13} /> Deliver</Button>}
                {order.status === 'processing' && order.deliveryType === 'automatic' && <span className="text-xs font-semibold text-muted-foreground">Auto fulfillment</span>}
                {order.status === 'delivered' && <span className="text-xs font-bold text-primary">Fulfilled</span>}
                {order.status === 'cancelled' && <span className="text-xs font-bold text-muted-foreground">Closed</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState icon={ShoppingBag} title="No orders match" body="Try a different search or widen the status filter." />}
      {query.data && <Pager page={query.data.page} total={query.data.total} pageSize={query.data.pageSize} onPage={setPage} />}
    </Card>
    {deliverId && <Modal title="Complete delivery" onClose={() => setDeliverId(null)}>
      <p className="mb-4 text-sm text-muted-foreground">Record what the customer received and what it cost to fulfill this order.</p>
      <div className="grid gap-4">
        <Field label="Delivery information"><Textarea value={deliveryInfo} onChange={(e) => setDeliveryInfo(e.target.value)} placeholder="e.g. Subscription activated · reference 8K2..." data-testid="textarea-delivery-info" /></Field>
        <Field label="Total acquisition cost (USD)" hint="Enter the amount paid for the stock used to fulfill the whole order. Use 0 if there was no stock cost.">
          <Input type="number" min="0" max="9999999999.99" step="0.01" value={acquisitionCostText} onChange={(e) => setAcquisitionCostText(e.target.value)} placeholder="e.g. 4.50" data-testid="input-order-acquisition-cost" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setDeliverId(null)}>Cancel</Button>
        <Button disabled={!deliveryInfo.trim() || !validAcquisitionCost || deliver.isPending} onClick={() => deliver.mutate({ orderId: deliverId, data: { deliveryInfo, acquisitionCostUsd } }, { onSuccess: () => { setDeliverId(null); setAcquisitionCostText(''); refresh(); } })} data-testid="button-confirm-delivery"><Check size={15} /> Mark delivered</Button>
      </div>
    </Modal>}
  </div>;
}

function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground"><span>Showing {total ? ((page - 1) * pageSize) + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</span><div className="flex gap-1"><Button variant="quiet" className="px-2 py-1 text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><span className="px-2 py-1 font-mono">{page} / {pages}</span><Button variant="quiet" className="px-2 py-1 text-xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div></div>; }

function Payments() {
  const [status, setStatus] = useState<any>('all'); const [page, setPage] = useState(1); const [rejectId, setRejectId] = useState<string | null>(null); const [reason, setReason] = useState(''); const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const query = useListPayments({ page, pageSize: 20, status }, { query: { queryKey: getListPaymentsQueryKey({ page, pageSize: 20, status }), refetchInterval: 5000, refetchOnWindowFocus: true } }); const confirm = useConfirmPayment(); const reject = useRejectPayment(); const qc = useQueryClient(); const refresh = () => { query.refetch(); qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }); }; const confirmPayment = (paymentId: string) => { setConfirmingId(paymentId); confirm.mutate({ paymentId }, { onSuccess: refresh, onSettled: () => setConfirmingId(null) }); };
  return <div className="animate-rise"><PageIntro eyebrow="Trust & cash" title="Payment review" description="Confirm submitted payments with confidence. Keep the review queue moving and the delivery queue healthy." action={<div className="flex gap-2"><Button variant="secondary" onClick={refresh} data-testid="button-refresh-payments"><RefreshCw size={15} /> Refresh</Button><Link href="/orders" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground" data-testid="link-payment-orders">View orders <ArrowUpRight size={15} /></Link></div>} /><Card><div className="flex flex-wrap items-center gap-2 border-b border-border p-4">{['submitted', 'pending', 'verification_failed', 'confirmed', 'rejected', 'all'].map((item) => <button key={item} className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition ${status === item ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-secondary'}`} onClick={() => { setStatus(item); setPage(1); }} data-testid={`button-payment-filter-${item}`}>{item === 'verification_failed' ? 'Needs Review' : titleCase(item)}</button>)}</div>{query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data?.items.length ? <div className="divide-y divide-border">{query.data.items.map((payment: any) => { const needsDecision = ['submitted', 'pending', 'verification_failed'].includes(payment.status); return <div key={`${payment.kind}-${payment.id}`} className="grid gap-4 p-5 md:grid-cols-[1fr_1.1fr_auto] md:items-center" data-testid={`row-payment-${payment.id}`}><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent-foreground"><CreditCard size={17} /></div><div><p className="font-extrabold">{payment.customerName}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{payment.kind === 'wallet_top_up' ? 'Wallet top-up' : payment.orderNumber || 'No order number'} · {date(payment.submittedAt)}</p></div></div><div><p className="text-sm font-bold">{payment.kind === 'wallet_top_up' ? 'Wallet top-up' : payment.productName}</p><p className="mt-1 text-xs text-muted-foreground">{titleCase(payment.paymentMethod)}{payment.transactionReference ? ` · Ref ${payment.transactionReference}` : ''}</p>{payment.failureReason && <p className="mt-2 max-w-sm text-xs text-destructive">{payment.failureReason}</p>}</div><div className="flex items-center justify-between gap-4 md:justify-end"><div className="text-right"><p className="font-mono text-lg font-bold">{money(payment.usdAmount)}</p><Badge tone={payment.status === 'confirmed' ? 'green' : payment.status === 'rejected' ? 'red' : 'orange'}>{payment.status === 'verification_failed' ? 'Needs Review' : titleCase(payment.status)}</Badge></div>{needsDecision && <div className="flex gap-1"><Button className="px-2.5 py-2" onClick={() => confirmPayment(payment.id)} disabled={confirmingId === payment.id} aria-label="Accept payment" data-testid={`button-confirm-payment-${payment.id}`}><Check size={16} /></Button><Button variant="quiet" className="px-2.5 py-2 text-destructive" onClick={() => { setRejectId(payment.id); setReason(''); }} aria-label="Decline payment" data-testid={`button-reject-payment-${payment.id}`}><X size={16} /></Button></div>}</div></div>; })}</div> : <EmptyState icon={CreditCard} title="Review queue is clear" body="Submitted payments waiting for an operator will appear here." />}{query.data && <Pager page={query.data.page} total={query.data.total} pageSize={query.data.pageSize} onPage={setPage} />}</Card>{rejectId && <Modal title="Decline payment" onClose={() => setRejectId(null)}><Field label="Reason" hint="This reason will be sent to the buyer."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Payment reference could not be verified" data-testid="textarea-rejection-reason" /></Field><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejectId(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate({ paymentId: rejectId, data: { reason } }, { onSuccess: () => { setRejectId(null); refresh(); } })} data-testid="button-confirm-rejection">Decline payment</Button></div></Modal>}</div>;
}

function Products() {
  const [status, setStatus] = useState<any>('all'); const [modal, setModal] = useState<'new' | string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const query = useListProducts({ page: 1, pageSize: 50, status });
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: getListProductsQueryKey() });

  return <div className="animate-rise">
    <PageIntro eyebrow="Catalog control" title="Products" description="Shape the storefront catalog, pricing, delivery behavior, and stock visibility." action={<Button onClick={() => setModal('new')} data-testid="button-new-product"><Plus size={16} /> Add product</Button>} />
    <div className="mb-4 flex items-center gap-2">{['all', 'active', 'inactive'].map((item) => <button key={item} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${status === item ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`} onClick={() => setStatus(item)} data-testid={`button-product-filter-${item}`}>{titleCase(item)}</button>)}</div>
    <Card>
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data?.items.length ? <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
        {query.data.items.map((product: any) => <div key={product.id} className="bg-card p-5 transition hover:bg-muted/30" data-testid={`card-product-${product.id}`}>
          <div className="flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Package size={19} /></div><Badge tone={product.active ? 'green' : 'neutral'}>{product.active ? 'Active' : 'Inactive'}</Badge></div>
          <h3 className="mt-5 font-extrabold">{product.nameEn}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{product.duration} · Automatic delivery</p>
          <div className="mt-5 flex items-end justify-between"><span className="font-mono text-xl font-bold">{money(product.priceUsd)}</span><span className={`text-xs font-bold ${product.stockType === 'unlimited' || product.availableStock > product.lowStockThreshold ? 'text-primary' : 'text-destructive'}`}>{product.stockType === 'unlimited' ? 'Unlimited stock' : `${product.availableStock} available`}</span></div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="secondary" className="flex-1 text-xs" onClick={() => setModal(product.id)} data-testid={`button-edit-product-${product.id}`}><Settings2 size={14} /> Edit product</Button>
            <Button variant="quiet" className="px-2 text-xs" onClick={() => update.mutate({ productId: product.id, data: { active: !product.active } }, { onSuccess: invalidate })} disabled={update.isPending} data-testid={`button-toggle-product-${product.id}`}>{product.active ? 'Pause' : 'Activate'}</Button>
            <Button variant="quiet" className="px-2 text-xs text-destructive" onClick={() => { remove.reset(); setDeleteTarget(product); }} aria-label={`Delete ${product.nameEn}`} data-testid={`button-delete-product-${product.id}`}><Trash2 size={14} /> Delete</Button>
          </div>
        </div>)}
      </div> : <EmptyState icon={Package} title="Your catalog is empty" body="Create your first digital subscription product to start selling." action={<Button onClick={() => setModal('new')}><Plus size={15} /> Add product</Button>} />}
    </Card>
    {modal && <ProductModal product={modal === 'new' ? null : query.data?.items.find((p: any) => p.id === modal)} onClose={() => setModal(null)} onSave={(data: any) => modal === 'new' ? create.mutate({ data }, { onSuccess: () => { setModal(null); invalidate(); } }) : update.mutate({ productId: modal, data }, { onSuccess: () => { setModal(null); invalidate(); } })} pending={create.isPending || update.isPending} />}
    {deleteTarget && <Modal title={remove.data ? "Product removal complete" : "Remove product?"} onClose={() => { if (!remove.isPending) { setDeleteTarget(null); remove.reset(); } }}>
      <div className="space-y-4">
        {remove.data ? <p className="text-sm leading-6 text-muted-foreground" role="status" data-testid="status-delete-product-success">{remove.data.outcome === 'archived' ? <><strong className="text-foreground">{deleteTarget.nameEn}</strong> was removed from sale and archived. Its linked history remains available.</> : <><strong className="text-foreground">{deleteTarget.nameEn}</strong> was permanently deleted.</>}</p> : <p className="text-sm leading-6 text-muted-foreground">Remove <strong className="text-foreground">{deleteTarget.nameEn}</strong> from sale? If it has inventory, checkout, order, flash-sale, or promo records, it will be archived as inactive so its history stays intact. If it has no linked records, it will be permanently deleted.</p>}
        {remove.isError && <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-bold text-destructive" data-testid="status-delete-product-error">{remove.error.message || 'Product could not be deleted.'}</div>}
        <div className="flex justify-end gap-2">
          {remove.data ? <Button variant="secondary" onClick={() => { setDeleteTarget(null); remove.reset(); }}>Done</Button> : <>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => { setDeleteTarget(null); remove.reset(); }}>Cancel</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate({ productId: deleteTarget.id }, { onSuccess: () => { invalidate(); qc.removeQueries({ queryKey: [`/api/products/${deleteTarget.id}`], exact: true }); } })} data-testid="button-confirm-delete-product">{remove.isPending ? 'Removing...' : 'Confirm removal'}</Button>
          </>}
        </div>
      </div>
    </Modal>}
  </div>;
}

function ProductModal({ product, onClose, onSave, pending }: { product: any; onClose: () => void; onSave: (data: any) => void; pending: boolean }) {
  const [form, setForm] = useState<any>(product ? { ...product } : { nameEn: '', nameAr: '', duration: '30 days', warranty: '7 days', priceUsd: 0, deliveryType: 'automatic', stockType: 'limited', active: true, displayStock: true, lowStockThreshold: 5, instructionsEn: '', instructionsAr: '', imageUrl: null, telegramCustomEmojiId: null });
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const requestImageUpload = useRequestProductImageUpload();
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  useEffect(() => () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);
  const storedImagePreview = form.imageUrl?.startsWith('/objects/uploads/') && product?.id
    ? `/api/products/${product.id}/image`
    : form.imageUrl;
  const previewImage = imagePreviewUrl || storedImagePreview;
  const uploadImage = async (file?: File) => {
    if (!file) return;
    setImageError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setImageError('Image must be 8 MB or smaller.');
      return;
    }

    setImageUploading(true);
    try {
      const upload = await requestImageUpload.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        },
      });
      const response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
      set('imageUrl', upload.objectPath);
      setImagePreviewUrl(URL.createObjectURL(file));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Unable to upload this image.');
    } finally {
      setImageUploading(false);
    }
  };
  return <Modal
    title={product ? 'Edit product' : 'Add product'}
    onClose={() => { if (!imageUploading && !pending) onClose(); }}
    className="h-[calc(100dvh-2rem)] md:h-[calc(100dvh-3rem)]"
    footer={<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="product-form-actions">
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Product is active</label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={imageUploading || pending} onClick={onClose}>Cancel</Button>
        <Button disabled={!form.nameEn.trim() || !form.nameAr.trim() || pending || imageUploading} onClick={() => onSave({ ...form, priceUsd: Number(form.priceUsd), lowStockThreshold: Number(form.lowStockThreshold), telegramCustomEmojiId: form.telegramCustomEmojiId?.trim() || null })} data-testid="button-save-product"><Check size={15} /> Save product</Button>
      </div>
    </div>
  }>
    <div className="grid gap-6 pb-1">
      <section aria-labelledby="product-image-heading">
        <h3 id="product-image-heading" className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Product photo</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="grid min-h-40 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/30">
            {previewImage
              ? <img src={previewImage} alt={form.nameEn || 'Product photo'} className="max-h-56 w-full object-contain" />
              : <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground"><ImageIcon size={24} /><span className="text-xs font-semibold">No photo selected</span></div>}
          </div>
          <div className="flex flex-col items-start gap-3">
            <p className="text-xs leading-5 text-muted-foreground">JPEG, PNG, or WebP · maximum 8 MB. The photo appears above the product details in Telegram.</p>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-extrabold transition hover:bg-muted ${imageUploading || pending ? 'pointer-events-none opacity-45' : ''}`}>
              <Upload size={15} className="text-primary" />
              {imageUploading ? 'Uploading photo…' : previewImage ? 'Replace photo' : 'Upload photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={imageUploading || pending}
                onChange={(e) => { void uploadImage(e.target.files?.[0]); e.currentTarget.value = ''; }}
                data-testid="input-product-image"
              />
            </label>
            {previewImage && <Button variant="quiet" className="px-2 text-xs text-destructive" disabled={imageUploading || pending} onClick={() => { set('imageUrl', null); setImagePreviewUrl(null); setImageError(''); }} data-testid="button-remove-product-image"><Trash2 size={14} /> Remove photo</Button>}
            {imageError && <p role="alert" className="text-xs font-bold text-destructive" data-testid="status-product-image-error">{imageError}</p>}
          </div>
        </div>
      </section>
      <section aria-labelledby="product-details-heading">
        <h3 id="product-details-heading" className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Product details</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <Field label="Name (English)"><Input value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} data-testid="input-product-name-en" /></Field>
          <Field label="Name (Arabic)"><Input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} data-testid="input-product-name-ar" /></Field>
          <Field label="Duration"><Input value={form.duration} onChange={(e) => set('duration', e.target.value)} /></Field>
          <Field label="Warranty"><Input value={form.warranty} onChange={(e) => set('warranty', e.target.value)} /></Field>
          <Field label="Price (USD)"><Input type="number" min="0" value={form.priceUsd} onChange={(e) => set('priceUsd', Number(e.target.value))} data-testid="input-product-price" /></Field>
          <Field label="Telegram Custom Emoji ID" hint="Optional numeric ID; leave blank for a normal shop button.">
            <Input value={form.telegramCustomEmojiId ?? ''} onChange={(e) => set('telegramCustomEmojiId', e.target.value)} placeholder="Custom Emoji ID" data-testid="input-product-custom-emoji-id" />
          </Field>
        </div>
      </section>
      <section aria-labelledby="product-delivery-heading">
        <h3 id="product-delivery-heading" className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Delivery and inventory</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <Field label="Delivery type"><Select value={form.deliveryType} onChange={(e) => set('deliveryType', e.target.value)}><option value="automatic">Automatic</option><option value="manual">Manual</option></Select></Field>
          <Field label="Stock type"><Select value={form.stockType} onChange={(e) => set('stockType', e.target.value)}><option value="limited">Limited</option><option value="unlimited">Unlimited</option></Select></Field>
          <Field label="Low stock threshold"><Input type="number" min="0" value={form.lowStockThreshold} onChange={(e) => set('lowStockThreshold', Number(e.target.value))} /></Field>
        </div>
      </section>
      <section aria-labelledby="product-instructions-heading">
        <h3 id="product-instructions-heading" className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Customer instructions</h3>
        <div className="mt-3 grid gap-4">
          <Field label="Instructions (English)"><Textarea className="h-28 max-h-48" value={form.instructionsEn} onChange={(e) => set('instructionsEn', e.target.value)} /></Field>
          <Field label="Instructions (Arabic)"><Textarea className="h-28 max-h-48" value={form.instructionsAr} onChange={(e) => set('instructionsAr', e.target.value)} /></Field>
        </div>
      </section>
    </div>
  </Modal>;
}

function normalizeInventoryLines(value: string) {
  return Array.from(new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

async function readInventorySpreadsheet(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: false, defval: '' });
  return Array.from(new Set(rows
    .map((row) => row.map((cell) => String(cell).trim()).filter(Boolean).join(' | '))
    .map((line) => line.trim())
    .filter(Boolean)));
}

function Inventory() {
  const [productId, setProductId] = useState('');
  const [importText, setImportText] = useState('');
  const [quantityText, setQuantityText] = useState('');
  const [targetStockText, setTargetStockText] = useState('');
  const [unitCostText, setUnitCostText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const products = useListProducts({ page: 1, pageSize: 100, status: 'all' });
  const summary = useGetInventorySummary({ query: { queryKey: getGetInventorySummaryQueryKey(), staleTime: 30_000 } });
  const query = useListInventory({ page: 1, pageSize: 50, productId: productId || undefined, status: 'all' });
  const importMutation = useImportInventory();
  const manualStock = useSetManualProductStock();
  const disable = useDisableInventory();
  const qc = useQueryClient();
  const refresh = () => {
    query.refetch();
    summary.refetch();
    qc.invalidateQueries({ queryKey: getListProductsQueryKey({ page: 1, pageSize: 100, status: 'all' }) });
  };
  const totals = summary.data;
  const importValues = normalizeInventoryLines(importText);
  const selectedProduct = products.data?.items.find((product) => product.id === productId);
  const isManualProduct = selectedProduct?.deliveryType === 'manual';
  const quantityToAdd = Number(quantityText);
  const validQuantity = quantityText !== '' && Number.isInteger(quantityToAdd) && quantityToAdd >= 1 && quantityToAdd <= 1000;
  const targetAvailableStock = Number(targetStockText);
  const validTargetAvailableStock = targetStockText !== '' && Number.isInteger(targetAvailableStock) && targetAvailableStock >= 0 && targetAvailableStock <= 10000;
  const unitCostUsd = Number(unitCostText);
  const validUnitCost = /^\d{1,10}(?:\.\d{1,2})?$/.test(unitCostText.trim()) &&
    Number.isFinite(unitCostUsd) && unitCostUsd >= 0 && unitCostUsd <= 9999999999.99;
  const changeProduct = (nextProductId: string) => {
    importMutation.reset();
    manualStock.reset();
    setProductId(nextProductId);
    const nextProduct = products.data?.items.find((product) => product.id === nextProductId);
    setTargetStockText(nextProduct?.deliveryType === 'manual' ? String(nextProduct.availableStock) : '');
    setImportText('');
    setQuantityText('');
    setUnitCostText('');
    setFileName('');
    setFileError('');
  };
  const handleSpreadsheet = async (file: File | undefined) => {
    if (!file) return;
    setFileError('');
    try {
      const values = await readInventorySpreadsheet(file);
      if (!values.length) throw new Error('The spreadsheet has no non-empty rows.');
      setImportText(values.join('\n'));
      setFileName(file.name);
    } catch (error) {
      setFileName('');
      setFileError(error instanceof Error ? error.message : 'Unable to read this spreadsheet.');
    }
  };
  const addStock = () => {
    if (!productId || importMutation.isPending) return;
    if (isManualProduct) {
      if (!validQuantity) return;
      importMutation.mutate(
        { data: { productId, quantity: quantityToAdd } },
        { onSuccess: () => { setQuantityText(''); refresh(); } },
      );
      return;
    }
    if (importValues.length === 0) return;
    if (!validUnitCost) return;
    importMutation.mutate(
      { data: { productId, values: importValues, unitCostUsd } },
      { onSuccess: () => { setImportText(''); setUnitCostText(''); setFileName(''); refresh(); } },
    );
  };
  return <div className="animate-rise">
    <PageIntro eyebrow="Stock room" title="Inventory" description="Protect fulfillment quality with a masked, operator-safe view of digital stock." action={<Button variant="secondary" onClick={refresh} data-testid="button-refresh-inventory"><RefreshCw size={15} /> Refresh</Button>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[['Total items', totals?.total ?? 0, Database], ['Available', totals?.available ?? 0, Check], ['Reserved', totals?.reserved ?? 0, Clock3], ['Delivered', totals?.delivered ?? 0, Truck], ['Low-stock products', totals?.lowStockProducts ?? 0, Bell]].map(([label, value, Icon]: any) => <Card key={label as string} className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</span><Icon size={16} className="text-primary" /></div><p className="mt-3 font-mono text-2xl font-bold">{value}</p></Card>)}
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
      <Card className="p-5">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-accent/15 p-2.5 text-accent-foreground"><Archive size={18} /></div><div><h3 className="font-extrabold">Add stock</h3><p className="mt-1 text-xs text-muted-foreground">{isManualProduct ? 'Set how many sellable pieces to add.' : 'Add one product value per line; duplicate values are skipped.'}</p></div></div>
        <div className="mt-5 grid gap-4">
          <Field label="Product"><Select value={productId} onChange={(e) => changeProduct(e.target.value)} data-testid="select-import-product"><option value="">Choose a product</option>{products.data?.items.map((product: any) => <option key={product.id} value={product.id}>{product.nameEn} · {product.deliveryType === 'manual' ? 'Manual' : 'Automatic'}</option>)}</Select></Field>
          {isManualProduct ? <>
            <Field label="Sellable pieces to add" hint="Each piece updates available stock by one and can be reserved for one checkout.">
              <Input type="number" min="1" max="1000" step="1" value={quantityText} onChange={(e) => setQuantityText(e.target.value)} placeholder="Enter a quantity" data-testid="input-manual-stock-quantity" />
            </Field>
            {selectedProduct.stockType === 'unlimited' && <p className="rounded-lg bg-amber-500/10 p-3 text-xs font-semibold text-amber-800 dark:text-amber-200">This product is currently unlimited. Adding a quantity will switch it to limited stock so sales respect the available pieces.</p>}
          </> : <>
            <Field label="Product values" hint="Manual entry: put one item on each line. Excel / CSV: each non-empty row becomes one item.">
              <Textarea value={importText} onChange={(e) => { setImportText(e.target.value); setFileName(''); setFileError(''); }} placeholder={'KEY-7H3K-9P2L\nKEY-1Q8M-4Z6N'} data-testid="textarea-inventory-values" />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-extrabold transition hover:bg-muted"><FileSpreadsheet size={15} className="text-primary" /> Upload Excel / CSV<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { void handleSpreadsheet(e.target.files?.[0]); e.currentTarget.value = ''; }} data-testid="input-inventory-spreadsheet" /></label>
                {fileName && <span className="text-xs font-bold text-primary">{fileName} · {importValues.length} items loaded</span>}
                {importValues.length > 0 && <span className="text-xs text-muted-foreground">{importValues.length} unique items ready</span>}
              </div>
              {fileError && <p className="mt-2 text-xs font-bold text-destructive">{fileError}</p>}
            </Field>
            <Field label="Acquisition cost per item (USD)" hint="Enter what you paid for each stock value. Existing duplicate values keep their original cost.">
              <Input type="number" min="0" max="9999999999.99" step="0.01" value={unitCostText} onChange={(e) => setUnitCostText(e.target.value)} placeholder="e.g. 2.50" data-testid="input-inventory-unit-cost" />
            </Field>
          </>}
          <Button disabled={!productId || importMutation.isPending || (isManualProduct ? !validQuantity : importValues.length === 0 || !validUnitCost)} onClick={addStock} data-testid="button-import-inventory"><Plus size={15} /> {isManualProduct ? `Add ${validQuantity ? quantityToAdd : ''} pieces` : `Import ${importValues.length || ''} values`}</Button>
          {importMutation.data && <div className="rounded-lg bg-primary/10 p-3 text-xs font-bold text-primary">{isManualProduct ? `Added ${importMutation.data.imported} stock units.` : `Imported ${importMutation.data.imported} values · ${importMutation.data.skippedDuplicates} duplicates skipped.`} Available stock: {importMutation.data.available}.</div>}
          {isManualProduct && <div className="grid gap-3 rounded-xl border border-border bg-muted/25 p-4">
            <div>
              <h4 className="text-sm font-extrabold">Set available stock</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Set the exact sellable count. Reserved and delivered units stay unchanged; reductions disable units without deleting their history.</p>
            </div>
            <Field label={`Target available count · current ${selectedProduct.availableStock}`}>
              <Input type="number" min="0" max="10000" step="1" value={targetStockText} onChange={(e) => setTargetStockText(e.target.value)} placeholder="Enter the new available count" data-testid="input-manual-stock-target" />
            </Field>
            {selectedProduct.stockType === 'unlimited' && <p className="rounded-lg bg-amber-500/10 p-3 text-xs font-semibold text-amber-800 dark:text-amber-200">Setting a count switches this product from unlimited to limited stock.</p>}
            <Button
              variant="secondary"
              disabled={!validTargetAvailableStock || manualStock.isPending || importMutation.isPending}
              onClick={() => manualStock.mutate(
                { productId, data: { availableStock: targetAvailableStock } },
                { onSuccess: refresh },
              )}
              data-testid="button-set-manual-stock"
            >
              {manualStock.isPending ? 'Updating stock…' : `Set available to ${validTargetAvailableStock ? targetAvailableStock : '…'}`}
            </Button>
            {manualStock.data && <div role="status" className="rounded-lg bg-primary/10 p-3 text-xs font-bold text-primary" data-testid="status-manual-stock-adjusted">
              Stock updated from {manualStock.data.previousAvailable} to {manualStock.data.availableStock}. {manualStock.data.added} added · {manualStock.data.disabled} disabled.
            </div>}
            {manualStock.isError && <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs font-bold text-destructive" data-testid="status-manual-stock-error">
              {manualStock.error.message || 'Unable to adjust available stock.'}
            </div>}
          </div>}
        </div>
      </Card>
      <Card>
        <div className="flex flex-col justify-between gap-3 border-b border-border p-5 md:flex-row md:items-center"><div><h3 className="font-extrabold">Inventory</h3><p className="mt-1 text-xs text-muted-foreground">Credential values are masked; manual stock appears as unit counts.</p></div><Select className="md:w-48" value={productId} onChange={(e) => changeProduct(e.target.value)}><option value="">All products</option>{products.data?.items.map((product: any) => <option key={product.id} value={product.id}>{product.nameEn}</option>)}</Select></div>
        {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data?.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/55 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3">Product</th><th className="px-4 py-3">Value / stock unit</th><th className="px-4 py-3">Unit cost</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Order</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-border">{query.data.items.map((item: any) => <tr key={item.id} data-testid={`row-inventory-${item.id}`}><td className="px-5 py-4 font-bold">{item.productName}</td><td className="px-4 py-4 font-mono text-xs">{item.maskedValue}</td><td className="px-4 py-4 font-mono text-xs">{item.unitCostUsd === null ? '—' : money(item.unitCostUsd)}</td><td className="px-4 py-4"><Badge tone={item.status === 'available' ? 'green' : item.status === 'disabled' ? 'red' : 'neutral'}>{item.status}</Badge></td><td className="px-4 py-4 font-mono text-xs text-muted-foreground">{item.orderNumber || '—'}</td><td className="px-5 py-4 text-right">{item.status === 'available' && <Button variant="quiet" className="text-xs text-destructive" onClick={() => disable.mutate({ inventoryId: item.id }, { onSuccess: refresh })} disabled={disable.isPending} data-testid={`button-disable-inventory-${item.id}`}>Disable</Button>}</td></tr>)}</tbody></table></div> : <EmptyState icon={Boxes} title="No inventory found" body="Add stock above to populate this view." />}
      </Card>
    </div>
  </div>;
}

function FlashSales() {
  const query = useListFlashSales();
  const products = useListProducts({ page: 1, pageSize: 100, status: 'active' });
  const create = useCreateFlashSale();
  const stop = useStopFlashSale();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({
    productId: '',
    salePriceUsd: 0,
    startsAt: '',
    endsAt: '',
    quantity: '',
  });
  const set = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, [key]: value }));

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow="Demand shaping"
        title="Flash sales"
        description="Schedule focused offers with a clear start, finish, and inventory guardrail."
        action={
          <Button
            onClick={() => setOpen(true)}
            data-testid="button-new-flash-sale"
          >
            <Plus size={16} /> Schedule sale
          </Button>
        }
      />
      <Card>
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          <ErrorState retry={() => query.refetch()} />
        ) : query.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/55 text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {query.data.map((sale: any) => (
                  <tr key={sale.id} data-testid={`row-flash-sale-${sale.id}`}>
                    <td className="px-5 py-4 font-bold">{sale.productName}</td>
                    <td className="px-4 py-4">
                      <span className="font-mono font-bold">
                        {money(sale.salePriceUsd)}
                      </span>
                      <span className="ml-2 text-xs font-bold text-primary">
                        -{sale.discountPercent}%
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        was {money(sale.originalPriceUsd)}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">
                      {date(sale.startsAt)}
                      <br />
                      to {date(sale.endsAt)}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {sale.quantity ?? 'Unlimited'}
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        tone={
                          sale.status === 'active'
                            ? 'green'
                            : sale.status === 'scheduled'
                              ? 'blue'
                              : sale.status === 'expired'
                                ? 'neutral'
                                : sale.status === 'cancelled'
                                  ? 'red'
                                  : 'orange'
                        }
                      >
                        {sale.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      {sale.status === 'active' && (
                        <Button
                          variant="danger"
                          disabled={stop.isPending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Stop the flash sale for ${sale.productName}?`,
                              )
                            ) {
                              return;
                            }
                            stop.mutate(
                              { id: sale.id },
                              {
                                onSuccess: () => {
                                  void Promise.all([
                                    qc.invalidateQueries({
                                      queryKey: getListFlashSalesQueryKey(),
                                    }),
                                    qc.invalidateQueries({
                                      queryKey: getGetDashboardOverviewQueryKey(),
                                    }),
                                  ]);
                                },
                              },
                            );
                          }}
                          data-testid={`button-stop-flash-sale-${sale.id}`}
                        >
                          <X size={14} />
                          {stop.isPending ? 'Stopping…' : 'Stop sale'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Tag}
            title="No flash sales scheduled"
            body="Create a sale when you need a measured demand push."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus size={15} /> Schedule sale
              </Button>
            }
          />
        )}
      </Card>
      {open && (
        <Modal title="Schedule flash sale" onClose={() => setOpen(false)}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Product">
              <Select
                value={form.productId}
                onChange={(e) => set('productId', e.target.value)}
              >
                <option value="">Choose a product</option>
                {products.data?.items.map((product: any) => (
                  <option key={product.id} value={product.id}>
                    {product.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sale price (USD)">
              <Input
                type="number"
                min="0"
                value={form.salePriceUsd}
                onChange={(e) => set('salePriceUsd', Number(e.target.value))}
              />
            </Field>
            <Field label="Starts at">
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
              />
            </Field>
            <Field label="Ends at">
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
              />
            </Field>
            <Field label="Quantity cap" hint="Leave blank for unlimited">
              <Input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.productId ||
                !form.startsAt ||
                !form.endsAt ||
                create.isPending
              }
              onClick={() =>
                create.mutate(
                  {
                    data: {
                      productId: form.productId,
                      salePriceUsd: Number(form.salePriceUsd),
                      startsAt: new Date(form.startsAt).toISOString(),
                      endsAt: new Date(form.endsAt).toISOString(),
                      quantity: form.quantity ? Number(form.quantity) : null,
                    },
                  },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      void qc.invalidateQueries({
                        queryKey: getListFlashSalesQueryKey(),
                      });
                    },
                  },
                )
              }
              data-testid="button-save-flash-sale"
            >
              <Check size={15} /> Schedule sale
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PromoCodes() {
  const query = useListPromoCodes();
  const create = useCreatePromoCode();
  const update = useUpdatePromoCode();
  const remove = useDeletePromoCode();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({
    code: '',
    discountType: 'percentage',
    value: 10,
    maxUses: '',
    expiresAt: '',
    active: true,
  });
  const set = (key: string, value: any) =>
    setForm((current: any) => ({ ...current, [key]: value }));

  const togglePromoCode = (promo: any) => {
    const active = !promo.active;
    if (
      !active &&
      !window.confirm(
        `Stop ${promo.code}? New checkouts won't be able to use it. Existing checkouts with a reserved discount will remain valid.`,
      )
    ) {
      return;
    }
    update.mutate(
      { id: promo.id, data: { active } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListPromoCodesQueryKey() });
        },
      },
    );
  };

  const openDeleteDialog = (promo: any) => {
    remove.reset();
    setDeleteTarget(promo);
  };
  const closeDeleteDialog = () => {
    remove.reset();
    setDeleteTarget(null);
  };

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow="Retention levers"
        title="Promo codes"
        description="Keep promotion rules legible for the team and bounded for the business."
        action={
          <Button
            onClick={() => setOpen(true)}
            data-testid="button-new-promo-code"
          >
            <Plus size={16} /> Create code
          </Button>
        }
      />
      <Card>
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          <ErrorState retry={() => query.refetch()} />
        ) : query.data?.length ? (
          <>
            {update.isError && (
              <p className="border-b border-border px-5 py-3 text-sm font-bold text-destructive">
                {update.error instanceof Error
                  ? update.error.message
                  : 'Could not update the promo code.'}
              </p>
            )}
            <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
              {query.data.map((promo: any) => (
                <div
                  key={promo.id}
                  className="bg-card p-5"
                  data-testid={`card-promo-${promo.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                      <Percent size={18} />
                    </div>
                    <Badge tone={promo.active ? 'green' : 'neutral'}>
                      {promo.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="mt-5 font-mono text-lg font-bold tracking-wider">
                    {promo.code}
                  </p>
                  <p className="mt-2 text-2xl font-extrabold">
                    {promo.discountType === 'percentage'
                      ? `${promo.value}%`
                      : money(promo.value)}{' '}
                    <span className="text-xs font-bold text-muted-foreground">
                      off
                    </span>
                  </p>
                  <div className="mt-5 flex justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                    <span>
                      {promo.usedCount} used
                      {promo.maxUses ? ` of ${promo.maxUses}` : ''}
                    </span>
                    <span>
                      {promo.expiresAt
                        ? `Expires ${date(promo.expiresAt)}`
                        : 'No expiry'}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant={promo.active ? 'danger' : 'secondary'}
                      disabled={update.isPending || remove.isPending}
                      onClick={() => togglePromoCode(promo)}
                      data-testid={`button-toggle-promo-${promo.id}`}
                    >
                      {promo.active ? <X size={15} /> : <RotateCcw size={15} />}
                      {promo.active ? 'Stop code' : 'Resume code'}
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={
                        update.isPending ||
                        remove.isPending ||
                        promo.usedCount > 0
                      }
                      title={
                        promo.usedCount > 0
                          ? 'Codes with redemption history can be stopped, not deleted.'
                          : 'Permanently delete this unused promo code'
                      }
                      onClick={() => openDeleteDialog(promo)}
                      data-testid={`button-delete-promo-${promo.id}`}
                    >
                      <Trash2 size={15} /> Delete
                    </Button>
                  </div>
                  {promo.usedCount > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      This code has redemption history. Stop it to prevent new
                      uses while keeping its history.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={Percent}
            title="No promotion codes"
            body="Create a bounded offer for a specific campaign or customer cohort."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus size={15} /> Create code
              </Button>
            }
          />
        )}
      </Card>
      {open && (
        <Modal title="Create promo code" onClose={() => setOpen(false)}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Code">
              <Input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="RAMADAN15"
                data-testid="input-promo-code"
              />
            </Field>
            <Field label="Discount type">
              <Select
                value={form.discountType}
                onChange={(e) => set('discountType', e.target.value)}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed_usd">Fixed USD</option>
              </Select>
            </Field>
            <Field label="Value">
              <Input
                type="number"
                min="0"
                value={form.value}
                onChange={(e) => set('value', Number(e.target.value))}
              />
            </Field>
            <Field label="Maximum uses" hint="Leave blank for unlimited">
              <Input
                type="number"
                min="1"
                value={form.maxUses}
                onChange={(e) => set('maxUses', e.target.value)}
              />
            </Field>
            <Field label="Expires at">
              <Input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => set('expiresAt', e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.code.trim() || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    data: {
                      code: form.code,
                      discountType: form.discountType,
                      value: Number(form.value),
                      maxUses: form.maxUses ? Number(form.maxUses) : null,
                      expiresAt: form.expiresAt
                        ? new Date(form.expiresAt).toISOString()
                        : null,
                      active: true,
                    },
                  },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      void qc.invalidateQueries({
                        queryKey: getListPromoCodesQueryKey(),
                      });
                    },
                  },
                )
              }
              data-testid="button-save-promo-code"
            >
              <Check size={15} /> Create code
            </Button>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title="Permanently delete promo code?" onClose={closeDeleteDialog}>
          <p className="text-sm leading-6 text-muted-foreground">
            This will permanently delete <strong>{deleteTarget.code}</strong>.
            It can’t be restored. Codes with redemption history or active
            checkout reservations cannot be deleted.
          </p>
          {remove.isError && (
            <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive">
              {remove.error instanceof Error
                ? remove.error.message
                : 'Could not delete the promo code.'}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDeleteDialog}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending || deleteTarget.usedCount > 0}
              onClick={() =>
                remove.mutate(
                  { id: deleteTarget.id },
                  {
                    onSuccess: () => {
                      closeDeleteDialog();
                      void qc.invalidateQueries({
                        queryKey: getListPromoCodesQueryKey(),
                      });
                    },
                  },
                )
              }
              data-testid="button-confirm-delete-promo"
            >
              <Trash2 size={15} />
              {remove.isPending ? 'Deleting…' : 'Delete promo code'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function WalletAdjustmentModal({ customer, onClose }: { customer: any; onClose: () => void }) {
  const adjust = useAdjustCustomerWallet();
  const qc = useQueryClient();
  const [operation, setOperation] = useState<'add' | 'deduct'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const validAmount = /^\d+(?:\.\d{1,2})?$/.test(amount)
    && Number(amount) > 0
    && Number(amount) <= 9999999999.99;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validAmount || !reason.trim() || adjust.isPending) return;
    adjust.mutate({
      customerId: customer.id,
      data: { operation, amountUsd: Number(amount), reason: reason.trim() },
    }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        onClose();
      },
    });
  };

  return <Modal title={`Adjust wallet · ${customer.displayName}`} onClose={onClose}>
    <div className="mb-5 flex items-center justify-between gap-4 rounded-xl bg-muted/60 p-4">
      <div><p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Current balance</p><p className="mt-1 font-mono text-xl font-extrabold">{money(customer.walletBalanceUsd)}</p></div>
      <Badge tone="blue">USDT</Badge>
    </div>
    <p className="mb-4 text-sm leading-6 text-muted-foreground">Each change is recorded in the wallet ledger. Deductions cannot exceed the current balance.</p>
    <form onSubmit={submit} className="space-y-4">
      <Field label="Adjustment">
        <Select value={operation} onChange={(event) => setOperation(event.target.value as 'add' | 'deduct')} data-testid="select-wallet-adjustment-operation">
          <option value="add">Add funds</option>
          <option value="deduct">Deduct funds</option>
        </Select>
      </Field>
      <Field label="Amount (USD)" hint="Use up to two decimal places.">
        <Input type="number" min="0.01" max="9999999999.99" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" data-testid="input-wallet-adjustment-amount" />
      </Field>
      <Field label="Reason" hint="This will be saved in the ledger and admin audit log.">
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="e.g. Customer service credit" data-testid="textarea-wallet-adjustment-reason" />
      </Field>
      {adjust.isError && <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-bold text-destructive" data-testid="status-wallet-adjustment-error">{adjust.error instanceof Error ? adjust.error.message : 'Wallet adjustment failed.'}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" type="button" onClick={onClose} disabled={adjust.isPending}>Cancel</Button>
        <Button type="submit" disabled={!validAmount || !reason.trim() || adjust.isPending} data-testid="button-submit-wallet-adjustment">
          {adjust.isPending ? 'Saving...' : operation === 'add' ? 'Add funds' : 'Deduct funds'}
        </Button>
      </div>
    </form>
  </Modal>;
}

function Customers() {
  const [search, setSearch] = useState('');
  const [walletCustomer, setWalletCustomer] = useState<any>(null);
  const query = useListCustomers({ page: 1, pageSize: 50, search: search || undefined });
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), staleTime: 60_000 } });
  const canAdjustWallet = session.data?.admin?.role === 'super_admin';

  return <div className="animate-rise">
    <PageIntro eyebrow="Customer health" title="Customers" description="See who is buying, returning, and building value inside the storefront." />
    <Card>
      <div className="border-b border-border p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} />
          <Input className="pl-9" placeholder="Search name or Telegram username" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-customers" />
        </div>
      </div>
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data?.items.length
        ? <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-muted/55 text-[10px] uppercase tracking-[.12em] text-muted-foreground">
              <tr><th className="px-5 py-3">Customer</th><th className="px-4 py-3">Language</th><th className="px-4 py-3">Orders</th><th className="px-4 py-3">Lifetime value</th><th className="px-4 py-3">Wallet balance</th><th className="px-5 py-3">Last activity</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((customer: any) => <tr key={customer.id} className="hover:bg-muted/30" data-testid={`row-customer-${customer.id}`}>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-xs font-black text-primary">{initials(customer.displayName)}</div>
                    <div><p className="font-bold">{customer.displayName}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{customer.username ? `@${customer.username}` : customer.telegramUserId}</p></div>
                  </div>
                </td>
                <td className="px-4 py-4"><Badge tone="neutral">{customer.language}</Badge></td>
                <td className="px-4 py-4 font-mono font-bold">{customer.orderCount}</td>
                <td className="px-4 py-4 font-mono font-bold text-primary">{money(customer.lifetimeValueUsd)}</td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold">{money(customer.walletBalanceUsd)}</span>
                    {canAdjustWallet && <Button variant="quiet" className="px-2 py-1 text-[11px]" onClick={() => setWalletCustomer(customer)} aria-label={`Adjust wallet for ${customer.displayName}`} data-testid={`button-adjust-wallet-${customer.id}`}><WalletCards size={13} /> Adjust</Button>}
                  </div>
                </td>
                <td className="px-5 py-4 text-xs text-muted-foreground">{date(customer.lastActivityAt)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        : <EmptyState icon={Users} title="No customers found" body="Try a different search term." />}
    </Card>
    {walletCustomer && <WalletAdjustmentModal customer={walletCustomer} onClose={() => setWalletCustomer(null)} />}
  </div>;
}

function SupportConversationModal({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const query = useGetSupportTicket(ticketId);
  const reply = useReplyToSupportTicket();
  const update = useUpdateSupportTicket();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const refreshList = () => qc.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
  const send = () => reply.mutate({ ticketId, data: { body } }, { onSuccess: () => { setBody(''); query.refetch(); refreshList(); } });
  const close = () => update.mutate({ ticketId, data: { status: 'closed' } }, { onSuccess: () => { query.refetch(); refreshList(); } });
  const ticket = query.data;
  return <Modal title={ticket ? `${ticket.ticketNumber} · ${ticket.subject}` : 'Support conversation'} onClose={onClose}>
    {query.isLoading ? <LoadingBlock /> : query.isError || !ticket ? <ErrorState retry={() => query.refetch()} /> : <>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3">
        <div><p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Customer</p><p className="mt-1 font-extrabold">{ticket.customerName}</p></div>
        <Badge tone={ticket.status === 'closed' ? 'neutral' : ticket.status === 'created' ? 'orange' : 'blue'}>{titleCase(ticket.status)}</Badge>
      </div>
      <div className="max-h-[45dvh] space-y-3 overflow-y-auto rounded-xl border border-border bg-background p-3">
        {ticket.messages.length ? ticket.messages.map((message) => <div key={message.id} className={`rounded-xl p-3 ${message.authorType === 'admin' ? 'ml-8 bg-primary/10' : 'mr-8 bg-muted'}`}><div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground"><span>{message.authorType === 'admin' ? 'Admin' : 'Customer'}</span><span>{date(message.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p></div>) : <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      {ticket.status !== 'closed' && <><Field label="Reply" ><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a concise, helpful response..." data-testid="textarea-support-conversation-reply" /></Field><div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={close} disabled={update.isPending}>Close ticket</Button><Button disabled={!body.trim() || reply.isPending} onClick={send} data-testid="button-send-support-conversation-reply"><Check size={15} /> Send reply</Button></div></>}
    </>}
  </Modal>;
}

function Support() { const [status, setStatus] = useState<any>('all'); const [conversationId, setConversationId] = useState<string | null>(null); const query = useListSupportTickets({ page: 1, pageSize: 50, status }); return <div className="animate-rise"><PageIntro eyebrow="Customer care" title="Support queue" description="Open a ticket to read the full conversation, reply to the customer, or close it." /><Card><div className="flex flex-wrap gap-2 border-b border-border p-4">{['all', 'created', 'pending', 'closed'].map((item) => <button key={item} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${status === item ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`} onClick={() => setStatus(item)} data-testid={`button-support-filter-${item}`}>{titleCase(item)}</button>)}</div>{query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data?.items.length ? <div className="divide-y divide-border">{query.data.items.map((ticket: any) => <div key={ticket.id} className="grid gap-4 p-5 md:grid-cols-[1fr_1.6fr_auto] md:items-center" data-testid={`row-support-${ticket.id}`}><div><div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-xs font-black text-primary">{initials(ticket.customerName)}</div><div><p className="font-bold">{ticket.customerName}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{ticket.ticketNumber}</p></div></div><p className="mt-3 font-mono text-[10px] text-muted-foreground">{date(ticket.updatedAt)}</p></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{ticket.subject}</h3><Badge tone={ticket.status === 'created' ? 'orange' : ticket.status === 'closed' ? 'neutral' : 'blue'}>{titleCase(ticket.status)}</Badge></div><p className="mt-2 truncate text-sm text-muted-foreground">{ticket.lastMessage}</p></div><Button variant="secondary" className="text-xs" onClick={() => setConversationId(ticket.id)} data-testid={`button-view-ticket-${ticket.id}`}><Headphones size={14} /> View conversation</Button></div>)}</div> : <EmptyState icon={Headphones} title="Support queue is quiet" body="Open customer conversations will appear here." />}</Card>{conversationId && <SupportConversationModal ticketId={conversationId} onClose={() => setConversationId(null)} />}</div>; }

function Analytics() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const query = useGetAnalyticsSummary(
    { from, to },
    { query: { queryKey: getGetAnalyticsSummaryQueryKey({ from, to }), staleTime: 60_000 } },
  );
  return <div className="animate-rise">
    <PageIntro
      eyebrow="Business intelligence"
      title="Analytics"
      description="Read performance in the same language as the operation: gross sales, net profit, throughput, retention, and friction."
      action={<div className="flex gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" data-testid="input-analytics-from" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" data-testid="input-analytics-to" /></div>}
    />
    {query.isLoading ? <LoadingBlock /> : query.isError || !query.data ? <Card><ErrorState retry={() => query.refetch()} /></Card> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Gross revenue" value={money(query.data.revenueUsd)} sub="Selected period" icon={CircleDollarSign} />
        <StatCard label="Tracked acquisition cost" value={money(query.data.acquisitionCostUsd)} sub={`${query.data.costedOrderCount} delivered orders with cost`} icon={Boxes} tone="orange" />
        <StatCard label="Net profit" value={money(query.data.realizedProfitUsd)} sub="Delivered sales minus tracked costs; fees excluded" icon={ArrowUpRight} tone="blue" />
        <StatCard label="Orders" value={query.data.orderCount} sub="Completed and active" icon={ShoppingBag} tone="blue" />
        <StatCard label="Average gross order" value={money(query.data.averageOrderValueUsd)} sub="Gross revenue per order" icon={ArrowUpRight} tone="orange" />
        <StatCard label="New customers" value={query.data.newCustomers} sub={`${query.data.returningCustomers} returning`} icon={Users} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <MetricList title="Gross revenue by payment method" items={query.data.revenueByPaymentMethod} format={money} icon={CreditCard} />
        <MetricList title="Top products by gross sales" items={query.data.topProducts} format={money} icon={Package} />
        <Card className="p-5">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Customer loop</p><h3 className="mt-1 text-lg font-extrabold">Retention signals</h3></div><Activity size={19} className="text-primary" /></div>
          <div className="mt-5 grid grid-cols-2 gap-3"><MiniMetric label="Returning customers" value={query.data.returningCustomers} /><MiniMetric label="Cashback issued" value={money(query.data.cashbackIssuedUsd)} /><MiniMetric label="Referral rewards" value={money(query.data.referralRewardsIssuedUsd)} /><MiniMetric label="Cancelled orders" value={query.data.cancelledOrders} /></div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.08em] text-muted-foreground">Operations quality</p><h3 className="mt-1 text-lg font-extrabold">Friction to watch</h3></div><ShieldCheck size={19} className="text-primary" /></div>
          <div className="mt-5 rounded-xl bg-muted/60 p-4"><p className="text-sm font-bold">Payment confirmation</p><p className="mt-2 font-mono text-3xl font-bold text-primary">{query.data.paymentConfirmationMinutes}<span className="ml-1 text-sm text-muted-foreground">min avg.</span></p><div className="mt-3 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(12, 100 - query.data.paymentConfirmationMinutes * 2))}%` }} /></div></div>
        </Card>
      </div>
    </>}
  </div>;
}
function MetricList({ title, items, format, icon: Icon }: { title: string; items: any[]; format: (value: number) => string; icon: LucideIcon }) { const max = Math.max(...items.map((item) => item.value), 1); return <Card className="p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon size={18} /></div><h3 className="font-extrabold">{title}</h3></div><div className="mt-5 grid gap-4">{items.length ? items.map((item) => <div key={item.label}><div className="mb-1.5 flex justify-between text-xs font-bold"><span>{item.label}</span><span className="font-mono">{format(item.value)}</span></div><div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(item.value / max) * 100}%` }} /></div></div>) : <p className="text-sm text-muted-foreground">No data for this period.</p>}</div></Card>; }
function MiniMetric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-border bg-background p-3"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className="mt-2 font-mono text-lg font-bold">{value}</p></div>; }

function Settings() { const query = useGetStoreSettings({ query: { queryKey: getGetStoreSettingsQueryKey(), staleTime: 60_000 } }); const update = useUpdateStoreSettings(); const testTelegram = useSendAdminTelegramTest(); const [form, setForm] = useState<any>(null); const qc = useQueryClient(); const source = form || query.data; const set = (key: string, value: any) => setForm((current: any) => ({ ...(current || query.data), [key]: value })); if (query.isLoading) return <><PageIntro eyebrow="Control plane" title="Store settings" description="Tune the storefront rules that shape checkout and fulfillment." /><LoadingBlock /></>; if (query.isError || !query.data) return <Card><ErrorState retry={() => query.refetch()} /></Card>; return <div className="animate-rise"><PageIntro eyebrow="Control plane" title="Store settings" description="Tune the storefront rules that shape checkout and fulfillment." action={<Button disabled={!form || update.isPending} onClick={() => update.mutate({ data: form }, { onSuccess: (saved) => { setForm(saved); qc.invalidateQueries({ queryKey: getGetStoreSettingsQueryKey() }); } })} data-testid="button-save-settings"><Check size={15} /> Save changes</Button>} /><div className="grid gap-4 xl:grid-cols-2"><Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Settings2 size={18} /></div><div><h3 className="font-extrabold">Store identity</h3><p className="mt-1 text-xs text-muted-foreground">The storefront basics customers see.</p></div></div><div className="grid gap-4 md:grid-cols-2"><Field label="Store name"><Input value={source.storeName} onChange={(e) => set('storeName', e.target.value)} data-testid="input-settings-store-name" /></Field><Field label="Required Telegram channel"><Input value={source.requiredTelegramChannel || ''} onChange={(e) => set('requiredTelegramChannel', e.target.value || null)} placeholder="@keytopia_news" /></Field><Field label="Terms version"><Input value={source.termsVersion} onChange={(e) => set('termsVersion', e.target.value)} /></Field><Field label="USD to EGP rate"><Input type="number" min="0" value={source.usdToEgpRate} onChange={(e) => set('usdToEgpRate', Number(e.target.value))} /></Field></div></Card><Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-accent/15 p-2.5 text-accent-foreground"><CreditCard size={18} /></div><div><h3 className="font-extrabold">Checkout & payments</h3><p className="mt-1 text-xs text-muted-foreground">Availability and settlement behavior.</p></div></div><div className="grid gap-4 md:grid-cols-2"><Field label="Checkout timeout (minutes)"><Input type="number" min="1" value={source.checkoutTimeoutMinutes} onChange={(e) => set('checkoutTimeoutMinutes', Number(e.target.value))} /></Field><Field label="Payment rounding"><Select value={source.paymentRounding} onChange={(e) => set('paymentRounding', e.target.value)}><option value="exact">Exact</option><option value="nearest_egp">Nearest EGP</option><option value="nearest_5_egp">Nearest 5 EGP</option></Select></Field>{[['binanceEnabled', 'Binance'], ['bybitEnabled', 'Bybit'], ['vodafoneCashEnabled', 'Vodafone Cash']].map(([key, label]) => <label key={key} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold"><span>{label}</span><input type="checkbox" checked={source[key]} onChange={(e) => set(key, e.target.checked)} /></label>)}</div></Card><Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-700"><SlidersHorizontal size={18} /></div><div><h3 className="font-extrabold">Store policies</h3><p className="mt-1 text-xs text-muted-foreground">Quiet switches with operational impact.</p></div></div><div className="grid gap-3">{[['maintenanceMode', 'Maintenance mode', 'Temporarily pause storefront checkout'], ['supportAvailable', 'Support available', 'Allow customers to open support tickets']].map(([key, label, hint]) => <label key={key} className="flex items-center justify-between rounded-xl border border-border bg-background p-4"><span><span className="block text-sm font-bold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span></span><input type="checkbox" checked={source[key]} onChange={(e) => set(key, e.target.checked)} /></label>)}</div></Card><Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Bell size={18} /></div><div><h3 className="font-extrabold">Admin bot notifications</h3><p className="mt-1 text-xs text-muted-foreground">Receive masked product-sale alerts directly in Telegram.</p></div></div><div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end"><Field label="Admin Telegram chat ID" hint="Send /chatid to the bot, save this field, then send a test message."><Input value={source.adminTelegramChatId || ''} onChange={(e) => set('adminTelegramChatId', e.target.value || null)} placeholder="Example: 123456789" data-testid="input-admin-telegram-chat-id" /></Field><Button variant="secondary" disabled={!source.adminTelegramChatId || !form || update.isPending || testTelegram.isPending} onClick={() => testTelegram.mutate()} data-testid="button-test-admin-telegram">{testTelegram.isPending ? 'Sending…' : 'Send test message'}</Button></div>{testTelegram.isSuccess && <p className="mt-3 text-xs font-bold text-primary">Test message sent. Sale alerts are ready.</p>}{testTelegram.isError && <p className="mt-3 text-xs font-bold text-destructive">Telegram test failed. Save the chat ID first, then try again.</p>}</Card><Card className="data-grid flex min-h-48 flex-col justify-between p-5"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Store guardrails</p><h3 className="mt-2 max-w-sm text-2xl font-extrabold tracking-[-.04em]">Small rules prevent large queues.</h3><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Keep rates, stock thresholds, and checkout windows aligned with the operator who is on call.</p></div><div className="mt-6 flex items-center gap-2 text-xs font-bold text-primary"><ShieldCheck size={15} /> Changes are logged to the operator audit stream</div></Card></div></div>; }

function AuditLogs() { return <div className="animate-rise"><PageIntro eyebrow="Accountability" title="Audit logs" description="A durable history of operator actions, available when the audit stream is connected." /><Card><EmptyState icon={FileClock} title="Audit stream is not connected" body="The current API exposes the audit-log surface but no activity list hook yet. This view is ready for the audit feed when it is available." /></Card></div>; }

function VenteBot() {
  const catalog = useGetVenteBotCatalog({ query: { queryKey: getGetVenteBotCatalogQueryKey(), staleTime: 30_000 } });
  const orders = useListVenteBotOrders({ query: { queryKey: getListVenteBotOrdersQueryKey(), staleTime: 15_000 } });
  const testConnection = useTestVenteBotConnection();
  const refreshCatalog = useRefreshVenteBotCatalog();
  const createStoreProduct = useCreateVenteBotStorefrontProduct();
  const updateMapping = useUpdateVenteBotMapping();
  const retryOrder = useRetryVenteBotOrder();
  const queryClient = useQueryClient();
  const [mappingProduct, setMappingProduct] = useState<any | null>(null);
  const [localProductId, setLocalProductId] = useState('');
  const [resalePriceText, setResalePriceText] = useState('');
  const [resalePricingMode, setResalePricingMode] = useState<'manual' | 'fixed_markup'>('manual');
  const [resaleMarkupText, setResaleMarkupText] = useState('');
  const [setupMode, setSetupMode] = useState<'existing' | 'new'>('existing');
  const [copyDescription, setCopyDescription] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all');

  const invalidateVenteBot = () => {
    void queryClient.invalidateQueries({ queryKey: getGetVenteBotCatalogQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListVenteBotOrdersQueryKey() });
  };
  const openMapping = (product: any) => {
    createStoreProduct.reset();
    updateMapping.reset();
    setMappingProduct(product);
    setLocalProductId(product.mappedProductId || '');
    setResalePriceText(product.resalePriceUsd == null ? '' : String(product.resalePriceUsd));
    setResalePricingMode(product.resalePricingMode || 'manual');
    setResaleMarkupText(product.resaleMarkupUsd == null ? '' : String(product.resaleMarkupUsd));
    setSetupMode('existing');
    setCopyDescription(false);
  };
  const closeMapping = () => {
    createStoreProduct.reset();
    updateMapping.reset();
    setMappingProduct(null);
    setLocalProductId('');
    setResalePriceText('');
    setResalePricingMode('manual');
    setResaleMarkupText('');
    setSetupMode('existing');
    setCopyDescription(false);
  };
  const usdToCents = (value: string | number) => {
    if (typeof value === 'string' && value.trim().length === 0) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    const cents = Math.round(parsed * 100);
    return Math.abs(parsed * 100 - cents) < 1e-8 ? cents : null;
  };
  const maxUsdCents = 999_999_999_999;
  const effectiveResaleCents = mappingProduct
    ? resalePricingMode === 'manual'
      ? usdToCents(resalePriceText)
      : (() => {
          const supplierCents = usdToCents(mappingProduct.priceUsd);
          const markupCents = usdToCents(resaleMarkupText);
          return supplierCents === null || markupCents === null
            ? null
            : supplierCents + markupCents;
        })()
    : null;
  const isValidPricing = () =>
    effectiveResaleCents !== null
    && effectiveResaleCents <= maxUsdCents
    && (resalePricingMode === 'manual' || effectiveResaleCents >= 0);
  const pricingInput = () => resalePricingMode === 'manual'
    ? {
        resalePricingMode: 'manual' as const,
        resalePriceUsd: Number(resalePriceText),
        resaleMarkupUsd: null,
      }
    : {
        resalePricingMode: 'fixed_markup' as const,
        resalePriceUsd: null,
        resaleMarkupUsd: Number(resaleMarkupText),
      };
  const handleExistingProductChange = (productId: string) => {
    setLocalProductId(productId);
    const product = (catalog.data?.localProducts ?? [])
      .find((item: any) => item.id === productId);
    if (!product) {
      setResalePricingMode('manual');
      setResalePriceText('');
      setResaleMarkupText('');
      return;
    }
    setResalePriceText(String(product.priceUsd));
    setResalePricingMode(product.resalePricingMode || 'manual');
    setResaleMarkupText(product.resaleMarkupUsd == null ? '' : String(product.resaleMarkupUsd));
  };
  const saveMapping = () => {
    if (!mappingProduct || !isValidPricing()) return;
    const priceSetting = pricingInput();
    if (setupMode === 'new') {
      createStoreProduct.mutate(
        {
          supplierProductId: mappingProduct.id,
          data: {
            ...priceSetting,
            copyDescription,
            replaceMappedProductId: mappingProduct.mappedProductId,
          },
        },
        {
          onSuccess: () => {
            invalidateVenteBot();
            void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            closeMapping();
          },
        },
      );
      return;
    }
    if (!localProductId) return;
    updateMapping.mutate(
      {
        supplierProductId: mappingProduct.id,
        data: { productId: localProductId, ...priceSetting, copyDescription },
      },
      { onSuccess: () => { invalidateVenteBot(); void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); closeMapping(); } },
    );
  };
  const unlinkMapping = () => {
    if (!mappingProduct) return;
    updateMapping.mutate(
      {
        supplierProductId: mappingProduct.id,
        data: {
          productId: null,
          resalePricingMode: 'manual',
          resalePriceUsd: null,
          resaleMarkupUsd: null,
          copyDescription: false,
        },
      },
      { onSuccess: () => { invalidateVenteBot(); void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); closeMapping(); } },
    );
  };
  const supplierPriceCents = mappingProduct
    ? usdToCents(mappingProduct.priceUsd)
    : null;
  const expectedMarginPreview = effectiveResaleCents === null
      || supplierPriceCents === null
    ? null
    : (effectiveResaleCents - supplierPriceCents) / 100;
  const connection = catalog.data?.connection;
  const supplierProducts = catalog.data?.supplierProducts ?? [];
  const visibleSupplierProducts = useMemo(
    () => supplierProducts.filter((product: any) =>
      availabilityFilter === 'all'
      || product.availability.available === (availabilityFilter === 'available')),
    [supplierProducts, availabilityFilter],
  );
  const localProducts = catalog.data?.localProducts ?? [];
  const venteOrders = orders.data?.items ?? [];
  const failedOrders = useMemo(() => venteOrders.filter((order: any) => order.status === 'failed'), [venteOrders]);
  const blockedProducts = useMemo(() => supplierProducts.filter((product: any) => !product.availability.available), [supplierProducts]);
  const statusTone = connection?.status === 'connected' ? 'green' : connection?.status === 'error' ? 'red' : 'orange';
  const failedFulfillmentCount = connection?.failedFulfillmentCount ?? 0;
  const testError = testConnection.error instanceof Error ? testConnection.error.message : 'The connection test could not be completed.';
  const refreshError = refreshCatalog.error instanceof Error ? refreshCatalog.error.message : 'The supplier catalog could not be refreshed.';
  const retryError = retryOrder.error instanceof Error ? retryOrder.error.message : 'The supplier order could not be retried.';
  const mappingSaveError = updateMapping.error ?? createStoreProduct.error;
  const mappingSaveErrorMessage = mappingSaveError instanceof Error
    ? mappingSaveError.message
    : 'The supplier product setup could not be saved.';
  const reasonLabel = (reason: string | null | undefined) => {
    if (!reason) return 'Availability confirmed';
    if (reason === 'activation_required' || reason === 'activation_identifier_required') return 'Activation identifier required';
    return titleCase(reason);
  };
  const availabilityTone = (product: any) => product.availability.available ? 'green' : product.availability.reason === 'out_of_stock' ? 'red' : 'orange';
  const orderTone = (status: string) => status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'awaiting_delivery' ? 'blue' : 'orange';

  if (catalog.isLoading || orders.isLoading) {
    return <><PageIntro eyebrow="Supplier operations" title="VenteBot" description="Keep supplier availability, mappings, and fulfillment work in view." /><LoadingBlock /></>;
  }
  if (catalog.isError || !catalog.data) {
    return <div className="animate-rise"><PageIntro eyebrow="Supplier operations" title="VenteBot" description="The supplier control plane is temporarily out of reach." /><Card><ErrorState retry={() => catalog.refetch()} /></Card></div>;
  }

  return <div className="animate-rise">
    <PageIntro
      eyebrow="Supplier operations"
      title="VenteBot"
      description="A trustworthy handoff between KeyTopia's catalog and supplier fulfillment. Resolve blocked availability before it becomes a customer promise."
      action={<div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => testConnection.mutate(undefined, { onSuccess: invalidateVenteBot })} disabled={testConnection.isPending} data-testid="button-test-ventebot-connection">
          <ShieldCheck size={15} /> {testConnection.isPending ? 'Testing connection…' : 'Test connection'}
        </Button>
        <Button onClick={() => refreshCatalog.mutate(undefined, { onSuccess: () => { invalidateVenteBot(); void queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); } })} disabled={refreshCatalog.isPending} data-testid="button-refresh-ventebot-catalog">
          <RefreshCw size={15} /> {refreshCatalog.isPending ? 'Refreshing catalog…' : 'Refresh catalog'}
        </Button>
      </div>}
    />

    <Card className="overflow-hidden border-slate-700/20 bg-slate-950 text-slate-100">
      <div className="flex flex-col gap-5 border-b border-white/10 p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-cyan-300/15 p-3 text-cyan-200"><WalletCards size={22} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold">Supplier connection</h3>
              {connection && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[.08em] ${statusTone === 'green' ? 'bg-emerald-300/15 text-emerald-200' : statusTone === 'red' ? 'bg-rose-300/15 text-rose-200' : 'bg-amber-300/15 text-amber-200'}`} data-testid="status-ventebot-connection">{titleCase(connection.status)}</span>}
            </div>
            <p className="mt-1 text-sm text-slate-300/70">{connection?.apiKeyConfigured ? 'Reseller credentials are configured.' : 'No reseller key is configured. Supplier purchases remain unavailable.'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:min-w-[360px]" data-testid="panel-ventebot-connection-metrics">
          <div><p className="text-[10px] uppercase tracking-[.12em] text-slate-400">Wallet balance</p><p className="mt-1 font-mono font-bold text-cyan-100" data-testid="text-ventebot-wallet-balance">{money(connection?.walletBalanceUsd)}</p></div>
          <div><p className="text-[10px] uppercase tracking-[.12em] text-slate-400">Active supplier products</p><p className="mt-1 font-mono font-bold" data-testid="text-ventebot-active-count">{connection?.activeSupplierProductCount ?? 0}</p></div>
          <div><p className="text-[10px] uppercase tracking-[.12em] text-slate-400">Last check</p><p className="mt-1 text-xs font-semibold" data-testid="text-ventebot-last-check">{date(connection?.lastConnectionCheckAt)}</p></div>
          <div><p className="text-[10px] uppercase tracking-[.12em] text-slate-400">Last catalog sync</p><p className="mt-1 text-xs font-semibold" data-testid="text-ventebot-last-sync">{date(connection?.lastSyncedAt)}</p></div>
        </div>
      </div>
      {connection && (connection.lastConnectionError || failedFulfillmentCount > 0) && <div className="flex flex-wrap gap-3 bg-rose-400/10 px-5 py-3 text-xs font-bold text-rose-100 md:px-6">
        {connection.lastConnectionError && <span className="flex items-center gap-2" data-testid="status-ventebot-connection-error"><AlertTriangle size={14} /> {connection.lastConnectionError}</span>}
        {failedFulfillmentCount > 0 && <span className="flex items-center gap-2" data-testid="status-ventebot-failed-count"><AlertTriangle size={14} /> {failedFulfillmentCount} failed fulfillment{failedFulfillmentCount === 1 ? '' : 's'} need attention</span>}
      </div>}
    </Card>

    {(testConnection.isSuccess || testConnection.isError || refreshCatalog.isSuccess || refreshCatalog.isError) && <div className="mt-4 grid gap-2">
      {testConnection.isSuccess && <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm font-bold text-primary" role="status" data-testid="status-ventebot-connection-test-success">{testConnection.data?.message || (testConnection.data?.connected ? 'VenteBot connection verified.' : 'VenteBot connection test returned an error.')}</div>}
      {testConnection.isError && <div className="rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm font-bold text-destructive" role="alert" data-testid="status-ventebot-connection-test-error">Connection test failed: {testError}</div>}
      {refreshCatalog.isSuccess && <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm font-bold text-primary" role="status" data-testid="status-ventebot-refresh-success">Catalog refreshed{refreshCatalog.data?.notModified ? ' — no supplier changes detected.' : ` — ${refreshCatalog.data?.supplierProductCount ?? 0} supplier products synchronized.`}</div>}
      {refreshCatalog.isError && <div className="rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm font-bold text-destructive" role="alert" data-testid="status-ventebot-refresh-error">Catalog refresh failed: {refreshError}</div>}
    </div>}

    <div className="mt-5 grid gap-4 sm:grid-cols-3">
      <StatCard label="Supplier catalog" value={supplierProducts.length} sub={`${blockedProducts.length} blocked availability`} icon={Package} tone={blockedProducts.length ? 'orange' : 'green'} />
      <StatCard label="Mapped for resale" value={supplierProducts.filter((product: any) => product.mappedProductId).length} sub={`${localProducts.length} local products available`} icon={Link2} tone="blue" />
      <StatCard label="Failed supplier work" value={failedOrders.length} sub={failedOrders.length ? 'Retryable work is visible below' : 'No failed supplier orders'} icon={AlertTriangle} tone={failedOrders.length ? 'red' : 'green'} />
    </div>

    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-border p-5 md:flex-row md:items-end md:justify-between">
        <div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Availability & mapping</p><h3 className="mt-1 text-xl font-extrabold">Supplier catalog</h3><p className="mt-1 text-sm text-muted-foreground">Only mapped products with a verified availability state should move into storefront fulfillment.</p></div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Availability">
            <Select
              className="min-w-44"
              value={availabilityFilter}
              onChange={(event) => setAvailabilityFilter(event.target.value as 'all' | 'available' | 'unavailable')}
              data-testid="select-ventebot-availability-filter"
            >
              <option value="all">All products</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </Select>
          </Field>
          <p className="pb-2 font-mono text-xs text-muted-foreground" data-testid="text-ventebot-catalog-count">
            {visibleSupplierProducts.length} of {supplierProducts.length} supplier products
          </p>
        </div>
      </div>
      {supplierProducts.length ? visibleSupplierProducts.length ? <div className="divide-y divide-border">
        {visibleSupplierProducts.map((product: any) => <div key={product.id} className="grid gap-4 p-5 xl:grid-cols-[1.45fr_.7fr_.8fr_auto] xl:items-center" data-testid={`row-ventebot-supplier-${product.id}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h4 className="font-extrabold" data-testid={`text-ventebot-product-name-${product.id}`}>{product.name}</h4><Badge tone={product.catalogActive ? 'green' : 'neutral'}>{product.catalogActive ? 'Catalog active' : 'Inactive'}</Badge>{product.apiTest && <Badge tone="blue">API test</Badge>}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{product.description || 'No supplier description.'}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">Supplier #{product.id} · {titleCase(product.deliveryType)} · {titleCase(product.pricingType)}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Supplier price</p><p className="mt-1 font-mono text-lg font-bold" data-testid={`text-ventebot-supplier-price-${product.id}`}>{money(product.priceUsd)}</p><p className="mt-1 text-[11px] text-muted-foreground">Stock {product.stock == null ? 'unknown' : product.stock}</p></div>
          <div className={`rounded-xl p-3 ${product.availability.available ? 'bg-primary/8' : 'bg-accent/12'}`} data-testid={`status-ventebot-availability-${product.id}`}>
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Availability</p>
            <p className={`mt-1 text-sm font-extrabold ${product.availability.available ? 'text-primary' : 'text-accent-foreground'}`}>{product.availability.available ? 'Available' : reasonLabel(product.availability.reason)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{product.availability.available ? `${product.availability.quantity == null ? 'Quantity confirmed by supplier' : `${product.availability.quantity} available`}` : `Blocked: ${reasonLabel(product.availability.reason)}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <div className="mr-1 text-right"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Expected margin / unit</p><p className={`font-mono text-sm font-bold ${product.expectedMarginUsd != null && product.expectedMarginUsd < 0 ? 'text-destructive' : 'text-primary'}`} data-testid={`text-ventebot-margin-${product.id}`}>{product.expectedMarginUsd == null ? '—' : money(product.expectedMarginUsd)}</p></div>
            <Button variant="secondary" className="text-xs" onClick={() => openMapping(product)} data-testid={`button-map-ventebot-product-${product.id}`}><Link2 size={14} /> {product.mappedProductId ? 'Edit setup' : 'Set up product'}</Button>
          </div>
          {product.mappedProductId && <div className="rounded-xl border border-border bg-background p-3 text-xs xl:col-span-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-bold"><Link2 size={13} className="text-primary" /> KeyTopia product: <span data-testid={`text-ventebot-mapped-product-${product.id}`}>{product.mappedProductName || product.mappedProductId}</span></span><span className="font-mono text-muted-foreground">Resale {product.resalePriceUsd == null ? '—' : money(product.resalePriceUsd)}</span></div></div>}
        </div>)}
      </div> : <EmptyState icon={Filter} title="No products match this filter" body="Choose another availability option to see more supplier listings." /> : <EmptyState icon={Package} title="Supplier catalog is empty" body="Refresh the catalog after the VenteBot connection is configured." />}
    </Card>

    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-border p-5 md:flex-row md:items-end md:justify-between">
        <div><p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-destructive">Fulfillment watch</p><h3 className="mt-1 text-xl font-extrabold">Supplier orders</h3><p className="mt-1 text-sm text-muted-foreground">Failed supplier work stays visible until it is retried or resolved by the provider.</p></div>
        <div className="flex items-center gap-2"><Badge tone={failedOrders.length ? 'red' : 'green'}>{failedOrders.length ? `${failedOrders.length} failed` : 'No failures'}</Badge><Button variant="quiet" className="text-xs" onClick={() => orders.refetch()} data-testid="button-refresh-ventebot-orders"><RefreshCw size={14} /> Refresh</Button></div>
      </div>
      {orders.isError ? <ErrorState retry={() => orders.refetch()} /> : venteOrders.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-muted/55 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3">Order</th><th className="px-4 py-3">Customer / product</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Value / cost</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
          <tbody className="divide-y divide-border">{venteOrders.map((order: any) => <tr key={order.orderId} className={`${order.status === 'failed' ? 'bg-destructive/5' : ''} hover:bg-muted/30`} data-testid={`row-ventebot-order-${order.orderId}`}>
            <td className="px-5 py-4"><p className="font-mono text-xs font-bold" data-testid={`text-ventebot-order-number-${order.orderId}`}>{order.orderNumber}</p><p className="mt-1 text-xs text-muted-foreground">{date(order.createdAt)}</p></td>
            <td className="px-4 py-4"><p className="font-bold">{order.customerName}</p><p className="mt-1 text-xs text-muted-foreground">{order.productName}</p></td>
            <td className="px-4 py-4"><p className="font-mono text-xs">{order.providerOrderId ?? 'Not submitted'}</p><p className="mt-1 text-[11px] text-muted-foreground">{order.providerStatus ? titleCase(order.providerStatus) : '—'}</p></td>
            <td className="px-4 py-4"><p className="font-mono font-bold">{money(order.priceUsd)}</p><p className="mt-1 text-[11px] text-muted-foreground">Cost {order.acquisitionCostUsd == null ? '—' : money(order.acquisitionCostUsd)}</p></td>
            <td className="px-4 py-4 font-mono text-xs">{order.attempts}</td>
            <td className="px-4 py-4"><Badge tone={orderTone(order.status)}>{titleCase(order.status)}</Badge>{order.lastError && <p className="mt-2 max-w-[220px] text-xs font-semibold text-destructive" data-testid={`text-ventebot-order-error-${order.orderId}`}>{order.lastError}</p>}{order.nextAttemptAt && order.status !== 'failed' && <p className="mt-2 text-[11px] text-muted-foreground">Next attempt {date(order.nextAttemptAt)}</p>}</td>
            <td className="px-5 py-4 text-right">{order.canRetry ? <Button variant="secondary" className="text-xs" onClick={() => retryOrder.mutate({ orderId: order.orderId }, { onSuccess: invalidateVenteBot })} disabled={retryOrder.isPending} data-testid={`button-retry-ventebot-order-${order.orderId}`}><RotateCcw size={13} /> {retryOrder.isPending ? 'Retrying…' : 'Retry fulfillment'}</Button> : <span className="text-xs font-semibold text-muted-foreground">{order.status === 'completed' ? 'Fulfilled' : 'Waiting on provider'}</span>}</td>
          </tr>)}</tbody>
        </table>
      </div> : <EmptyState icon={Truck} title="No supplier orders" body="Orders sent to VenteBot will appear here with their provider and fulfillment state." />}
      {retryOrder.isError && <div className="border-t border-destructive/20 bg-destructive/8 px-5 py-3 text-sm font-bold text-destructive" role="alert" data-testid="status-ventebot-retry-error">Retry failed: {retryError}</div>}
      {retryOrder.isSuccess && <div className="border-t border-primary/20 bg-primary/8 px-5 py-3 text-sm font-bold text-primary" role="status" data-testid="status-ventebot-retry-success">Supplier fulfillment retry submitted.</div>}
    </Card>

    {mappingProduct && <Modal title={`Set up ${mappingProduct.name}`} onClose={closeMapping}>
      <p className="text-sm leading-6 text-muted-foreground">Choose whether to create a new KeyTopia product from this seller listing or connect it to an existing product.</p>
      {mappingProduct.mappedProductId && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">Changing this mapping or creating a replacement pauses the current KeyTopia product so it cannot sell without its supplier source.</p>}
      <fieldset className="mt-5">
        <legend className="text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Store setup</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${setupMode === 'existing' ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <input type="radio" name={`ventebot-setup-${mappingProduct.id}`} value="existing" checked={setupMode === 'existing'} onChange={() => setSetupMode('existing')} />
            <span><span className="block text-sm font-bold">Map to an existing product</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Keep the current KeyTopia listing and connect it to this seller item.</span></span>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${setupMode === 'new' ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <input type="radio" name={`ventebot-setup-${mappingProduct.id}`} value="new" checked={setupMode === 'new'} onChange={() => setSetupMode('new')} />
            <span><span className="block text-sm font-bold">Create a new store product</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Use the seller name and image, then set the price customers will pay.</span></span>
          </label>
        </div>
      </fieldset>
      <div className="mt-5 grid gap-4">
        {setupMode === 'existing' ? <Field label="KeyTopia product">
          <Select value={localProductId} onChange={(event) => handleExistingProductChange(event.target.value)} data-testid={`select-ventebot-local-product-${mappingProduct.id}`}>
            <option value="">Choose an existing product</option>
            {localProducts.map((product: any) => <option key={product.id} value={product.id}>{product.nameEn} · {money(product.priceUsd)}{product.active ? '' : ' · inactive'}</option>)}
          </Select>
        </Field> : <p className="rounded-xl bg-muted/55 p-3 text-xs leading-5 text-muted-foreground">
          The new product uses the supplier name and image. It is active only when the supplier listing is available; unavailable listings are created inactive.
        </p>}
        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Resale pricing</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${resalePricingMode === 'manual' ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input type="radio" name={`ventebot-pricing-${mappingProduct.id}`} value="manual" checked={resalePricingMode === 'manual'} onChange={() => setResalePricingMode('manual')} />
              <span><span className="block text-sm font-bold">Manual resale price</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Keep the exact price you enter, even when the supplier price changes.</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${resalePricingMode === 'fixed_markup' ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input type="radio" name={`ventebot-pricing-${mappingProduct.id}`} value="fixed_markup" checked={resalePricingMode === 'fixed_markup'} onChange={() => setResalePricingMode('fixed_markup')} />
              <span><span className="block text-sm font-bold">Supplier price + fixed amount</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Recalculate the resale price after each catalog refresh.</span></span>
            </label>
          </div>
        </fieldset>
        {resalePricingMode === 'manual' ? <Field label="Manual resale price (USD)" hint="This saved amount does not change when the supplier price changes.">
          <Input type="number" min="0" max="9999999999.99" step="0.01" value={resalePriceText} onChange={(event) => setResalePriceText(event.target.value)} placeholder="e.g. 7.50" data-testid={`input-ventebot-resale-price-${mappingProduct.id}`} />
        </Field> : <Field label="Fixed amount above supplier price (USD)" hint="This amount is added to the seller API price on every successful catalog refresh.">
          <Input type="number" min="0" max="9999999999.99" step="0.01" value={resaleMarkupText} onChange={(event) => setResaleMarkupText(event.target.value)} placeholder="e.g. 2.00" data-testid={`input-ventebot-resale-markup-${mappingProduct.id}`} />
        </Field>}
        <label className="flex items-start gap-3 rounded-xl border border-border p-4">
          <input type="checkbox" checked={copyDescription} onChange={(event) => setCopyDescription(event.target.checked)} data-testid={`checkbox-ventebot-copy-description-${mappingProduct.id}`} />
          <span><span className="block text-sm font-bold">Copy seller description into English instructions</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{setupMode === 'existing' ? 'This replaces the existing English instructions; Arabic instructions stay unchanged.' : 'The supplier provides one description, so Arabic instructions stay blank.'}</span></span>
        </label>
        <div className="grid gap-3 rounded-xl bg-muted/55 p-4 sm:grid-cols-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Supplier price</p><p className="mt-1 font-mono font-bold">{money(mappingProduct.priceUsd)}</p></div>
          <div><p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">New resale price</p><p className="mt-1 font-mono font-bold">{effectiveResaleCents === null ? '—' : money(effectiveResaleCents / 100)}</p></div>
          <div><p className="text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Expected margin</p><p className="mt-1 font-mono font-bold text-primary">{expectedMarginPreview === null ? '—' : money(expectedMarginPreview)}</p></div>
        </div>
      </div>
      {(updateMapping.isError || createStoreProduct.isError) && <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-xs font-bold text-destructive" role="alert" data-testid="status-ventebot-mapping-error">{mappingSaveErrorMessage}</p>}
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="quiet" className="text-destructive" disabled={!mappingProduct.mappedProductId || updateMapping.isPending || createStoreProduct.isPending} onClick={unlinkMapping} data-testid={`button-unlink-ventebot-product-${mappingProduct.id}`}><Unlink size={14} /> Unlink &amp; pause</Button>
        <div className="flex gap-2"><Button variant="secondary" onClick={closeMapping}>Cancel</Button><Button disabled={(setupMode === 'existing' && !localProductId) || !isValidPricing() || updateMapping.isPending || createStoreProduct.isPending} onClick={saveMapping} data-testid={`button-save-ventebot-mapping-${mappingProduct.id}`}><Check size={15} /> {setupMode === 'new' ? createStoreProduct.isPending ? 'Creating…' : 'Create store product' : updateMapping.isPending ? 'Saving…' : 'Save mapping'}</Button></div>
      </div>
    </Modal>}
  </div>;
}

function Login() {
  const [, setLocation] = useLocation();
  const login = useAdminLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    login.mutate(
      { data: { email, password } },
      {
        onSuccess: (session) => {
          updateAdminSessionCache(session);
          setLocation('/');
        },
        onError: () => setError('Email or password could not be verified.'),
      },
    );
  };

  return <div className="noise flex min-h-[100dvh] items-center justify-center bg-sidebar px-5 py-10 text-sidebar-foreground">
    <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-sidebar-border bg-sidebar md:grid-cols-[.9fr_1.1fr]">
      <div className="data-grid hidden min-h-[620px] flex-col justify-between bg-sidebar-accent/50 p-10 md:flex">
        <div>
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><KeyRound size={19} /></span><span className="font-extrabold">KeyTopia</span></div>
          <p className="mt-28 max-w-sm text-4xl font-extrabold leading-[1.05] tracking-[-.06em]">Keep the store moving.</p>
          <p className="mt-5 max-w-sm text-sm leading-6 text-sidebar-foreground/58">A calm command center for payment review, digital fulfillment, and customer care.</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/42"><ShieldCheck size={14} className="text-sidebar-primary" /> Operator access only</div>
      </div>
      <div className="bg-card p-7 text-card-foreground md:p-12">
        <div className="mb-12 md:hidden"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><KeyRound size={19} /></span><span className="font-extrabold">KeyTopia</span></div></div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">Secure sign-in</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-[-.05em]">Welcome back.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to manage the storefront operation.</p>
        <form onSubmit={submit} className="mt-9 grid gap-5">
          <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="operator@keytopia.store" data-testid="input-login-email" /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" data-testid="input-login-password" /></Field>
          {error && <div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-bold text-destructive" data-testid="status-login-error">{error}</div>}
          <Button type="submit" className="mt-2 h-11 w-full" disabled={login.isPending} data-testid="button-login">{login.isPending ? 'Verifying access...' : 'Enter control room'} <ArrowUpRight size={16} /></Button>
        </form>
        <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Protected operations environment</p>
      </div>
    </div>
  </div>;
}

function NotFound() { return <div className="grid min-h-[100dvh] place-items-center bg-background p-5 text-center"><div><p className="font-mono text-xs font-bold uppercase tracking-[.2em] text-primary">404 / outside the map</p><h1 className="mt-3 text-5xl font-extrabold tracking-[-.06em]">Nothing here.</h1><p className="mt-3 text-muted-foreground">The operation you requested does not exist.</p><Link href="/" className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="link-back-overview">Return to overview</Link></div></div>; }

function Router() { return <Switch><Route path="/login" component={Login} /><Route path="/" component={() => <Shell><Overview /></Shell>} /><Route path="/orders" component={() => <Shell><Orders /></Shell>} /><Route path="/payments" component={() => <Shell><Payments /></Shell>} /><Route path="/products" component={() => <Shell><Products /></Shell>} /><Route path="/inventory" component={() => <Shell><Inventory /></Shell>} /><Route path="/flash-sales" component={() => <Shell><FlashSales /></Shell>} /><Route path="/promo-codes" component={() => <Shell><PromoCodes /></Shell>} /><Route path="/customers" component={() => <Shell><Customers /></Shell>} /><Route path="/support" component={() => <Shell><Support /></Shell>} /><Route path="/analytics" component={() => <Shell><Analytics /></Shell>} /><Route path="/settings" component={() => <Shell><Settings /></Shell>} /><Route path="/ventebot" component={() => <Shell><VenteBot /></Shell>} /><Route path="/audit-logs" component={() => <Shell><AuditLogs /></Shell>} /><Route component={NotFound} /></Switch>; }

function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><ErrorBoundary><Router /></ErrorBoundary><Toaster /></TooltipProvider></QueryClientProvider>; }

export default App;