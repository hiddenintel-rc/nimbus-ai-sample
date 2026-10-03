import ChatPanel from "@/components/ChatPanel";
import MemoryStatusBadge from "@/components/MemoryStatusBadge";
import UpgradeCta from "@/components/UpgradeCta";
import { auth } from "@/lib/auth";
import { logoutAction } from "@/lib/auth-actions";

export default async function Home() {
  const session = await auth();

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
          {session?.user ? (
            <>
              <span className="text-zinc-500 dark:text-zinc-500">{session.user.email}</span>
              <form action={logoutAction}>
                <button type="submit" className="hover:text-black dark:hover:text-zinc-50">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <a href="/login" className="hover:text-black dark:hover:text-zinc-50">
              Log in
            </a>
          )}
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
            {session?.user && (
              <div className="flex items-center gap-2">
                <MemoryStatusBadge />
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium capitalize text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  account: {session.user.tier}
                </span>
              </div>
            )}
          </div>
          {session?.user ? (
            <>
              <ChatPanel />
              {session.user.tier === "free" && <UpgradeCta />}
            </>
          ) : (
            <div className="flex flex-col items-start gap-3 py-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                Log in to try the live demo &mdash; this keeps the underlying
                model available only to signed-in visitors instead of open to
                anyone on the internet.
              </p>
              <a
                href="/login"
                className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
              >
                Log in
              </a>
            </div>
          )}
        </section>
      </main>

      <footer className="px-6 py-8 text-center text-xs text-zinc-400 sm:px-12">
        Nimbus is an independent demo project, not a real product &mdash; built with LaunchDarkly for feature flags and experimentation.
      </footer>
    </div>
  );
}
