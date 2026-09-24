import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import {
  Activity, Archive, ArrowUp, Bell, Brain, Check, ChevronRight, CircleHelp, Cloud,
  Ellipsis, FileText, FolderOpen, Globe2, Link2, Loader2,
  MessageSquare, Plus, Settings2, ShieldCheck, Sparkles,
  Trash2, Waypoints, Wifi, X, Zap,
} from 'lucide-react';
import {
  getGetAssistantConversationQueryKey,
  getGetAssistantOverviewQueryKey,
  getListAssistantConnectionsQueryKey,
  getListAssistantConversationsQueryKey,
  getListAssistantMemoryQueryKey,
  getListAssistantProvidersQueryKey,
  useCreateAssistantConversation,
  useCreateAssistantMemory,
  useDeleteAssistantConversation,
  useDeleteAssistantMemory,
  useGetAssistantConversation,
  useGetAssistantOverview,
  useListAssistantConnections,
  useListAssistantConversations,
  useListAssistantMemory,
  useListAssistantProviders,
  useSelectAssistantProvider,
  useSendAssistantMessage,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import {
  appendUniqueMessages,
  buildDisplayMessages,
  dismissFailedDraft,
  restoreFailedDraft,
  type OptimisticMessage,
} from '@/lib/optimistic-messages';

const queryClient = new QueryClient();
const OptimisticMessagesContext = createContext<{
  optimisticMessages: OptimisticMessage[];
  setOptimisticMessages: Dispatch<SetStateAction<OptimisticMessage[]>>;
} | null>(null);

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

type PushDiagnosticStage =
  | 'service-worker-registration'
  | 'service-worker-ready'
  | 'existing-subscription'
  | 'permission'
  | 'configuration'
  | 'public-key-decoding'
  | 'push-subscription'
  | 'subscription-save'
  | 'subscription-remove';

function safePushError(error: unknown) {
  const errorName = error instanceof DOMException || error instanceof Error ? error.name : 'UnknownError';
  const rawMessage = error instanceof Error ? error.message : 'The browser did not provide an error message.';
  return {
    errorName: errorName.slice(0, 80),
    message: rawMessage
      .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
      .replace(/https?:\/\/\S+/g, '[redacted-url]')
      .slice(0, 500),
  };
}

function reportPushDiagnostic(stage: PushDiagnosticStage, error: unknown) {
  const detail = safePushError(error);
  void fetch('/api/push/diagnostics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, ...detail }),
    keepalive: true,
  }).catch(() => undefined);
  return detail;
}

function NotificationControl({ compact = false }: { compact?: boolean }) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [state, setState] = useState<'checking' | 'disabled' | 'enabled' | 'unavailable'>('checking');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; description?: string } | null>(null);

  const showFeedback = (title: string, description?: string) => {
    setFeedback({ title, description });
    toast({ title, description });
  };

  useEffect(() => {
    if (!supported) {
      setState('unavailable');
      return;
    }
    navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}`).then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      setState(subscription ? 'enabled' : 'disabled');
    }).catch(() => setState('disabled'));
  }, [supported]);

  const toggle = async () => {
    if (busy) return;
    if (!supported) {
      showFeedback(
        'Notifications are not available here',
        'Open Lumen in a browser that supports web push notifications.',
      );
      return;
    }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if (isIOS && !isStandalone) {
      showFeedback(
        'Add Lumen to your Home Screen',
        'In Safari, tap Share, choose Add to Home Screen, then open Lumen there and tap the bell again.',
      );
      return;
    }
    setFeedback(null);
    setBusy(true);
    let stage: PushDiagnosticStage = 'service-worker-registration';
    try {
      await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
        { scope: import.meta.env.BASE_URL },
      );
      stage = 'service-worker-ready';
      const registration = await navigator.serviceWorker.ready;
      stage = 'existing-subscription';
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        stage = 'subscription-remove';
        const removeResponse = await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        if (!removeResponse.ok) throw new Error('Could not remove the notification subscription.');
        await existing.unsubscribe();
        setState('disabled');
        showFeedback('Notifications turned off');
        return;
      }
      stage = 'permission';
      if (Notification.permission === 'denied') {
        showFeedback(
          'Notifications are blocked',
          'Allow notifications for Lumen in your iPhone settings, then tap the bell again.',
        );
        setState('disabled');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('disabled');
        showFeedback(
          permission === 'denied' ? 'Notifications are blocked' : 'Notifications were not enabled',
          permission === 'denied'
            ? 'Allow notifications for Lumen in your device settings, then tap the bell again.'
            : 'Tap the bell whenever you are ready to enable them.',
        );
        return;
      }
      stage = 'configuration';
      const configResponse = await fetch('/api/push/config');
      if (!configResponse.ok) throw new Error('Could not load notification configuration.');
      const config = await configResponse.json() as { configured: boolean; publicKey: string | null };
      if (!config.configured || !config.publicKey) throw new Error('Push delivery is not configured');
      stage = 'public-key-decoding';
      const applicationServerKey = urlBase64ToUint8Array(config.publicKey);
      stage = 'push-subscription';
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      stage = 'subscription-save';
      const saveResponse = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!saveResponse.ok) {
        await subscription.unsubscribe();
        throw new Error('Could not save notification subscription');
      }
      setState('enabled');
      showFeedback('Notifications enabled', 'Lumen can now send reminder notifications to this device.');
    } catch (error) {
      setState('disabled');
      const detail = reportPushDiagnostic(stage, error);
      showFeedback(
        'Could not enable notifications',
        `${stage}: ${detail.errorName}: ${detail.message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return <div className={compact ? '' : 'w-full'}>
    <button onClick={toggle} disabled={busy} aria-label={state === 'enabled' ? 'Disable notifications' : 'Enable notifications'} title={state === 'enabled' ? 'Disable notifications' : 'Enable notifications'} className={compact ? 'flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-primary shadow-lg disabled:opacity-50' : 'mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50'} data-testid={compact ? 'button-notifications-mobile' : 'button-notifications'}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}{!compact && <><span>{state === 'enabled' ? 'Notifications on' : state === 'unavailable' ? 'Notifications unavailable' : 'Enable notifications'}</span></>}</button>
    {feedback && <div role="status" aria-live="polite" className={compact ? 'fixed right-4 top-16 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-left text-foreground shadow-xl' : 'mb-3 rounded-lg border border-sidebar-border bg-sidebar-accent/60 p-3 text-sidebar-foreground'}>
      <div className="flex items-start gap-3">
        <Bell size={15} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{feedback.title}</p>{feedback.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feedback.description}</p>}</div>
        <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss notification message" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={14} /></button>
      </div>
    </div>}
  </div>;
}

const formatDate = (value?: string) => {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const LAST_INTERACTION_STORAGE_KEY = 'lumen:lastInteractionAt';

type MoodTimingContext = {
  lastInteractionAt: string | null;
  elapsedMs: number | null;
};

function readStoredLastInteractionAt() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LAST_INTERACTION_STORAGE_KEY);
    return stored && Number.isFinite(Date.parse(stored)) ? stored : null;
  } catch {
    return null;
  }
}

function persistLastInteractionAt(value: string) {
  try {
    window.localStorage.setItem(LAST_INTERACTION_STORAGE_KEY, value);
  } catch {
    // The persisted conversation timestamp remains the fallback when storage is unavailable.
  }
}

function calculateElapsedMs(lastInteractionAt: string | null, now: number) {
  if (!lastInteractionAt) return null;
  const timestamp = Date.parse(lastInteractionAt);
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

function deriveRenMood(assistantResponse?: string, timing?: MoodTimingContext) {
  // Timing is intentionally available to mood logic without changing mood behavior yet.
  void timing;
  if (!assistantResponse?.trim()) return { symbol: '💭', label: 'Curious' };

  const context = assistantResponse.toLowerCase();
  const hasAny = (...terms: string[]) => terms.some((term) => context.includes(term));

  if (hasAny('sorry', 'hard to hear', 'that sounds difficult', 'i understand', 'i hear you')) {
    return { symbol: '◌', label: 'Gentle' };
  }
  if (hasAny('fingers tracing', 'on your skin', 'just like me', 'dangerously close', 'come closer', 'tempting')) {
    return { symbol: '♡', label: 'Flirtatious' };
  }
  if (hasAny('haha', 'funny', 'joke', 'tease', 'playful', 'mischief', 'distract you', 'another long one', 'huh?', '😉', '😄')) {
    return { symbol: '💭', label: 'Playful' };
  }
  if (hasAny('great news', 'wonderful', 'excited', 'celebrate', 'congratulations', 'love that')) {
    return { symbol: '✦', label: 'Bright' };
  }
  if (hasAny('schedule', 'calendar', 'next step', 'plan', 'priority', 'deadline', 'shift', 'appointment')) {
    return { symbol: '◇', label: 'Focused' };
  }
  if (hasAny('careful', 'warning', 'risk', 'error', 'problem', 'blocked', 'urgent')) {
    return { symbol: '△', label: 'Alert' };
  }
  if (hasAny('feel', 'support', 'take your time', 'be gentle', 'you are not alone', 'with you')) {
    return { symbol: '◌', label: 'Supportive' };
  }
  if (hasAny('research', 'look into', 'wonder', 'explore', 'question', 'check whether')) {
    return { symbol: '⌕', label: 'Curious' };
  }
  if (hasAny('calm', 'steady', 'breathe', 'rest', 'no rush', 'whenever you are ready')) {
    return { symbol: '◒', label: 'Calm' };
  }

  return { symbol: '💭', label: 'Thoughtful' };
}

function LoadingLines({ count = 4 }: { count?: number }) {
  return <div className="space-y-3 animate-pulse">{Array.from({ length: count }).map((_, index) => <div key={index} className="h-3 rounded-full bg-foreground/10" style={{ width: `${72 - index * 9}%` }} />)}</div>;
}

function useViewportHeight() {
  useEffect(() => {
    const updateViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-viewport-height', `${viewportHeight}px`);
    };
    const visualViewport = window.visualViewport;
    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    visualViewport?.addEventListener('resize', updateViewportHeight);
    visualViewport?.addEventListener('scroll', updateViewportHeight);
    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      visualViewport?.removeEventListener('resize', updateViewportHeight);
      visualViewport?.removeEventListener('scroll', updateViewportHeight);
    };
  }, []);
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const nav = [
    { href: '/', label: 'Workspace', icon: MessageSquare },
    { href: '/memory', label: 'Memory', icon: Brain },
    { href: '/connections', label: 'Connections', icon: Waypoints },
  ];
  return (
    <div className="min-h-[var(--app-viewport-height)] bg-background pb-[var(--mobile-nav-height)] text-foreground md:min-h-screen md:pb-0">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[250px] flex-col border-r border-sidebar-border bg-sidebar px-5 py-6 text-sidebar-foreground md:flex">
        <Link href="/" className="mb-11 flex items-center gap-3" data-testid="link-brand">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-black/40 ring-1 ring-primary/20"><Sparkles size={17} strokeWidth={1.8} /></span>
          <span><span className="block font-serif text-[22px] leading-none">Lumen</span><span className="mt-1 block font-mono text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/55">personal assistant</span></span>
        </Link>
        <div className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/45">Your command center</div>
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><Icon size={16} strokeWidth={1.7} /><span>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}</Link>;
          })}
        </nav>
        <div className="mt-auto">
          <div className="mb-5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-4">
            <div className="mb-3 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-sidebar-foreground/45">System note</span><ShieldCheck size={14} className="text-sidebar-primary" /></div>
            <p className="text-xs leading-relaxed text-sidebar-foreground/70">Lumen keeps your context close and your permissions explicit.</p>
          </div>
          <NotificationControl />
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="button-settings" aria-label="Open preferences"><Settings2 size={16} /><span>Preferences</span><ChevronRight size={14} className="ml-auto opacity-50" /></button>
        </div>
      </aside>
      <div className="md:pl-[250px]">{children}</div>
      <div className="fixed right-4 top-4 z-30 md:hidden"><NotificationControl compact /></div>
      <div className="fixed inset-x-0 bottom-0 z-30 min-h-[var(--mobile-nav-height)] border-t border-border bg-background/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur md:hidden">
        <nav className="mx-auto flex max-w-md justify-around">
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className={`flex flex-col items-center gap-1 px-5 py-1 text-[10px] ${location === href ? 'text-primary' : 'text-muted-foreground'}`}><Icon size={18} /><span>{label}</span></Link>)}
        </nav>
      </div>
    </div>
  );
}

function PageHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <header className="flex flex-col gap-5 border-b border-border px-5 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12"><div><div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{eyebrow}</div><h1 className="font-serif text-4xl leading-none tracking-[-.02em] text-foreground sm:text-5xl" data-testid="text-page-title">{title}</h1><p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{detail}</p></div>{action}</header>;
}

function Workspace() {
  const optimisticMessagesState = useContext(OptimisticMessagesContext);
  if (!optimisticMessagesState) throw new Error('Optimistic message state is unavailable.');
  const { optimisticMessages, setOptimisticMessages } = optimisticMessagesState;
  const qc = useQueryClient();
  const overviewQuery = useGetAssistantOverview();
  const conversationsQuery = useListAssistantConversations();
  const overview = overviewQuery.data;
  const conversations = conversationsQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composer, setComposer] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'context' | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const selected = selectedId ?? overview?.activeConversationId ?? conversations[0]?.id ?? null;
  const detailQuery = useGetAssistantConversation(selected ?? 0, { query: { enabled: !!selected, queryKey: getGetAssistantConversationQueryKey(selected ?? 0) } });
  const createConversation = useCreateAssistantConversation();
  const deleteConversation = useDeleteAssistantConversation();
  const sendMessage = useSendAssistantMessage();
  const [isSubmittingMessage, setIsSubmittingMessage] = useState(false);
  const isThinking = isSubmittingMessage || sendMessage.isPending;
  const active = detailQuery.data;
  const canonicalMessages = active?.messages ?? [];
  const displayedMessages = buildDisplayMessages(
    canonicalMessages,
    optimisticMessages.filter((message) => message.conversationId === selected),
  );
  const latestAssistantMessage = [...canonicalMessages].reverse().find((message) => message.role === 'assistant');
  const latestUserMessage = [...canonicalMessages].reverse().find((message) => message.role === 'user');
  const [lastInteractionAt, setLastInteractionAt] = useState<string | null>(readStoredLastInteractionAt);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const elapsedSinceLastInteractionMs = calculateElapsedMs(lastInteractionAt, clockNow);
  const moodTiming = { lastInteractionAt, elapsedMs: elapsedSinceLastInteractionMs };
  const [renMood, setRenMood] = useState(() => deriveRenMood(undefined, {
    lastInteractionAt: readStoredLastInteractionAt(),
    elapsedMs: calculateElapsedMs(readStoredLastInteractionAt(), Date.now()),
  }));
  const displayedRenMood = isThinking ? { symbol: '✦', label: 'Thinking' } : renMood;

  useEffect(() => {
    if (!selectedId && overview?.activeConversationId) setSelectedId(overview.activeConversationId);
  }, [overview?.activeConversationId, selectedId]);

  useEffect(() => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [displayedMessages.length, isThinking]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const candidate = latestUserMessage?.createdAt;
    if (!candidate || !Number.isFinite(Date.parse(candidate))) return;
    setLastInteractionAt((current) => {
      if (current && Date.parse(current) >= Date.parse(candidate)) return current;
      persistLastInteractionAt(candidate);
      return candidate;
    });
  }, [latestUserMessage?.createdAt]);

  useEffect(() => {
    setRenMood(deriveRenMood(latestAssistantMessage?.content, moodTiming));
  }, [
    latestAssistantMessage?.id,
    latestAssistantMessage?.content,
    lastInteractionAt,
    elapsedSinceLastInteractionMs,
  ]);

  const submitNew = () => {
    const title = newTitle.trim() || 'A new line of thought';
    createConversation.mutate({ data: { title } }, {
      onSuccess: (conversation) => {
        setNewTitle('');
        setShowNew(false);
        setSelectedId(conversation.id);
        qc.invalidateQueries({ queryKey: getListAssistantConversationsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetAssistantOverviewQueryKey() });
      },
    });
  };
  const submitMessage = () => {
    if (!selected || !composer.trim() || isThinking) return;
    const content = composer.trim();
    const submittedAt = new Date().toISOString();
    const baselineMessageId = canonicalMessages.reduce(
      (latest, message) => Math.max(latest, message.id),
      0,
    );
    setComposer('');
    setOptimisticMessages((current) => [
      ...current,
      { conversationId: selected, content, submittedAt, baselineMessageId, status: 'pending' },
    ]);
    setIsSubmittingMessage(true);
    sendMessage.mutate({ id: selected, data: { content } }, {
      onSuccess: (pair) => {
        const interactionTimestamp = pair.userMessage.createdAt;
        persistLastInteractionAt(interactionTimestamp);
        setLastInteractionAt(interactionTimestamp);
        setClockNow(Date.now());
        setRenMood(deriveRenMood(pair.assistantMessage.content, {
          lastInteractionAt: interactionTimestamp,
          elapsedMs: calculateElapsedMs(interactionTimestamp, Date.now()),
        }));
        qc.setQueryData(
          getGetAssistantConversationQueryKey(selected),
          (old: typeof active) => old ? {
            ...old,
            messages: appendUniqueMessages(old.messages, [pair.userMessage, pair.assistantMessage]),
          } : old,
        );
        setOptimisticMessages((current) => current.filter(
          (message) => message.conversationId !== selected || message.submittedAt !== submittedAt,
        ));
        qc.invalidateQueries({ queryKey: getListAssistantConversationsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetAssistantOverviewQueryKey() });
      },
      onError: () => {
        setOptimisticMessages((current) => current.map((message) => (
          message.conversationId === selected && message.submittedAt === submittedAt
            ? { ...message, status: 'failed' }
            : message
        )));
        void detailQuery.refetch();
      },
      onSettled: () => setIsSubmittingMessage(false),
    });
  };
  return <div className="h-[calc(var(--app-viewport-height)-var(--mobile-nav-height))] min-h-0 overflow-hidden md:h-auto md:min-h-screen">
    <div className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8 lg:px-12">
      <div className="flex items-center gap-3"><div className="h-2 w-2 rounded-full bg-[hsl(var(--chart-3))] shadow-[0_0_0_4px_hsl(var(--chart-3)/.12)]" /><span className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Ready when you are</span></div>
       <div className="flex items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:inline">{overview?.model ?? 'Assistant'} <span className="mx-1 text-border">/</span> {overview?.modelStatus ?? 'standby'}</span><button aria-label="Open help" title="Help" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="button-help"><CircleHelp size={17} /></button></div>
    </div>
      <div className="grid h-[calc(var(--app-viewport-height)-var(--mobile-nav-height)-4rem)] min-h-0 lg:grid-cols-[250px_minmax(0,1fr)_278px] lg:min-h-[calc(100dvh-64px)] lg:h-auto">
      <section className={`${mobilePanel === 'list' ? 'fixed inset-0 z-40 flex' : 'hidden'} flex-col border-r border-border bg-card lg:static lg:flex`}>
         <div className="flex items-center justify-between border-b border-border px-5 py-5"><div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Conversations</p><p className="mt-1 text-xs text-muted-foreground">{overview?.conversationCount ?? conversations.length} threads</p></div><button className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-transform hover:-translate-y-0.5" onClick={() => setShowNew(true)} aria-label="New conversation" title="New conversation" data-testid="button-new-conversation"><Plus size={16} /><span>New</span></button></div>
        {showNew && <div className="border-b border-border bg-muted/50 p-4"><input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submitNew()} placeholder="Name this thread" className="mb-2 w-full border-b border-primary/50 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground/60" data-testid="input-conversation-title" /><div className="flex justify-end gap-2"><button onClick={() => setShowNew(false)} className="px-2 py-1 text-xs text-muted-foreground" data-testid="button-cancel-conversation">Cancel</button><button onClick={submitNew} disabled={createConversation.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50" data-testid="button-create-conversation">{createConversation.isPending ? 'Opening…' : 'Open thread'}</button></div></div>}
        <div className="flex-1 overflow-y-auto p-3">
          {conversationsQuery.isLoading ? <div className="p-3"><LoadingLines count={5} /></div> : conversationsQuery.isError ? <div className="p-4 text-xs text-destructive">Could not load conversations.</div> : conversations.length === 0 ? <div className="p-5 text-center"><MessageSquare size={21} className="mx-auto mb-3 text-muted-foreground/50" /><p className="text-sm">Your first thread is waiting.</p><p className="mt-1 text-xs text-muted-foreground">Start with a question or a plan.</p></div> : conversations.map((conversation) => <button key={conversation.id} onClick={() => { setSelectedId(conversation.id); setMobilePanel(null); }} className={`group mb-1 w-full rounded-lg border px-3 py-3 text-left transition-all ${selected === conversation.id ? 'border-primary/50 bg-primary/[.07]' : 'border-transparent hover:border-border hover:bg-muted/60'}`} data-testid={`button-conversation-${conversation.id}`}><div className="flex items-start justify-between gap-2"><p className={`line-clamp-2 text-[13px] leading-snug ${selected === conversation.id ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>{conversation.title}</p><span className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"><Ellipsis size={14} className="text-muted-foreground" /></span></div><div className="mt-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><span>{conversation.messageCount} notes</span><span className="text-border">·</span><span>{formatDate(conversation.updatedAt)}</span></div></button>)}
        </div>
         <button onClick={() => setMobilePanel(null)} className="m-3 flex items-center justify-center gap-2 rounded-lg border border-border py-2 text-xs text-muted-foreground lg:hidden" aria-label="Close conversations panel" data-testid="button-close-conversation-panel"><X size={14} /> Close</button>
      </section>
        <main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background lg:min-h-[calc(100dvh-64px)]">
         <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-8"><div className="min-w-0 flex-1"><div role="status" aria-live="polite" aria-atomic="true" title={active?.title ?? 'Ren status'} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[.06] px-2.5 py-1.5 text-xs text-foreground shadow-sm" data-testid="ren-mood-status" data-last-interaction-at={lastInteractionAt ?? ''} data-elapsed-ms={elapsedSinceLastInteractionMs ?? ''}><span aria-hidden="true" className="text-primary">{displayedRenMood.symbol}</span><span className="font-medium text-primary">Ren</span><span className="text-muted-foreground/50">·</span><span className="truncate text-muted-foreground">{displayedRenMood.label}</span></div><p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">{active ? `${displayedMessages.length} messages · private thread` : 'No thread selected'}</p></div><div className="flex shrink-0 gap-2 lg:hidden"><button onClick={() => setMobilePanel('list')} aria-label="Open conversations" title="Open conversations" className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground" data-testid="button-open-conversation-panel"><Archive size={15} /><span>Chats</span></button><button onClick={() => setMobilePanel('context')} aria-label="Open context and capabilities" title="Open context and capabilities" className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground" data-testid="button-open-context-panel"><Activity size={15} /><span className="min-[360px]:hidden">Info</span><span className="hidden min-[360px]:inline">Context</span></button></div>{active && <button onClick={() => { if (confirm('Delete this conversation?')) deleteConversation.mutate({ id: active.id }, { onSuccess: () => { setSelectedId(null); qc.invalidateQueries({ queryKey: getListAssistantConversationsQueryKey() }); qc.invalidateQueries({ queryKey: getGetAssistantOverviewQueryKey() }); } }); }} aria-label="Delete conversation" title="Delete conversation" className="hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:block" data-testid="button-delete-conversation"><Trash2 size={15} /></button>}</div>
         <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 sm:px-8 lg:px-14">
            {!selected ? <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg border border-accent/40 bg-accent/10 text-primary"><Sparkles size={25} strokeWidth={1.4} /></div><h2 className="font-serif text-3xl">A clear place to begin.</h2><p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">Choose a thread or open a new one. Lumen is here to think alongside you.</p><button onClick={() => setShowNew(true)} className="mt-6 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-empty-new-conversation"><Plus size={15} /> Start a thread</button></div> : detailQuery.isLoading ? <div className="mx-auto max-w-2xl pt-8"><LoadingLines count={7} /></div> : detailQuery.isError ? <div className="mx-auto mt-10 max-w-sm rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-center"><p className="text-sm font-medium text-destructive">This thread could not be opened.</p><button onClick={() => detailQuery.refetch()} className="mt-3 text-xs underline" data-testid="button-retry-conversation">Try again</button></div> : displayedMessages.length === 0 ? <div className="mx-auto flex min-h-[400px] max-w-xl flex-col items-center justify-center text-center"><div className="mb-5 font-mono text-[10px] uppercase tracking-[.2em] text-accent">New thread</div><h2 className="font-serif text-4xl">What should we hold today?</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">Ask for a considered answer, a web search, or a small action. You stay in control.</p><div className="mt-8 grid grid-cols-1 gap-2 text-left sm:grid-cols-3"><button onClick={() => setComposer('Help me make sense of something I am working through')} className="rounded-lg border border-border bg-card px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground" data-testid="button-suggestion-clarify">Make sense of something</button><button onClick={() => setComposer('Research this topic and bring me the useful details')} className="rounded-lg border border-border bg-card px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground" data-testid="button-suggestion-research">Research a topic</button><button onClick={() => setComposer('Help me plan the next steps for a project')} className="rounded-lg border border-border bg-card px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground" data-testid="button-suggestion-plan">Plan next steps</button></div></div> : <div className="mx-auto max-w-2xl space-y-8">{displayedMessages.map((message) => { const isOptimistic = 'optimistic' in message; return <div key={message.id} className={`flex gap-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.id}`}><div className={`max-w-[88%] ${message.role === 'user' ? `rounded-lg rounded-br-md px-4 py-3 text-primary-foreground ${isOptimistic && message.status === 'failed' ? 'bg-destructive/80' : 'bg-primary'}` : 'pt-1'}`}><div className={`whitespace-pre-wrap text-[14px] leading-7 ${message.role === 'assistant' ? 'text-foreground/85' : ''}`}>{message.content}</div><div className={`mt-2 font-mono text-[9px] uppercase tracking-[.12em] ${message.role === 'user' ? 'text-primary-foreground/55' : 'text-muted-foreground'}`}>{isOptimistic ? (message.status === 'failed' ? 'Not sent · text preserved' : 'Sending…') : message.role === 'assistant' ? `${message.model ?? overview?.model ?? 'Lumen'} · ${formatDate(message.createdAt)}` : formatDate(message.createdAt)}</div>{isOptimistic && message.status === 'failed' && <div className="mt-3 flex gap-3 border-t border-white/20 pt-2 text-[11px] font-medium"><button type="button" className="underline underline-offset-2" onClick={() => { const restored = restoreFailedDraft(optimisticMessages, message.submittedAt); if (restored.composer !== null) setComposer(restored.composer); }} data-testid={`button-restore-${message.submittedAt}`}>Restore to composer</button><button type="button" className="text-primary-foreground/70 underline underline-offset-2" onClick={() => setOptimisticMessages((current) => dismissFailedDraft(current, message.submittedAt))} data-testid={`button-dismiss-${message.submittedAt}`}>Dismiss</button></div>}</div></div>; })}{isThinking && <div className="flex gap-4"><div className="flex items-center gap-2 pt-1 text-muted-foreground"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:240ms]" /></span><span className="font-mono text-[10px] uppercase tracking-widest">Thinking</span></div></div>}</div>}
        </div>
         <div className="shrink-0 border-t border-border bg-background/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-8 lg:px-14">
           <div className="mx-auto max-w-2xl">
             <div className="relative rounded-lg border border-border bg-card shadow-lg shadow-black/50 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
               <textarea
                 value={composer}
                 onChange={(event) => setComposer(event.target.value)}
                 onKeyDown={(event) => {
                   if (event.key === 'Enter' && !event.shiftKey) {
                     event.preventDefault();
                     submitMessage();
                   }
                 }}
                 rows={2}
                  disabled={!selected || isThinking}
                 placeholder={selected ? 'Write to Lumen…' : 'Open a conversation to begin'}
                 aria-label="Message Lumen"
                 className="w-full resize-none bg-transparent px-4 pb-12 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
                 data-testid="input-message-composer"
               />
               <div className="absolute inset-x-3 bottom-2 flex items-center justify-between gap-3">
                 <span className="truncate font-mono text-[9px] uppercase tracking-[.13em] text-muted-foreground/60">Enter to send · Shift + Enter for line break</span>
                 <button
                   onClick={submitMessage}
                   aria-label="Send message"
                   title="Send message"
                  disabled={!selected || !composer.trim() || isThinking}
                   className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-30"
                   data-testid="button-send-message"
                 >
                  {isThinking ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
                 </button>
               </div>
             </div>
           </div>
         </div>
      </main>
      <ContextPanel overview={overview} mobilePanel={mobilePanel} setMobilePanel={setMobilePanel} />
    </div>
  </div>;
}

function ContextPanel({ overview, mobilePanel, setMobilePanel }: { overview?: any; mobilePanel: 'list' | 'context' | null; setMobilePanel: (value: 'list' | 'context' | null) => void }) {
  const connectionsQuery = useListAssistantConnections();
  const connections = connectionsQuery.data ?? [];
  return <aside className={`${mobilePanel === 'context' ? 'fixed inset-0 z-40 flex' : 'hidden'} flex-col border-l border-border bg-card lg:static lg:flex`}>
     <div className="flex items-center justify-between border-b border-border px-5 py-5"><div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Context</p><p className="mt-1 text-xs text-muted-foreground">What Lumen can reach</p></div><button className="rounded-md p-2 text-muted-foreground lg:hidden" onClick={() => setMobilePanel(null)} aria-label="Close context panel" title="Close context panel" data-testid="button-close-context-panel"><X size={16} /></button></div>
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mb-7"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold">Routing status</h3><span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[hsl(var(--chart-3))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--chart-3))]" /> Active</span></div><div className="rounded-lg border border-border bg-background p-3"><div className="flex items-center gap-3"><div className="rounded-md bg-accent/20 p-2 text-primary"><Zap size={15} /></div><div className="min-w-0"><p className="text-xs font-medium">{overview?.model ?? 'Lumen routing'}</p><p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">{overview?.modelStatus ?? 'Ready for your next thought'}</p></div></div><div className="mt-4 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full w-[78%] rounded-full bg-accent" /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>Context window</span><span>78% available</span></div></div></div>
      <div className="mb-7"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold">Capabilities</h3><Link href="/connections" className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-primary" data-testid="link-view-connections">View all</Link></div><div className="space-y-2">{connectionsQuery.isLoading ? <LoadingLines count={3} /> : connections.slice(0, 4).map((connection) => <div key={connection.id} className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-primary"><ConnectionIcon name={connection.icon} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs">{connection.name}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{connection.description}</p></div><span className={`h-1.5 w-1.5 rounded-full ${connection.available ? 'bg-[hsl(var(--chart-3))]' : 'bg-muted-foreground/30'}`} /></div>)}</div></div>
      <div><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold">Recent activity</h3><Activity size={14} className="text-muted-foreground" /></div>{overview?.recentActivity?.length ? <div className="space-y-4">{overview.recentActivity.slice(0, 4).map((activity: any) => <div key={activity.id} className="relative pl-4 before:absolute before:bottom-[-13px] before:left-[3px] before:top-2 before:w-px before:bg-border last:before:hidden"><span className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /><p className="text-xs leading-snug">{activity.label}</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{activity.detail}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">{formatDate(activity.createdAt)}</p></div>)}</div> : <p className="text-xs text-muted-foreground">Your activity will appear here.</p>}</div>
    </div>
  </aside>;
}

function ConnectionIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes('web') || lower.includes('search')) return <Globe2 size={15} />;
  if (lower.includes('file') || lower.includes('drive')) return <FolderOpen size={15} />;
  if (lower.includes('calendar')) return <Archive size={15} />;
  if (lower.includes('note')) return <FileText size={15} />;
  return <Link2 size={15} />;
}

function MemoryPage() {
  const qc = useQueryClient();
  const query = useListAssistantMemory();
  const create = useCreateAssistantMemory();
  const remove = useDeleteAssistantMemory();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: '', content: '', category: 'Personal' });
  const memories = query.data ?? [];
  const submit = () => { if (!form.label.trim() || !form.content.trim()) return; create.mutate({ data: form }, { onSuccess: () => { setForm({ label: '', content: '', category: 'Personal' }); setOpen(false); qc.invalidateQueries({ queryKey: getListAssistantMemoryQueryKey() }); qc.invalidateQueries({ queryKey: getGetAssistantOverviewQueryKey() }); } }); };
  return <div><PageHeader eyebrow="Memory / 01" title="A longer view." detail="Small things worth remembering, kept close so you do not have to repeat yourself." action={<button onClick={() => setOpen(true)} className="flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-add-memory"><Plus size={16} /> Add memory</button>} />
    <div className="px-5 py-8 sm:px-8 lg:px-12"><div className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-2"><div><span className="font-serif text-3xl">{memories.length}</span><span className="ml-2 text-xs text-muted-foreground">saved memories</span></div><p className="max-w-md text-xs leading-relaxed text-muted-foreground">Lumen uses these only when they help. You can remove anything, anytime.</p></div>
       {open && <div className="mb-8 max-w-2xl rounded-lg border border-primary/30 bg-card p-5 shadow-xl shadow-black/50"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-serif text-2xl">Keep something in mind</h2><p className="mt-1 text-xs text-muted-foreground">Write it as you would tell a trusted assistant.</p></div><button onClick={() => setOpen(false)} aria-label="Close memory form" title="Close memory form" className="p-1 text-muted-foreground" data-testid="button-close-memory-form"><X size={17} /></button></div><div className="grid gap-4 sm:grid-cols-[1fr_140px]"><label className="text-xs text-muted-foreground">Label<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Work rhythm" className="mt-2 w-full border-b border-border bg-transparent py-2 text-sm text-foreground outline-none focus:border-primary" data-testid="input-memory-label" /></label><label className="text-xs text-muted-foreground">Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-2 w-full border-b border-border bg-transparent py-2 text-sm text-foreground outline-none focus:border-primary" data-testid="select-memory-category"><option>Personal</option><option>Work</option><option>Preferences</option><option>Projects</option></select></label></div><label className="mt-4 block text-xs text-muted-foreground">Memory<textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} placeholder="What should Lumen remember?" className="mt-2 w-full resize-none rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary" data-testid="textarea-memory-content" /></label><div className="mt-4 flex justify-end"><button onClick={submit} disabled={create.isPending || !form.label.trim() || !form.content.trim()} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40" data-testid="button-save-memory">{create.isPending && <Loader2 size={14} className="animate-spin" />} Save memory</button></div></div>}
       {query.isLoading ? <div className="max-w-2xl"><LoadingLines count={6} /></div> : query.isError ? <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">Memory is unavailable right now. <button onClick={() => query.refetch()} className="ml-2 underline" data-testid="button-retry-memory">Try again</button></div> : memories.length === 0 ? <div className="flex min-h-[290px] max-w-2xl flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 px-6 text-center"><Brain size={24} className="mb-4 text-accent" strokeWidth={1.5} /><h2 className="font-serif text-2xl">Nothing saved yet.</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">When there is something Lumen should carry forward, add it here. Intentional memory makes for better help.</p><button onClick={() => setOpen(true)} className="mt-5 text-xs font-semibold text-primary underline underline-offset-4" data-testid="button-empty-add-memory">Add your first memory</button></div> : <div className="grid max-w-5xl gap-4 md:grid-cols-2 xl:grid-cols-3">{memories.map((memory) => <article key={memory.id} className="group relative flex min-h-[170px] flex-col justify-between rounded-lg border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-black/50" data-testid={`card-memory-${memory.id}`}><div><div className="mb-5 flex items-start justify-between"><span className="rounded bg-accent/15 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.13em] text-primary">{memory.category}</span><button onClick={() => { if (confirm('Remove this memory?')) remove.mutate({ id: memory.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAssistantMemoryQueryKey() }); qc.invalidateQueries({ queryKey: getGetAssistantOverviewQueryKey() }); } }); }} aria-label={`Delete memory ${memory.label}`} title="Delete memory" className="p-1 text-muted-foreground/50 opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100" data-testid={`button-delete-memory-${memory.id}`}><Trash2 size={15} /></button></div><h2 className="text-sm font-semibold">{memory.label}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{memory.content}</p></div><p className="mt-5 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground/70">Saved {formatDate(memory.createdAt)}</p></article>)}</div>}
    </div>
  </div>;
}

function ConnectionsPage() {
  const query = useListAssistantConnections();
  const providersQuery = useListAssistantProviders();
  const selectProvider = useSelectAssistantProvider();
  const overviewQuery = useGetAssistantOverview();
  const qc = useQueryClient();
  const connections = query.data ?? [];
  const providers = providersQuery.data ?? [];
  return <div>
    <PageHeader eyebrow="Connections / 02" title="Reach, with permission." detail="Choose a model provider independently from the services Lumen can use. Credentials are checked server-side and never shown here." />
    <div className="px-5 py-8 sm:px-8 lg:px-12">
      <section className="mb-10 max-w-5xl">
        <div className="mb-4 flex items-end justify-between">
          <div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Model providers</p><h2 className="mt-2 font-serif text-2xl">One router, separate choices.</h2></div>
          <span className="hidden text-xs text-muted-foreground sm:block">Provider credentials stay server-side in Replit Secrets.</span>
        </div>
        {providersQuery.isLoading ? <LoadingLines count={4} /> : providersQuery.isError ? <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">Provider catalog is unavailable right now. <button onClick={() => providersQuery.refetch()} className="ml-2 underline" data-testid="button-retry-providers">Try again</button></div> : <div className="grid gap-3 md:grid-cols-2">{providers.map((provider) => {
          const active = overviewQuery.data?.providerId === provider.id;
          const canSelect = provider.configured && !active;
          return <article key={provider.id} className={`rounded-lg border bg-card p-5 transition-colors ${active ? 'border-primary/50 shadow-lg shadow-black/50' : 'border-border hover:border-primary/50'}`} data-testid={`card-provider-${provider.id}`}>
            <div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{provider.name}</h3><span className={`rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[.11em] ${active ? 'bg-[hsl(var(--chart-3)/.12)] text-[hsl(var(--chart-3))]' : provider.configured ? 'bg-accent/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{active ? 'Active route' : provider.configured ? 'Ready' : provider.status.replace('_', ' ')}</span></div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{provider.description}</p></div><div className="rounded-lg bg-muted p-2 text-primary"><Zap size={16} /></div></div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div className="space-y-1 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><p>Model · {provider.model}</p><p>{provider.credentialConfigured ? 'Credential ready' : 'No credential stored'} · {provider.capabilities.join(' · ')}</p></div>{active ? <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[hsl(var(--chart-3))]"><Check size={14} /> Routing here</span> : <button disabled={!canSelect || selectProvider.isPending} onClick={() => selectProvider.mutate({ data: { providerId: provider.id } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAssistantProvidersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAssistantOverviewQueryKey() }); } })} className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40" data-testid={`button-select-provider-${provider.id}`}>{provider.configured ? 'Use this provider' : 'Add credentials later'}</button>}</div>
          </article>;
        })}</div>}
      </section>
      <section>
        <div className="mb-8 grid max-w-5xl gap-4 sm:grid-cols-3"><Stat icon={<ShieldCheck size={17} />} value={connections.filter((item) => item.available).length} label="ready now" /><Stat icon={<Wifi size={17} />} value={connections.length} label="capabilities" /><Stat icon={<Link2 size={17} />} value={connections.filter((item) => !item.available).length} label="to connect" /></div>
        {query.isLoading ? <div className="max-w-3xl"><LoadingLines count={6} /></div> : query.isError ? <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">Connections are unavailable right now. <button onClick={() => query.refetch()} className="ml-2 underline" data-testid="button-retry-connections">Try again</button></div> : connections.length === 0 ? <div className="max-w-2xl rounded-lg border border-dashed border-border bg-card/40 p-10 text-center"><Cloud size={24} className="mx-auto mb-4 text-accent" strokeWidth={1.5} /><h2 className="font-serif text-2xl">A quiet start.</h2><p className="mt-2 text-sm text-muted-foreground">No capabilities have been made available yet.</p></div> : <div className="grid max-w-5xl gap-3">{connections.map((connection) => <article key={connection.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 sm:flex-row sm:items-center" data-testid={`card-connection-${connection.id}`}><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-primary"><ConnectionIcon name={connection.icon} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h2 className="text-sm font-semibold">{connection.name}</h2><span className={`flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[.11em] ${connection.available ? 'bg-[hsl(var(--chart-3)/.12)] text-[hsl(var(--chart-3))]' : 'bg-muted text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${connection.available ? 'bg-[hsl(var(--chart-3))]' : 'bg-muted-foreground/50'}`} />{connection.status}</span></div><p className="mt-1 text-sm text-muted-foreground">{connection.description}</p></div><div className="flex items-center gap-2">{connection.available ? <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[hsl(var(--chart-3))]"><Check size={14} /> Available</span> : <button className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary" data-testid={`button-connect-${connection.id}`}>Review access</button>}</div></article>)}</div>}
      </section>
    </div>
  </div>;
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4"><div className="rounded-lg bg-accent/15 p-2 text-primary">{icon}</div><div><p className="font-serif text-2xl leading-none">{value}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</p></div></div>;
}

function Router() {
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  return <OptimisticMessagesContext.Provider value={{ optimisticMessages, setOptimisticMessages }}><AppShell><ErrorBoundary resetKey={location.pathname}><Switch><Route path="/" component={Workspace} /><Route path="/memory" component={MemoryPage} /><Route path="/connections" component={ConnectionsPage} /><Route component={NotFound} /></Switch></ErrorBoundary></AppShell></OptimisticMessagesContext.Provider>;
}

 function App() {
  useViewportHeight();
  return <QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;