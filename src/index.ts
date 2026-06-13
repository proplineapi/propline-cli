// PropLine CLI — terminal interface to the PropLine player props API.
// Wraps the `propline` Node SDK; no API surface of its own. Add new
// commands by importing a handler from ./commands.ts and registering
// it on the matching `program.command(...)` below.

import { Command, Option } from "commander";
import {
  cmdSports,
  cmdEvents,
  cmdOdds,
  cmdScores,
  cmdContext,
  cmdMovement,
  cmdGrandSalami,
  cmdDailyGoalsTotal,
  cmdResolutionSummary,
  cmdLive,
  cmdEv,
  cmdPlayerHistory,
  cmdPlayerTrends,
  cmdExportResolvedProps,
  cmdExportOddsHistory,
  cmdHistory,
  cmdClosing,
  cmdWebhooksList,
  cmdWebhooksCreate,
  cmdWebhooksDelete,
  cmdWebhooksTest,
  cmdWebhooksDeliveries,
} from "./commands.js";

export const VERSION = "0.12.0";

const program = new Command();

program
  .name("propline")
  .description(
    "PropLine CLI — query live odds, scores, +EV plays, prop resolution, and webhooks from the terminal.",
  )
  .version(VERSION)
  // Global flags. Each command resolves these via its own options object
  // (commander merges parent options into action callbacks for us via
  // .opts({ from: 'parent' }), but easier to just pull from this.parent
  // explicitly to stay strict-typed-friendly).
  .addOption(
    new Option("--api-key <key>", "PropLine API key").env("PROPLINE_API_KEY"),
  )
  .addOption(
    new Option(
      "--base-url <url>",
      "API base URL (default https://api.prop-line.com/v1)",
    ),
  )
  .addOption(
    new Option(
      "--timeout <seconds>",
      "Request timeout in seconds (default 15)",
    ).argParser((v) => parseInt(v, 10)),
  )
  .addOption(new Option("--json", "Emit raw JSON instead of a table"))
  .showHelpAfterError();

// Helper to merge global + command-local options into the flat shape
// the handlers expect. Keeps each command call site terse.
function gather(cmd: Command): Record<string, unknown> {
  const own = cmd.opts();
  const parent = cmd.parent?.opts() ?? {};
  return { ...parent, ...own };
}

/* ── sports ─────────────────────────────────────────────────────────── */

program
  .command("sports")
  .description("List available sports")
  .action(function (this: Command) {
    return cmdSports(gather(this));
  });

/* ── events ─────────────────────────────────────────────────────────── */

program
  .command("events")
  .argument("<sport>", "sport key (e.g. baseball_mlb)")
  .description("List upcoming events for a sport")
  .action(function (this: Command, sport: string) {
    return cmdEvents(sport, gather(this));
  });

/* ── odds ───────────────────────────────────────────────────────────── */

program
  .command("odds")
  .argument("<sport>", "sport key (e.g. baseball_mlb)")
  .argument("[event_id]", "specific event id (omit for bulk odds)")
  .option(
    "-m, --markets <list>",
    "comma-separated market keys (e.g. h2h,spreads,totals or player_points)",
  )
  .option(
    "-p, --period <codes>",
    "game-period filter: q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7 (comma-separated, or 'all'). Omit for full-game only",
  )
  .description("Get current odds across all books")
  .action(function (this: Command, sport: string, eventId: string | undefined) {
    return cmdOdds(sport, eventId, gather(this));
  });

/* ── scores ─────────────────────────────────────────────────────────── */

program
  .command("scores")
  .argument("<sport>", "sport key")
  .option(
    "-d, --days-from <n>",
    "days back to include (default 3)",
    (v) => parseInt(v, 10),
  )
  .description("Get game scores and status")
  .action(function (this: Command, sport: string) {
    return cmdScores(sport, gather(this));
  });

/* ── context ─────────────────────────────────────────────────────────── */

program
  .command("context")
  .argument("<sport>", "sport key")
  .argument("<event_id>", "event id")
  .description(
    "Game context an event plays under — probable pitchers, lineup, umpire, weather (free)",
  )
  .action(function (this: Command, sport: string, eventId: string) {
    return cmdContext(sport, eventId, gather(this));
  });

/* ── movement ────────────────────────────────────────────────────────── */

program
  .command("movement")
  .argument("<sport>", "sport key")
  .argument("<event_id>", "event id")
  .option("-m, --markets <list>", "comma-separated market keys (default h2h,spreads,totals)")
  .option(
    "-p, --period <codes>",
    "game-period filter: q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7 (comma-separated, or 'all'). Omit for full-game only",
  )
  .description("Line movement + steam detection across books (Hobby+)")
  .action(function (this: Command, sport: string, eventId: string) {
    return cmdMovement(sport, eventId, gather(this));
  });

/* ── grand-salami ────────────────────────────────────────────────────── */

program
  .command("grand-salami")
  .option(
    "--date <YYYY-MM-DD>",
    "UTC date (defaults to today)",
  )
  .description("MLB synthetic Grand Salami — total runs + per-book line")
  .action(function (this: Command) {
    return cmdGrandSalami(gather(this));
  });

/* ── daily-goals-total ───────────────────────────────────────────────── */

program
  .command("daily-goals-total")
  .option(
    "--date <YYYY-MM-DD>",
    "UTC date (defaults to today)",
  )
  .description("NHL synthetic Daily Goals Total — total goals + per-book line")
  .action(function (this: Command) {
    return cmdDailyGoalsTotal(gather(this));
  });

/* ── resolution-summary ──────────────────────────────────────────────── */

program
  .command("resolution-summary")
  .option(
    "-d, --days <n>",
    "look-back window, 1-90 (default 30)",
    (v) => parseInt(v, 10),
  )
  .description("Graded-prop volume + per-sport breakdown (free)")
  .action(function (this: Command) {
    return cmdResolutionSummary(gather(this));
  });

/* ── live ───────────────────────────────────────────────────────────── */

program
  .command("live")
  .description(
    "Show every in-progress game across the major sports (score + period)",
  )
  .action(function (this: Command) {
    return cmdLive(gather(this));
  });

/* ── ev ─────────────────────────────────────────────────────────────── */

program
  .command("ev")
  .argument("<sport>", "sport key")
  .argument("<event_id>", "event id")
  .option("-m, --markets <list>", "comma-separated market keys")
  .option(
    "--plus",
    "show only +EV outcomes (filter rows where ev_pct > 0)",
    false,
  )
  .description("Cross-book +EV against a sharp no-vig fair line (Pro tier)")
  .action(function (this: Command, sport: string, eventId: string) {
    return cmdEv(sport, eventId, gather(this));
  });

/* ── history ────────────────────────────────────────────────────────── */

program
  .command("history")
  .argument("<sport>", "sport key")
  .argument("<event_id>", "event id")
  .option("-m, --markets <list>", "comma-separated market keys (default h2h,spreads,totals)")
  .option("--from <iso>", "ISO timestamp; only include snapshots at or after")
  .option("--to <iso>", "ISO timestamp; only include snapshots at or before")
  .option(
    "--relative-from <offset>",
    "offset relative to commence_time, e.g. -3h, -30m, -90s",
  )
  .option(
    "--relative-to <offset>",
    "offset relative to commence_time, e.g. -1m, 0",
  )
  .option(
    "--interval <bucket>",
    "downsample to one snapshot per bucket: 30s|1m|5m|15m|30m|1h",
  )
  .option("--changes-only", "drop snapshots whose (price, point) match the previous one", false)
  .option(
    "-p, --period <codes>",
    "game-period filter: q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7 (comma-separated, or 'all'). Omit for full-game only",
  )
  .description("Historical line movement for an event with period filters (Hobby+)")
  .action(function (this: Command, sport: string, eventId: string) {
    return cmdHistory(sport, eventId, gather(this) as never);
  });

/* ── closing ────────────────────────────────────────────────────────── */

program
  .command("closing")
  .argument("<sport>", "sport key")
  .argument("<event_id>", "event id")
  .option("-m, --markets <list>", "comma-separated market keys (default h2h,spreads,totals)")
  .option(
    "-p, --period <codes>",
    "game-period filter: q1..q4, h1/h2, p1..p3, i1..i9, f3/f5/f7 (comma-separated, or 'all'). Omit for full-game only",
  )
  .description("Closing line per (book, market, outcome) — CLV helper (Hobby+)")
  .action(function (this: Command, sport: string, eventId: string) {
    return cmdClosing(sport, eventId, gather(this) as never);
  });

/* ── player-history ─────────────────────────────────────────────────── */

program
  .command("player-history")
  .argument("<sport>", "sport key")
  .argument("<player>", 'player name (quote if it contains spaces — e.g. "Aaron Judge")')
  .requiredOption(
    "-m, --market <key>",
    "market key (required — e.g. pitcher_strikeouts)",
  )
  .option("-b, --bookmaker <key>", "filter to a single book (e.g. draftkings)")
  .option("-l, --limit <n>", "max entries (1-100, default 20)", (v) =>
    parseInt(v, 10),
  )
  .description("Recent prop history for a player on a market (Pro full, Free redacted)")
  .action(function (this: Command, sport: string, player: string) {
    return cmdPlayerHistory(sport, player, gather(this) as never);
  });

/* ── player-trends ──────────────────────────────────────────────────── */

program
  .command("player-trends")
  .argument("<sport>", "sport key")
  .argument("<player>", 'player name (quote if it contains spaces — e.g. "Aaron Judge")')
  .option(
    "-m, --market <key>",
    "filter to a single market key (e.g. batter_total_bases)",
  )
  .description(
    "Aggregated hit-rate trends per market — L5/L10/L20/L50 over/under splits + current streak (Pro full, Free redacted)",
  )
  .action(function (this: Command, sport: string, player: string) {
    return cmdPlayerTrends(sport, player, gather(this) as never);
  });

/* ── export-resolved-props ──────────────────────────────────────────── */

program
  .command("export-resolved-props")
  .requiredOption("--sport <key>", "sport key (required)")
  .option("--market <key>", "filter by market key")
  .option("--bookmaker <key>", "filter by bookmaker key")
  .option("--since <iso>", "ISO datetime lower bound on resolved_at")
  .option("--until <iso>", "ISO datetime upper bound on resolved_at")
  .option(
    "--out <path>",
    "write CSV to this path (default: stream CSV to stdout)",
  )
  .description("Bulk CSV export of resolved props (Pro tier)")
  .action(function (this: Command) {
    return cmdExportResolvedProps(gather(this) as never);
  });

/* ── export-odds-history ────────────────────────────────────────────── */

program
  .command("export-odds-history")
  .requiredOption("--sport <key>", "sport key (required)")
  .option("--market <key>", "filter by market key")
  .option("--bookmaker <key>", "filter by bookmaker key")
  .option("--since <iso>", "ISO datetime lower bound on recorded_at")
  .option("--until <iso>", "ISO datetime upper bound on recorded_at")
  .option(
    "--out <path>",
    "write CSV to this path (default: stream CSV to stdout)",
  )
  .description(
    "Bulk CSV export of the full line-movement tick history (Backfill pass / Enterprise). Large — page month-by-month with --since/--until.",
  )
  .action(function (this: Command) {
    return cmdExportOddsHistory(gather(this) as never);
  });

/* ── webhooks ───────────────────────────────────────────────────────── */

const webhooks = program.command("webhooks").description("Manage webhook subscriptions (Streaming tier)");

webhooks
  .command("list")
  .description("List your webhook subscriptions")
  .action(function (this: Command) {
    return cmdWebhooksList(gather(this));
  });

webhooks
  .command("create")
  .requiredOption("--url <url>", "HTTPS endpoint that will receive POSTs")
  .option(
    "--events <list>",
    "comma-separated event types: line_movement,resolution,steam (default: all)",
  )
  .option("--sport <key>", "filter to a single sport")
  .option("--market <key>", "filter to a single market key")
  .option("--player <name>", "filter to a player name (case-insensitive substring)")
  .option(
    "--event-id <id>",
    "filter to one event id (numeric)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--min-price-change-pct <n>",
    "minimum % change in American odds to fire a line_movement",
    (v) => parseFloat(v),
  )
  .option(
    "--min-steam-score <n>",
    "minimum 0-100 steam score to fire a steam event",
    (v) => parseFloat(v),
  )
  .description("Register a webhook subscription (returns the signing secret ONCE)")
  .action(function (this: Command) {
    return cmdWebhooksCreate(gather(this) as never);
  });

webhooks
  .command("delete")
  .argument("<id>", "webhook id")
  .description("Delete a webhook (cascades its delivery history)")
  .action(function (this: Command, id: string) {
    return cmdWebhooksDelete(id, gather(this));
  });

webhooks
  .command("test")
  .argument("<id>", "webhook id")
  .description("Queue a sample test payload to the webhook URL")
  .action(function (this: Command, id: string) {
    return cmdWebhooksTest(id, gather(this));
  });

webhooks
  .command("deliveries")
  .argument("<id>", "webhook id")
  .option("-l, --limit <n>", "max deliveries (default 50)", (v) =>
    parseInt(v, 10),
  )
  .description("Show recent delivery attempts for a webhook")
  .action(function (this: Command, id: string) {
    return cmdWebhooksDeliveries(id, gather(this) as never);
  });

program.parseAsync().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
