import {
  Component,
  Suspense,
  createContext,
  lazy,
  useContext,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { choose, LanguageSwitcher, useLanguage } from "./i18n.js";
import emblem from "./assets/brand/emblem.webp";
import "./du-shell.css";

export function LoadingPanel() {
  useLanguage();
  return (
    <div className="loading">
      <img src={emblem} alt="" width={52} height={52} className="du-loading-emblem" />
      <p role="status" aria-live="polite">
        {choose({ bn: "DigitalUnion লোড হচ্ছে…", en: "Loading DigitalUnion…" })}
      </p>
      <div className="du-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <LanguageSwitcher />
    </div>
  );
}

/**
 * M-003 (P2): lazy chunks are re-created per chunk key. A failed dynamic
 * import is not cached by the browser module map, so a fresh lazy component
 * re-fetches the chunk — which is what makes the boundary's "Try again"
 * button a real retry instead of re-throwing the same rejected promise.
 * The key is the chain of AsyncPanel boundaries above the component (see
 * ModuleBoundary): every boundary contributes a per-mount instance id plus
 * its own attempt counter, so a retry at ANY ancestor boundary — or a
 * remount of one — yields a fresh key. A plain per-boundary counter is not
 * enough: nested boundaries shadow each other, so an outer retry would
 * remount an inner boundary at attempt 0 and the lazy would read the same
 * rejected payload again (observed on /guide). A lazy component outside
 * any AsyncPanel reads the default "" key.
 */
const ChunkAttemptContext = createContext("");

let moduleBoundaryCounter = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * M-003: a lazy() whose factory recovers from a failed dynamic import.
 *
 * Two facts force this shape (both observed, not assumed):
 * 1. A component that suspends during render has that render's hook state
 *    discarded by React, so a lazy() created in useMemo would be recreated
 *    on every retry with a fresh pending promise: an infinite suspend loop
 *    (observed on /guide). The lazy payloads therefore live in a
 *    closure-level cache keyed by chunk key — NOT in useMemo/useRef.
 * 2. Chromium caches a FAILED dynamic import per document: three
 *    sequential import() calls of the same chunk URL after the first was
 *    aborted produced exactly ONE network fetch — the 2nd/3rd returned the
 *    cached rejection. So re-importing the same specifier can never
 *    recover, and neither can a fresh lazy component. The retry therefore
 *    re-imports the chunk under a cache-busting `?du-retry=N` query (a
 *    distinct module-map key; static servers ignore the query, and the
 *    chunk's own relative imports resolve against the query-less base).
 *    The chunk URL comes from the failed import's own error message
 *    ("Failed to fetch dynamically imported module: <url>"); if no URL
 *    can be extracted the error rethrows unchanged. The raw importer and
 *    the export picker are separate arguments precisely so the bust path
 *    can apply the same picker to the busted import.
 * A persistent failure still reaches the boundary below, which offers
 * Try again / Reload; Try again bumps the chunk key, so the next attempt
 * gets a fresh lazy component AND a fresh bust number.
 */
export function lazyWithRetry<M, T extends ComponentType<any>>(
  rawImporter: () => Promise<M>,
  pick: (loaded: M) => T,
  options?: { retries?: number; bust?: boolean },
): T {
  // The cache is capped: keys accumulate only on retries/remounts.
  const cache = new Map<string, LazyExoticComponent<T>>();
  const retries = options?.retries ?? 2;
  const bust = options?.bust ?? true;
  // Per-chunk bust counter: every bust fetch needs a URL never used
  // before in this document, across factory retries AND boundary retries.
  let bustCount = 0;
  function chunkUrlFromError(error: unknown): string | null {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const match = /https?:\/\/[^\s'"]+/.exec(message);
    if (!match) return null;
    // Strip any earlier bust query so each retry appends exactly one.
    return match[0].split("du-retry=")[0].replace(/[?&]$/, "");
  }
  function RetryableLazy(props: Record<string, unknown>) {
    const key = useContext(ChunkAttemptContext);
    let LazyComp = cache.get(key);
    if (!LazyComp) {
      LazyComp = lazy(async () => {
        try {
          return { default: pick(await rawImporter()) };
        } catch (firstError) {
          if (!bust) throw firstError;
          let lastError: unknown = firstError;
          for (let i = 0; i < retries; i++) {
            const url = chunkUrlFromError(lastError);
            if (!url) throw lastError;
            bustCount += 1;
            try {
              return {
                default: pick(
                  await import(
                    /* @vite-ignore */ `${url}${url.includes("?") ? "&" : "?"}du-retry=${bustCount}`,
                  ),
                ),
              };
            } catch (error) {
              lastError = error;
            }
            if (i < retries - 1) await sleep(300 * (i + 1));
          }
          throw lastError;
        }
      });
      if (cache.size >= 32) cache.delete(cache.keys().next().value!);
      cache.set(key, LazyComp);
    }
    return <LazyComp {...(props as any)} />;
  }
  // The wrapper is transparent: call sites keep the wrapped component's
  // own prop types (so JSX callbacks keep their contextual types).
  return RetryableLazy as unknown as T;
}

function LoadErrorPanel({ onRetry }: { onRetry?: () => void }) {
  useLanguage();
  return (
    <section className="panel narrow" role="alert">
      <LanguageSwitcher />
      <h2>
        {choose({
          bn: "এই অংশটি লোড করা যায়নি",
          en: "This section could not load",
        })}
      </h2>
      <p>
        {choose({
          bn: "ইন্টারনেট সংযোগ পরীক্ষা করে পৃষ্ঠাটি আবার লোড করুন। সংরক্ষণ না করা পরিবর্তন হারিয়ে যেতে পারে।",
          en: "Check your connection and reload the page. Unsaved changes may be lost.",
        })}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {choose({ bn: "আবার চেষ্টা করুন", en: "Try again" })}
        </button>
      )}{" "}
      <button type="button" onClick={() => location.reload()}>
        {choose({ bn: "পুনরায় লোড করুন", en: "Reload page" })}
      </button>
    </section>
  );
}

/** A failed dynamic import must leave a usable recovery screen instead of a blank page. */
class ModuleBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };

  static contextType = ChunkAttemptContext;
  declare context: React.ContextType<typeof ChunkAttemptContext>;
  // M-003: a per-mount id — see ChunkAttemptContext. A remount must yield
  // a fresh chunk key even though the attempt counter restarts at 0.
  private instanceId = ++moduleBoundaryCounter;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // CH-004: the boundary must reset on route/navigation change — the old
  // boundary kept `failed` forever, so navigating away from a bad URL
  // (e.g. #/applications?state=AWAITING_ISSUANCE) to a valid one still
  // showed the dead error screen until a full reload. A hash/popstate
  // navigation clears the failure so the new route renders; if the new
  // route itself throws, the boundary catches it again.
  private onNavigate = () => {
    if (this.state.failed) this.setState({ failed: false, attempt: this.state.attempt + 1 });
  };

  componentDidMount() {
    addEventListener("hashchange", this.onNavigate);
    addEventListener("popstate", this.onNavigate);
  }

  componentWillUnmount() {
    removeEventListener("hashchange", this.onNavigate);
    removeEventListener("popstate", this.onNavigate);
  }

  componentDidUpdate(prevProps: { resetKey?: string }) {
    if (
      this.props.resetKey !== undefined &&
      prevProps.resetKey !== this.props.resetKey &&
      this.state.failed
    ) {
      this.setState({ failed: false, attempt: this.state.attempt + 1 });
    }
  }

  private retry = () => {
    this.setState({ failed: false, attempt: this.state.attempt + 1 });
  };

  render() {
    if (this.state.failed) {
      return <LoadErrorPanel onRetry={this.retry} />;
    }
    // M-003: the chunk key chains every ancestor boundary (parent prefix
    // + this mount's id + this boundary's attempt), so a retry or remount
    // at any level re-creates the lazy payloads below it.
    const chunkKey = `${this.context}${this.instanceId}:${this.state.attempt}|`;
    return (
      <ChunkAttemptContext.Provider value={chunkKey}>
        {this.props.children}
      </ChunkAttemptContext.Provider>
    );
  }
}

export function AsyncPanel({
  children,
  fallback,
  resetKey,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional key the boundary resets on (e.g. a route); hash navigation already resets it. */
  resetKey?: string;
}) {
  return (
    <ModuleBoundary resetKey={resetKey}>
      <Suspense fallback={fallback ?? <LoadingPanel />}>{children}</Suspense>
    </ModuleBoundary>
  );
}
