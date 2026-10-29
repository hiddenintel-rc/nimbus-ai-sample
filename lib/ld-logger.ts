import { basicLogger, type LDLogger } from '@launchdarkly/node-server-sdk';

// When an AI Config variation has judges attached, the AI SDK tries to build
// its own runner for each judge's provider on every completionConfig() call.
// Those provider packages are deliberately not installed (they pin an older
// `openai` than this app), so it warns and gives up each time; lib/judge.ts
// runs the judges instead. Only these expected warnings are dropped.
const EXPECTED_WARNINGS = ['Unable to load provider package', 'Provider is not supported or failed to initialize'];

const base = basicLogger({ level: 'info' });

/** The SDK's default logger, without the provider warnings above. */
export const ldLogger: LDLogger = {
  error: (...args) => base.error(...args),
  warn: (...args) => {
    const message = String(args[0] ?? '');
    if (EXPECTED_WARNINGS.some((expected) => message.startsWith(expected))) return;
    base.warn(...args);
  },
  info: (...args) => base.info(...args),
  debug: (...args) => base.debug(...args),
};
