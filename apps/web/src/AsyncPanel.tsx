import { Component, Suspense, type ReactNode } from "react";
import { choose, LanguageSwitcher, useLanguage } from "./i18n.js";

export function LoadingPanel() {
  useLanguage();
  return (
    <div className="loading">
      <p role="status" aria-live="polite">
        {choose({ bn: "অ্যাস্ট্রা লোড হচ্ছে…", en: "Loading Astra…" })}
      </p>
      <LanguageSwitcher />
    </div>
  );
}

function LoadErrorPanel() {
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
      <button type="button" onClick={() => location.reload()}>
        {choose({ bn: "পুনরায় লোড করুন", en: "Reload page" })}
      </button>
    </section>
  );
}

/** A failed dynamic import must leave a usable recovery screen instead of a blank page. */
class ModuleBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <LoadErrorPanel /> : this.props.children;
  }
}

export function AsyncPanel({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <ModuleBoundary>
      <Suspense fallback={fallback ?? <LoadingPanel />}>{children}</Suspense>
    </ModuleBoundary>
  );
}
