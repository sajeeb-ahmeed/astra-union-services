import { Component, Suspense, type ReactNode } from "react";
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
    return this.props.children;
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
