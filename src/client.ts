// Thin wrapper around the propline SDK constructor. Resolves auth from
// (in priority order): --api-key flag → PROPLINE_API_KEY env var → exit
// with a friendly message. Also threads --base-url for self-hosted /
// staging deployments and --timeout for slow networks.
//
// Pulled out of index.ts so every command resolves credentials the same
// way — drift between commands is the most common source of "works on
// my machine" CLI bugs.

import { PropLine, PropLineError } from "propline";

export interface ClientFlags {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

export function buildClient(flags: ClientFlags): PropLine {
  const apiKey = flags.apiKey ?? process.env.PROPLINE_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "error: API key required.\n\n" +
        "  Set PROPLINE_API_KEY in your environment, or pass --api-key.\n" +
        "  Get one free at https://prop-line.com\n",
    );
    process.exit(2);
  }
  return new PropLine(apiKey, {
    baseUrl: flags.baseUrl,
    timeoutMs: flags.timeout ? flags.timeout * 1000 : undefined,
  });
}

/** Wrap a command body with consistent error reporting. PropLine API
 *  errors get a one-line summary; everything else surfaces the message
 *  + exits non-zero so shell scripts can detect failure. */
export async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof PropLineError) {
      process.stderr.write(`error: ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`error: ${err.message}\n`);
    } else {
      process.stderr.write(`error: ${String(err)}\n`);
    }
    process.exit(1);
  }
}
