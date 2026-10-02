import ChatPanel from "@/components/ChatPanel";
import SanityCheckClient from "@/components/SanityCheckClient";
import SanityCheckServer from "@/components/SanityCheckServer";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between px-6 py-5 sm:px-12">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          Nimbus
        </span>
        <nav className="flex items-center gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          <a href="#chat" className="hover:text-black dark:hover:text-zinc-50">
            Try it
          </a>
          <a href="/login" className="hover:text-black dark:hover:text-zinc-50">
            Log in
          </a>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 py-16 sm:px-12 sm:py-24">
        <div className="flex max-w-2xl flex-col items-center gap-6 text-center">
          <span className="rounded-full border border-black/[.08] px-3 py-1 text-xs font-medium text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
            Now with tiered model access
          </span>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-black dark:text-zinc-50 sm:text-5xl">
            An AI assistant that scales with your plan.
          </h1>
          <p className="max-w-lg text-lg leading-7 text-zinc-600 dark:text-zinc-400">
            Free, Pro, and Enterprise tiers get different models and context
            windows under the hood &mdash; chosen at runtime, not at deploy time.
          </p>
        </div>

        <section
          id="chat"
          className="mt-16 flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
              Chat demo
            </h2>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              free tier model
            </span>
          </div>
          <ChatPanel />
        </section>

        <section className="mt-6 flex w-full max-w-2xl flex-col gap-2 rounded-2xl border border-dashed border-black/[.15] p-6 dark:border-white/[.2]">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            LaunchDarkly connectivity (temporary — removed once real flags land)
          </h2>
          <SanityCheckServer />
          <SanityCheckClient />
        </section>
      </main>

      <footer className="px-6 py-8 text-center text-xs text-zinc-400 sm:px-12">
        Demo application built for the LaunchDarkly SE technical exercise.
      </footer>
    </div>
  );
}
