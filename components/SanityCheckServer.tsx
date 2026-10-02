import { getLDClient, anonymousContext } from '@/lib/ld-server';

/** Temporary: proves the server-side Node SDK can connect and evaluate flags. */
export default async function SanityCheckServer() {
  const client = await getLDClient();
  const value = await client.variation('sanity-check', anonymousContext, false);

  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-500">
      Server SDK evaluated <code>sanity-check</code> as{' '}
      <span className="font-semibold text-black dark:text-zinc-50">{String(value)}</span>
    </p>
  );
}
