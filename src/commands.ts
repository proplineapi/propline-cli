// Per-command handlers. Each one builds a PropLine client, calls the
// SDK, and pretty-prints the result via format.ts (or dumps raw JSON
// when --json is passed). Commands stay independent — no shared
// per-call state — so future ones can be added without touching the
// existing surface.

import { readFile } from "node:fs/promises";
import type { PropLine, PlayerMarketTrend, HitRateSplit } from "propline";
import { buildClient, runCommand, type ClientFlags } from "./client.js";
import {
  printJson,
  printTable,
  formatPrice,
  formatPoint,
  formatTime,
  truncate,
  type Column,
} from "./format.js";

interface CommonFlags extends ClientFlags {
  json?: boolean;
}

/* ── sports ─────────────────────────────────────────────────────────── */

export function cmdSports(flags: CommonFlags): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const sports = await client.getSports();
    if (flags.json) return printJson(sports);
    const cols: Column<(typeof sports)[number]>[] = [
      { label: "KEY", value: (r) => r.key },
      { label: "TITLE", value: (r) => r.title },
      { label: "ACTIVE", value: (r) => (r.active ? "yes" : "no") },
    ];
    printTable(sports, cols);
  });
}

/* ── events ─────────────────────────────────────────────────────────── */

export function cmdEvents(sport: string, flags: CommonFlags): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const events = await client.getEvents(sport);
    if (flags.json) return printJson(events);
    const cols: Column<(typeof events)[number]>[] = [
      { label: "ID", value: (r) => String(r.id) },
      { label: "AWAY", value: (r) => r.away_team },
      { label: "HOME", value: (r) => r.home_team },
      { label: "COMMENCES", value: (r) => formatTime(r.commence_time) },
    ];
    printTable(events, cols);
  });
}

/* ── odds (bulk and single-event) ───────────────────────────────────── */

export function cmdOdds(
  sport: string,
  eventId: string | undefined,
  flags: CommonFlags & {
    markets?: string;
    bookmakers?: string;
    period?: string;
    links?: boolean;
    bookIds?: boolean;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const markets = parseMarketsFlag(flags.markets);
    const period = flags.period;
    const bookmakers = flags.bookmakers;
    const includeLinks = flags.links;
    const includeBookIds = flags.bookIds;

    if (eventId) {
      const resp = await client.getOdds(sport, {
        eventId,
        markets,
        period,
        bookmakers,
        includeLinks,
        includeBookIds,
      });
      if (flags.json) return printJson(resp);
      printOddsResponse(resp);
      printEventLinks(resp.bookmakers);
      return;
    }

    const resp = await client.getOdds(sport, {
      markets,
      period,
      bookmakers,
      includeLinks,
      includeBookIds,
    });
    if (flags.json) return printJson(resp);
    // Bulk: one row per (event, book, market, outcome) gets dense fast.
    // Collapse to a per-event summary row showing how many books / markets
    // each event has, so the user sees the slate at a glance.
    type Row = {
      id: string;
      teams: string;
      commence: string;
      books: number;
      markets: number;
    };
    const rows: Row[] = resp.map((ev) => {
      const books = ev.bookmakers ?? [];
      const markets = books.reduce((sum, b) => sum + (b.markets?.length ?? 0), 0);
      return {
        id: String(ev.id),
        teams: `${ev.away_team} @ ${ev.home_team}`,
        commence: formatTime(ev.commence_time),
        books: books.length,
        markets,
      };
    });
    const cols: Column<Row>[] = [
      { label: "ID", value: (r) => r.id },
      { label: "MATCHUP", value: (r) => r.teams },
      { label: "COMMENCES", value: (r) => r.commence },
      { label: "BOOKS", value: (r) => String(r.books), numeric: true },
      { label: "MARKETS", value: (r) => String(r.markets), numeric: true },
    ];
    printTable(rows, cols);
  });
}

interface OddsResponseLike {
  id: number | string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
    key: string;
    title: string;
    /**
     * True when the event is LIVE and this book does not price it in
     * play — its prices are the last pregame quote and will not move
     * again this game.
     */
    pregame_only?: boolean;
    markets?: Array<{
      key: string;
      /** Canonical team name on a team total; null on a game market. */
      team?: string | null;
      outcomes?: Array<{
        name: string;
        description?: string | null;
        price: number;
        point?: number | null;
        payout_multiplier?: number | null;
      }>;
    }>;
  }>;
}

function printEventLinks(
  bookmakers: Array<{
    key: string;
    title: string;
    link?: string | null;
    app_link?: string | null;
  }>,
): void {
  const linked = bookmakers.filter((b) => b.link || b.app_link);
  if (!linked.length) return;
  process.stdout.write("\nEvent pages:\n");
  for (const b of linked) {
    if (b.link) process.stdout.write(`  ${b.title}: ${b.link}\n`);
    // Mobile app-open deep link (ProphetX only today) — shown when present.
    if (b.app_link) process.stdout.write(`  ${b.title} (app): ${b.app_link}\n`);
  }
}

function printOddsResponse(resp: OddsResponseLike): void {
  // Per-event detail view: one row per (book, market, outcome). Same
  // shape as `propline odds <sport> <event> --json` but flattened so the
  // table reads top-to-bottom by book → market → outcome.
  type Row = {
    book: string;
    market: string;
    player: string;
    side: string;
    point: string;
    price: string;
    mult: string;
  };
  const rows: Row[] = [];
  let anyMult = false;
  let anyFrozen = false;
  for (const book of resp.bookmakers ?? []) {
    // The event is live and this book does not price it in play: its
    // prices are the last PREGAME quote and will not move again this
    // game. Marked rather than hidden — on the DFS books that frozen
    // line is the number the bet settles against — but showing it
    // unmarked next to books quoting seconds ago is the misleading part.
    const frozen = book.pregame_only === true;
    if (frozen) anyFrozen = true;
    for (const market of book.markets ?? []) {
      for (const o of market.outcomes ?? []) {
        const m = o.payout_multiplier;
        if (m !== null && m !== undefined) anyMult = true;
        rows.push({
          book: frozen ? `${book.title} *` : book.title,
          // A team total and the game total both ride the `totals` key and
          // differ only by point, which reads as one market mispriced.
          // `team` is the API's own answer for which side it is scoped to
          // (null on a game market), so surface it in the label.
          market: market.team
            ? `${market.key} (${market.team})`
            : market.key,
          player: o.description ?? "",
          side: o.name,
          point: formatPoint(o.point ?? null),
          price: formatPrice(o.price),
          mult: m !== null && m !== undefined ? `${m}x` : "",
        });
      }
    }
  }
  if (rows.length === 0) {
    process.stdout.write(
      `(no markets returned — try --markets h2h,spreads,totals or the desired prop key)\n`,
    );
    return;
  }
  const header = `${resp.away_team} @ ${resp.home_team} (event ${resp.id})\n`;
  process.stdout.write(header);
  const cols: Column<Row>[] = [
    { label: "BOOK", value: (r) => r.book },
    { label: "MARKET", value: (r) => r.market },
    { label: "PLAYER", value: (r) => truncate(r.player, 28) },
    { label: "SIDE", value: (r) => r.side },
    { label: "LINE", value: (r) => r.point, numeric: true },
    { label: "PRICE", value: (r) => r.price, numeric: true },
  ];
  // DFS boost/discount column — only shown when a book (Underdog) actually
  // returns a multiplier, so standard sportsbook output stays unchanged.
  if (anyMult) {
    cols.push({ label: "MULT", value: (r) => r.mult, numeric: true });
  }
  printTable(rows, cols);
  if (anyFrozen) {
    process.stdout.write(
      `\n* pregame price — this game is live and these books do not price it\n` +
        `  in play, so these lines are frozen and will not move again.\n`,
    );
  }
}

/* ── scores ─────────────────────────────────────────────────────────── */

export function cmdScores(
  sport: string,
  flags: CommonFlags & { daysFrom?: number },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const scores = await client.getScores(sport, { daysFrom: flags.daysFrom });
    if (flags.json) return printJson(scores);
    const cols: Column<(typeof scores)[number]>[] = [
      { label: "ID", value: (r) => String(r.id) },
      { label: "STATUS", value: (r) => String(r.status) },
      { label: "AWAY", value: (r) => r.away_team },
      {
        label: "AS",
        value: (r) => (r.away_score === null ? "" : String(r.away_score)),
        numeric: true,
      },
      { label: "HOME", value: (r) => r.home_team },
      {
        label: "HS",
        value: (r) => (r.home_score === null ? "" : String(r.home_score)),
        numeric: true,
      },
      { label: "COMMENCED", value: (r) => formatTime(r.commence_time) },
    ];
    printTable(scores, cols);
  });
}

/* ── futures ────────────────────────────────────────────────────────── */

export function cmdFutures(sport: string, flags: CommonFlags): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const futures = await client.getFutures(sport);
    if (flags.json) return printJson(futures);

    // One row per (futures market, book). The favorite is the
    // shortest-priced outcome (lowest American number = most favored).
    interface Row {
      title: string;
      market: string;
      book: string;
      outcomes: number;
      favorite: string;
    }
    const rows: Row[] = [];
    for (const ev of futures) {
      for (const m of ev.markets) {
        const priced = m.outcomes.filter((o) => o.price !== null);
        const fav = priced.reduce<(typeof priced)[number] | null>(
          (best, o) =>
            best === null || (o.price as number) < (best.price as number)
              ? o
              : best,
          null,
        );
        rows.push({
          title: ev.title,
          market: m.description,
          book: m.bookmaker_title || m.bookmaker,
          outcomes: m.outcomes.length,
          favorite: fav ? `${fav.name} ${formatPrice(fav.price)}` : "—",
        });
      }
    }
    const cols: Column<Row>[] = [
      { label: "FUTURE", value: (r) => truncate(r.title, 32) },
      { label: "MARKET", value: (r) => truncate(r.market, 30) },
      { label: "BOOK", value: (r) => r.book },
      { label: "N", value: (r) => String(r.outcomes), numeric: true },
      { label: "FAVORITE", value: (r) => r.favorite },
    ];
    printTable(rows, cols);
  });
}

/* ── context ─────────────────────────────────────────────────────────── */

/** "Paul Skenes (R)" — append the throwing hand when present. `hand` is typed
 *  loosely so this works whether or not the installed SDK models the field. */
function fmtPitcher(name: string | null, hand: unknown): string {
  if (!name) return "—";
  return typeof hand === "string" && hand ? `${name} (${hand})` : name;
}

export function cmdContext(
  sport: string,
  eventId: string,
  flags: CommonFlags,
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const ctx = await client.getContext(sport, eventId);
    if (flags.json) return printJson(ctx);

    const roof = ctx.roof_type ? ` (${ctx.roof_type})` : "";
    process.stdout.write(
      `${ctx.away_team} @ ${ctx.home_team}\n` +
        `${ctx.venue ?? "venue TBD"}${roof} · ${formatTime(ctx.commence_time)}\n\n` +
        `Probable pitchers : ${fmtPitcher(ctx.away_probable_pitcher, ctx.away_probable_pitcher_hand)} (away) vs ` +
        `${fmtPitcher(ctx.home_probable_pitcher, ctx.home_probable_pitcher_hand)} (home)\n` +
        `Lineup confirmed  : ${ctx.lineup_confirmed ? "yes" : "no"}\n` +
        `Home-plate umpire : ${ctx.home_plate_umpire ?? "—"}\n`,
    );
    const w = ctx.weather;
    if (ctx.is_indoor) {
      process.stdout.write(`Weather           : indoor / climate-controlled\n`);
    } else if (w) {
      const parts = [
        w.temperature_f === null ? null : `${w.temperature_f}°F`,
        w.wind_speed_mph === null
          ? null
          : `wind ${w.wind_speed_mph}mph ${w.wind_direction ?? ""}`.trim(),
        w.precip_probability_pct === null
          ? null
          : `precip ${w.precip_probability_pct}%`,
        w.conditions ?? null,
      ].filter(Boolean);
      process.stdout.write(`Weather           : ${parts.join(" · ")}\n`);
    } else {
      process.stdout.write(`Weather           : —\n`);
    }
  });
}

/* ── movement ────────────────────────────────────────────────────────── */

export function cmdMovement(
  sport: string,
  eventId: string,
  flags: CommonFlags & { markets?: string; bookmakers?: string; period?: string },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const mv = await client.getMovement(sport, eventId, {
      markets: flags.markets ? flags.markets.split(",") : undefined,
      bookmakers: flags.bookmakers,
      period: flags.period,
    });
    if (flags.json) return printJson(mv);

    process.stdout.write(
      `${mv.away_team} @ ${mv.home_team} — line movement & steam\n` +
        `${mv.bookmakers.length} books\n\n`,
    );
    if (!mv.steam.length) {
      process.stdout.write("No steam moves detected.\n");
      return;
    }
    const cols: Column<(typeof mv.steam)[number]>[] = [
      { label: "MARKET", value: (r) => r.market },
      {
        label: "OUTCOME",
        value: (r) => (r.description ? `${r.name} (${r.description})` : r.name),
      },
      { label: "DIR", value: (r) => r.consensus_direction },
      {
        label: "BOOKS",
        value: (r) => `${r.books_moved}/${r.books_quoting}`,
        numeric: true,
      },
      { label: "SCORE", value: (r) => r.steam_score.toFixed(1), numeric: true },
      {
        label: "PROBΔ",
        value: (r) => `${(r.avg_prob_shift * 100).toFixed(1)}%`,
        numeric: true,
      },
    ];
    printTable(mv.steam, cols);
  });
}

/* ── grand-salami ────────────────────────────────────────────────────── */

export function cmdGrandSalami(
  flags: CommonFlags & { date?: string },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const gs = await client.getMlbGrandSalami({ date: flags.date });
    if (flags.json) return printJson(gs);
    process.stdout.write(
      `MLB Grand Salami — ${gs.date} (UTC)\n` +
        `${gs.games_total} games · ${gs.games_completed} final · ` +
        `${gs.games_in_progress} live · ${gs.games_upcoming} upcoming\n` +
        (gs.actual_total_runs === null
          ? `Actual total: pending\n\n`
          : `Actual total: ${gs.actual_total_runs} runs\n\n`),
    );
    const cols: Column<(typeof gs.bookmakers)[number]>[] = [
      { label: "BOOK", value: (r) => r.title },
      { label: "GAMES", value: (r) => String(r.games_priced), numeric: true },
      { label: "LINE", value: (r) => r.line.toFixed(1), numeric: true },
      { label: "RESULT", value: (r) => r.result ?? "" },
    ];
    printTable(gs.bookmakers, cols);
  });
}

/* ── daily-goals-total ───────────────────────────────────────────────── */

export function cmdDailyGoalsTotal(
  flags: CommonFlags & { date?: string },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const dgt = await client.getNhlDailyGoalsTotal({ date: flags.date });
    if (flags.json) return printJson(dgt);
    process.stdout.write(
      `NHL Daily Goals Total — ${dgt.date} (UTC)\n` +
        `${dgt.games_total} games · ${dgt.games_completed} final · ` +
        `${dgt.games_in_progress} live · ${dgt.games_upcoming} upcoming\n` +
        (dgt.actual_total_goals === null
          ? `Actual total: pending\n\n`
          : `Actual total: ${dgt.actual_total_goals} goals\n\n`),
    );
    const cols: Column<(typeof dgt.bookmakers)[number]>[] = [
      { label: "BOOK", value: (r) => r.title },
      { label: "GAMES", value: (r) => String(r.games_priced), numeric: true },
      { label: "LINE", value: (r) => r.line.toFixed(1), numeric: true },
      { label: "RESULT", value: (r) => r.result ?? "" },
    ];
    printTable(dgt.bookmakers, cols);
  });
}

/* ── resolution-summary ──────────────────────────────────────────────── */

export function cmdResolutionSummary(
  flags: CommonFlags & { days?: number },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const s = await client.getResolutionSummary(flags.days ?? 30);
    if (flags.json) return printJson(s);
    process.stdout.write(
      `${s.total_graded.toLocaleString()} props graded ` +
        `(${s.total_settled.toLocaleString()} settled) across ` +
        `${s.sports_covered} sports / ${s.events_graded.toLocaleString()} ` +
        `games — last ${s.days}d\n\n`,
    );
    const cols: Column<(typeof s.by_sport)[number]>[] = [
      { label: "SPORT", value: (r) => r.title },
      { label: "KEY", value: (r) => r.sport_key },
      { label: "GRADED", value: (r) => r.graded.toLocaleString(), numeric: true },
      { label: "GAMES", value: (r) => String(r.events), numeric: true },
    ];
    printTable(s.by_sport, cols);
  });
}

/* ── dfs-payouts ─────────────────────────────────────────────────────── */

export function cmdDfsPayouts(
  flags: CommonFlags & { legWinProb?: number },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const t = await client.getDfsPayouts({ legWinProb: flags.legWinProb });
    if (flags.json) return printJson(t);
    const withEv = flags.legWinProb !== undefined;
    process.stdout.write(
      `PrizePicks payout schedule + per-leg breakeven` +
        (withEv ? ` @ ${(flags.legWinProb! * 100).toFixed(0)}% per leg` : "") +
        `\n\n`,
    );
    const cols: Column<(typeof t.plays)[number]>[] = [
      { label: "PLAY", value: (r) => r.play_type },
      { label: "LEGS", value: (r) => String(r.legs), numeric: true },
      {
        label: "ALL-HIT",
        value: (r) => `${r.all_correct_multiplier.toFixed(2)}x`,
        numeric: true,
      },
      {
        label: "BREAKEVEN",
        value: (r) => `${(r.breakeven_leg_win_prob * 100).toFixed(1)}%`,
        numeric: true,
      },
    ];
    if (withEv) {
      cols.push(
        {
          label: "EV/$1",
          value: (r) => (r.expected_return ?? 0).toFixed(3),
          numeric: true,
        },
        { label: "+EV?", value: (r) => (r.is_plus_ev ? "yes" : "no") },
      );
    }
    printTable(t.plays, cols);
    process.stdout.write(`\n${t.disclaimer}\n`);
  });
}

/* ── live (cross-sport in-progress games) ────────────────────────────── */

const LIVE_SPORTS = [
  "baseball_mlb",
  "basketball_nba",
  "hockey_nhl",
  "basketball_ncaab",
  "football_nfl",
  "football_ncaaf",
  "soccer_epl",
  "soccer_la_liga",
  "soccer_serie_a",
  "soccer_bundesliga",
  "soccer_ligue_1",
  "soccer_mls",
  "tennis",
  "golf",
  "mma_ufc",
];

export function cmdLive(flags: CommonFlags): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    // Hit /scores per sport in parallel and keep only `in_progress` rows.
    // Tolerates per-sport failure so one 404 doesn't abort the whole
    // command — the CLI is meant for casual terminal use, not strict
    // pipelines.
    type LiveRow = {
      sport: string;
      id: string;
      teams: string;
      score: string;
      period: string;
    };
    const settled = await Promise.allSettled(
      LIVE_SPORTS.map(async (sportKey): Promise<LiveRow[]> => {
        const scores = await client.getScores(sportKey, { daysFrom: 1 });
        return scores
          .filter((sc) => sc.status === "in_progress")
          .map((sc) => ({
            sport: sportKey,
            id: String(sc.id),
            teams: `${sc.away_team} @ ${sc.home_team}`,
            score:
              sc.home_score !== null && sc.away_score !== null
                ? `${sc.away_score}-${sc.home_score}`
                : "",
            period: typeof sc.period === "string" ? sc.period : "",
          }));
      }),
    );
    const rows: LiveRow[] = [];
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      rows.push(...r.value);
    }
    if (flags.json) return printJson(rows);
    if (rows.length === 0) {
      process.stdout.write("(no games in progress right now)\n");
      return;
    }
    const cols: Column<LiveRow>[] = [
      { label: "SPORT", value: (r) => r.sport },
      { label: "ID", value: (r) => r.id },
      { label: "MATCHUP", value: (r) => r.teams },
      { label: "SCORE", value: (r) => r.score },
      { label: "PERIOD", value: (r) => r.period },
    ];
    printTable(rows, cols);
  });
}

/* ── ev (cross-book +EV) ────────────────────────────────────────────── */

export function cmdEv(
  sport: string,
  eventId: string,
  flags: CommonFlags & { markets?: string; bookmakers?: string; plus?: boolean },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const resp = await client.getEventEv(sport, eventId, {
      markets: parseMarketsFlag(flags.markets),
      // Narrows the prices, never the anchor: --bookmakers draftkings
      // still measures DK against Pinnacle.
      bookmakers: flags.bookmakers,
    });
    if (flags.json) return printJson(resp);
    type Row = {
      market: string;
      player: string;
      point: string;
      side: string;
      book: string;
      price: string;
      ev: string;
      plus: boolean;
    };
    const rows: Row[] = [];
    for (const line of resp.lines) {
      for (const o of line.outcomes) {
        rows.push({
          market: line.market_key,
          player: line.description,
          point: formatPoint(line.point),
          side: o.name,
          book: o.book_title,
          price: formatPrice(o.price),
          ev: `${o.ev_pct >= 0 ? "+" : ""}${o.ev_pct.toFixed(2)}%`,
          plus: o.is_plus_ev,
        });
      }
    }
    const filtered = flags.plus ? rows.filter((r) => r.plus) : rows;
    // Sort +EV first regardless of filter — the most-actionable rows
    // should land at the top of the terminal, not the bottom.
    filtered.sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
    process.stdout.write(
      `${resp.away_team} @ ${resp.home_team} · fair anchor: ${resp.fair_source_default}\n`,
    );
    const cols: Column<Row>[] = [
      { label: "MARKET", value: (r) => r.market },
      { label: "PLAYER", value: (r) => truncate(r.player, 24) },
      { label: "LINE", value: (r) => r.point, numeric: true },
      { label: "SIDE", value: (r) => r.side },
      { label: "BOOK", value: (r) => r.book },
      { label: "PRICE", value: (r) => r.price, numeric: true },
      { label: "EV%", value: (r) => r.ev, numeric: true },
    ];
    printTable(filtered, cols);
  });
}

/* ── projections ────────────────────────────────────────────────────── */

export function cmdProjections(
  sport: string,
  eventId: string,
  flags: CommonFlags & { markets?: string },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const resp = await client.getEventProjections(sport, eventId, {
      markets: parseMarketsFlag(flags.markets),
    });
    if (flags.json) return printJson(resp);
    type Row = {
      market: string;
      player: string;
      value: string;
      prob: string;
      books: string;
    };
    const rows: Row[] = resp.projections.map((r) => ({
      market: r.market_key,
      player: r.player,
      value: r.projected_value == null ? "—" : String(r.projected_value),
      prob:
        r.consensus_over_prob == null
          ? "—"
          : `${(r.consensus_over_prob * 100).toFixed(1)}%`,
      books: String(r.books_contributing),
    }));
    process.stdout.write(
      `${resp.away_team} @ ${resp.home_team} · market-implied (not a forecast)\n`,
    );
    const cols: Column<Row>[] = [
      { label: "MARKET", value: (r) => r.market },
      { label: "PLAYER", value: (r) => truncate(r.player, 24) },
      { label: "PROJECTED", value: (r) => r.value, numeric: true },
      { label: "P(OVER)", value: (r) => r.prob, numeric: true },
      { label: "BOOKS", value: (r) => r.books, numeric: true },
    ];
    printTable(rows, cols);
  });
}

/* ── best-line ──────────────────────────────────────────────────────── */

export function cmdBestLine(
  sport: string,
  eventId: string,
  flags: CommonFlags & { markets?: string; bookmakers?: string; links?: boolean },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const resp = await client.getEventBestLine(sport, eventId, {
      markets: parseMarketsFlag(flags.markets),
      bookmakers: flags.bookmakers,
      includeLinks: flags.links,
    });
    if (flags.json) return printJson(resp);
    type Row = {
      market: string;
      player: string;
      point: string;
      side: string;
      book: string;
      price: string;
      books: string;
    };
    const rows: Row[] = [];
    for (const line of resp.lines) {
      for (const [side, info] of Object.entries(line.sides)) {
        rows.push({
          market: line.market_key,
          player: line.description,
          point: formatPoint(line.point),
          side,
          book: info.best.book_title,
          price: formatPrice(info.best.price),
          books: String(info.all_prices.length),
        });
      }
    }
    process.stdout.write(
      `${resp.away_team} @ ${resp.home_team} · books considered: ${resp.books_considered.join(", ")}\n`,
    );
    const cols: Column<Row>[] = [
      { label: "MARKET", value: (r) => r.market },
      { label: "PLAYER", value: (r) => truncate(r.player, 24) },
      { label: "LINE", value: (r) => r.point, numeric: true },
      { label: "SIDE", value: (r) => r.side },
      { label: "BEST BOOK", value: (r) => r.book },
      { label: "PRICE", value: (r) => r.price, numeric: true },
      { label: "N BOOKS", value: (r) => r.books, numeric: true },
    ];
    printTable(rows, cols);
    if (flags.links) {
      const links = new Map<string, string>();
      const appLinks = new Map<string, string>();
      for (const line of resp.lines) {
        for (const info of Object.values(line.sides)) {
          for (const price of info.all_prices) {
            const p = price as {
              link?: string | null;
              app_link?: string | null;
            };
            if (p.link) links.set(price.book_title, p.link);
            // Mobile app-open deep link (ProphetX only today).
            if (p.app_link) appLinks.set(price.book_title, p.app_link);
          }
        }
      }
      if (links.size || appLinks.size) {
        process.stdout.write("\nEvent pages:\n");
        for (const [title, link] of links) {
          process.stdout.write(`  ${title}: ${link}\n`);
        }
        for (const [title, link] of appLinks) {
          process.stdout.write(`  ${title} (app): ${link}\n`);
        }
      }
    }
  });
}

/* ── player-history ─────────────────────────────────────────────────── */

export function cmdPlayerHistory(
  sport: string,
  player: string,
  flags: CommonFlags & {
    market: string;
    bookmaker?: string;
    limit?: number;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const resp = await client.getPlayerHistory(sport, player, {
      market: flags.market,
      bookmaker: flags.bookmaker,
      limit: flags.limit,
    });
    if (flags.json) return printJson(resp);
    process.stdout.write(
      `${resp.player_name} · ${resp.market} (${resp.entries.length} entries)\n`,
    );
    type Entry = (typeof resp.entries)[number];
    const cols: Column<Entry>[] = [
      { label: "DATE", value: (r) => formatTime(r.commence_time).slice(0, 10) },
      { label: "MATCHUP", value: (r) => `${r.away_team} @ ${r.home_team}` },
      { label: "BOOK", value: (r) => r.bookmaker_title },
      {
        label: "LINE",
        value: (r) => formatPoint(r.line),
        numeric: true,
      },
      { label: "OVER", value: (r) => formatPrice(r.over_price), numeric: true },
      {
        label: "UNDER",
        value: (r) => formatPrice(r.under_price),
        numeric: true,
      },
      {
        label: "ACTUAL",
        value: (r) => (r.actual_value === null ? "" : String(r.actual_value)),
        numeric: true,
      },
      {
        label: "RESULT",
        value: (r) => {
          if (r.over_result === "won") return "OVER ✓";
          if (r.under_result === "won") return "UNDER ✓";
          if (r.over_result === "push" || r.under_result === "push") return "PUSH";
          if (r.over_result === "void" || r.under_result === "void") return "VOID";
          return "";
        },
      },
    ];
    printTable(resp.entries, cols);
  });
}

/* ── player-games ───────────────────────────────────────────────────── */

export function cmdPlayerGames(
  sport: string,
  player: string,
  flags: CommonFlags & {
    limit?: number;
    opponent?: string;
    statType?: string;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const resp = await client.getPlayerGames(sport, player, {
      limit: flags.limit,
      opponent: flags.opponent,
      statType: flags.statType,
    });
    if (flags.json) return printJson(resp);

    const scope = resp.opponent ? ` vs ${resp.opponent}` : "";
    process.stdout.write(
      `${resp.player_name}${scope} (${resp.games.length} games)\n`,
    );
    if (resp.games.length === 0) return;

    // Columns are data-driven: the stat vocabulary differs per sport, and
    // within a sport a game can carry a stat an earlier one didn't (a pitcher
    // in one row, a batter in the next), so take the union across games and
    // keep first-seen order rather than hardcoding a per-sport list.
    const statNames: string[] = [];
    for (const g of resp.games) {
      for (const name of Object.keys(g.stats)) {
        if (!statNames.includes(name)) statNames.push(name);
      }
    }

    type Game = (typeof resp.games)[number];
    const cols: Column<Game>[] = [
      { label: "DATE", value: (g) => formatTime(g.commence_time).slice(0, 10) },
      {
        label: "OPP",
        value: (g) =>
          g.opponent === null
            ? `${g.away_team} @ ${g.home_team}`
            : `${g.is_home ? "vs" : "@"} ${g.opponent}`,
      },
      ...statNames.map((name) => ({
        label: name.toUpperCase(),
        value: (g: Game) => {
          const v = g.stats[name];
          // A stat absent for this game is blank, never 0 — the player may
          // simply not have been measured on it (a batter has no pitching
          // line), and printing 0 would read as a real result.
          return v === undefined ? "" : String(v);
        },
        numeric: true,
      })),
    ];
    printTable(resp.games, cols);
  });
}

/* ── player-trends ──────────────────────────────────────────────────── */

function formatOverPct(w: HitRateSplit | null): string {
  if (!w || w.over_pct === null || w.over_pct === undefined) return "";
  return `${w.over_pct.toFixed(0)}%`;
}

export function cmdPlayerTrends(
  sport: string,
  player: string,
  flags: CommonFlags & {
    market?: string;
    dfsOddsType?: "standard" | "goblin" | "demon";
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const resp = await client.getPlayerTrends(sport, player, {
      market: flags.market,
      dfsOddsType: flags.dfsOddsType,
    });
    if (flags.json) return printJson(resp);
    process.stdout.write(
      `${resp.player_name} · ${resp.sport_key} (${resp.markets.length} markets)\n`,
    );
    const cols: Column<PlayerMarketTrend>[] = [
      { label: "MARKET", value: (r) => r.market },
      {
        label: "GAMES",
        value: (r) => String(r.games_graded),
        numeric: true,
      },
      { label: "LINE", value: (r) => formatPoint(r.recent_line), numeric: true },
      {
        label: "AVG",
        value: (r) =>
          r.avg_actual === null || r.avg_actual === undefined
            ? ""
            : r.avg_actual.toFixed(2),
        numeric: true,
      },
      { label: "L5 O%", value: (r) => formatOverPct(r.last_5), numeric: true },
      { label: "L10 O%", value: (r) => formatOverPct(r.last_10), numeric: true },
      { label: "L20 O%", value: (r) => formatOverPct(r.last_20), numeric: true },
      {
        label: "STREAK",
        value: (r) => {
          const s = r.current_streak;
          if (!s) return "";
          return `${s.length}× ${s.result}`;
        },
      },
    ];
    printTable(resp.markets, cols);
  });
}

/* ── export-resolved-props ──────────────────────────────────────────── */

export function cmdExportResolvedProps(
  flags: CommonFlags & {
    sport: string;
    market?: string;
    bookmaker?: string;
    since?: string;
    until?: string;
    out?: string;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    if (flags.out) {
      const path = await client.exportResolvedProps({
        sport: flags.sport,
        market: flags.market,
        bookmaker: flags.bookmaker,
        since: flags.since,
        until: flags.until,
        outPath: flags.out,
      });
      process.stdout.write(`exported → ${path}\n`);
      return;
    }
    // No --out: stream raw CSV bytes straight to stdout so a user can
    // pipe `propline export-resolved-props --sport mlb | head` to
    // sample. --json is meaningless here since the API only emits CSV;
    // we ignore it for this command.
    const buf = await client.exportResolvedProps({
      sport: flags.sport,
      market: flags.market,
      bookmaker: flags.bookmaker,
      since: flags.since,
      until: flags.until,
    });
    process.stdout.write(buf);
  });
}

/* ── export-odds-history ────────────────────────────────────────────── */

export function cmdExportOddsHistory(
  flags: CommonFlags & {
    sport: string;
    market?: string;
    bookmaker?: string;
    since?: string;
    until?: string;
    out?: string;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    if (flags.out) {
      const path = await client.exportOddsHistory({
        sport: flags.sport,
        market: flags.market,
        bookmaker: flags.bookmaker,
        since: flags.since,
        until: flags.until,
        outPath: flags.out,
      });
      process.stdout.write(`exported → ${path}\n`);
      return;
    }
    // No --out: stream raw CSV bytes to stdout. The API only emits CSV,
    // so --json is meaningless here and ignored. This dataset is large —
    // pass --since/--until to page month-by-month.
    const buf = await client.exportOddsHistory({
      sport: flags.sport,
      market: flags.market,
      bookmaker: flags.bookmaker,
      since: flags.since,
      until: flags.until,
    });
    process.stdout.write(buf);
  });
}

/* ── webhooks ───────────────────────────────────────────────────────── */

export function cmdWebhooksList(flags: CommonFlags): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const hooks = await client.listWebhooks();
    if (flags.json) return printJson(hooks);
    type H = (typeof hooks)[number];
    const cols: Column<H>[] = [
      { label: "ID", value: (r) => String(r.id), numeric: true },
      { label: "URL", value: (r) => truncate(r.url, 50) },
      { label: "EVENTS", value: (r) => (r.events ?? []).join(",") },
      { label: "ACTIVE", value: (r) => (r.active ? "yes" : "no") },
      { label: "SPORT", value: (r) => r.filter_sport_key ?? "" },
      { label: "MARKET", value: (r) => r.filter_market_key ?? "" },
      { label: "CREATED", value: (r) => formatTime(r.created_at) },
    ];
    printTable(hooks, cols);
  });
}

export function cmdWebhooksCreate(
  flags: CommonFlags & {
    url: string;
    events?: string;
    sport?: string;
    market?: string;
    player?: string;
    bookmakers?: string;
    eventId?: number;
    minPriceChangePct?: number;
    minSteamScore?: number;
    minBooksAgreeing?: number;
    batchMax?: number;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const events = flags.events
      ? (flags.events.split(",").map((s) => s.trim()) as Array<
          "line_movement" | "resolution" | "steam" | "market_suspended"
        >)
      : undefined;
    const hook = await client.createWebhook({
      url: flags.url,
      events,
      filterSportKey: flags.sport,
      filterMarketKey: flags.market,
      filterPlayerName: flags.player,
      filterBookmakerKey: flags.bookmakers,
      filterEventId: flags.eventId,
      minPriceChangePct: flags.minPriceChangePct,
      minSteamScore: flags.minSteamScore,
      minBooksAgreeing: flags.minBooksAgreeing,
      batchMax: flags.batchMax,
    });
    if (flags.json) return printJson(hook);
    process.stdout.write(
      `webhook ${hook.id} created.\n` +
        `url:    ${hook.url}\n` +
        `events: ${(hook.events ?? []).join(",") || "(all)"}\n` +
        `secret: ${hook.secret}\n\n` +
        `STORE THE SECRET NOW — it's only revealed once. Use it to verify\n` +
        `the X-PropLine-Signature header on every delivery.\n`,
    );
  });
}

export function cmdWebhooksDelete(
  id: string,
  flags: CommonFlags,
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) {
      throw new Error(`webhook id must be numeric: ${id}`);
    }
    await client.deleteWebhook(numeric);
    if (flags.json) return printJson({ ok: true, id: numeric });
    process.stdout.write(`webhook ${numeric} deleted.\n`);
  });
}

export function cmdWebhooksTest(id: string, flags: CommonFlags): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) {
      throw new Error(`webhook id must be numeric: ${id}`);
    }
    const result = await client.testWebhook(numeric);
    if (flags.json) return printJson(result);
    process.stdout.write(`test payload queued for webhook ${numeric}.\n`);
  });
}

export function cmdWebhooksDeliveries(
  id: string,
  flags: CommonFlags & { limit?: number; beforeId?: number },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) {
      throw new Error(`webhook id must be numeric: ${id}`);
    }
    const deliveries = await client.listWebhookDeliveries(numeric, {
      limit: flags.limit,
      beforeId: flags.beforeId,
    });
    if (flags.json) return printJson(deliveries);
    type D = (typeof deliveries)[number];
    const cols: Column<D>[] = [
      { label: "ID", value: (r) => String(r.id), numeric: true },
      { label: "STATUS", value: (r) => String(r.status) },
      {
        label: "RESP",
        value: (r) => (r.response_code === null ? "" : String(r.response_code)),
        numeric: true,
      },
      { label: "ATTEMPTS", value: (r) => String(r.attempts), numeric: true },
      { label: "DELIVERED", value: (r) => formatTime(r.delivered_at) },
    ];
    printTable(deliveries, cols);
  });
}

export function cmdWebhooksReplay(
  id: string,
  flags: CommonFlags & { sinceSeq?: number; limit?: number; all?: boolean },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) {
      throw new Error(`webhook id must be numeric: ${id}`);
    }

    let cursor = flags.sinceSeq ?? 0;
    const collected: Awaited<
      ReturnType<typeof client.replayWebhookEvents>
    >["events"] = [];
    let page = await client.replayWebhookEvents(numeric, {
      sinceSeq: cursor,
      limit: flags.limit,
    });
    let truncated = page.truncated;
    collected.push(...page.events);
    cursor = page.next_seq;

    // --all follows the cursor to the end of the retained window; without it
    // a single page is fetched, which is the right default for eyeballing.
    while (flags.all && page.has_more) {
      page = await client.replayWebhookEvents(numeric, {
        sinceSeq: cursor,
        limit: flags.limit,
      });
      truncated = truncated || page.truncated;
      collected.push(...page.events);
      cursor = page.next_seq;
    }

    if (flags.json) {
      return printJson({ ...page, events: collected, truncated });
    }

    type E = (typeof collected)[number];
    const cols: Column<E>[] = [
      { label: "SEQ", value: (r) => String(r.seq), numeric: true },
      { label: "EVENT", value: (r) => String(r.event_type) },
      { label: "CREATED", value: (r) => formatTime(r.created_at) },
      { label: "DELIVERY", value: (r) => String(r.delivery_id), numeric: true },
    ];
    printTable(collected, cols);

    // The whole reason this endpoint returns an object rather than a list: a
    // short page must never read as "you are caught up".
    if (truncated) {
      process.stderr.write(
        "warning: events after your cursor have aged out of retention and " +
          "cannot be replayed — resync from the REST endpoints.\n",
      );
    }
    const behind = page.latest_seq - cursor;
    process.stdout.write(
      `\ncursor ${cursor} of ${page.latest_seq}` +
        (behind > 0 ? ` (${behind} event(s) still ahead)` : " (caught up)") +
        "\n",
    );
  });
}

/* ── history ────────────────────────────────────────────────────────── */

export function cmdHistory(
  sport: string,
  eventId: string,
  flags: CommonFlags & {
    markets?: string;
    bookmakers?: string;
    from?: string;
    to?: string;
    relativeFrom?: string;
    relativeTo?: string;
    interval?: string;
    changesOnly?: boolean;
    period?: string;
  },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const markets = parseMarketsFlag(flags.markets);
    const hist = await client.getOddsHistory(sport, eventId, {
      markets,
      bookmakers: flags.bookmakers,
      from: flags.from,
      to: flags.to,
      relativeFrom: flags.relativeFrom,
      relativeTo: flags.relativeTo,
      interval: flags.interval as
        | "30s"
        | "1m"
        | "5m"
        | "15m"
        | "30m"
        | "1h"
        | undefined,
      changesOnly: flags.changesOnly,
      period: flags.period,
    });
    if (flags.json) return printJson(hist);
    type Row = {
      book: string;
      market: string;
      player: string;
      side: string;
      when: string;
      point: string;
      price: string;
    };
    const rows: Row[] = [];
    for (const book of hist.bookmakers ?? []) {
      for (const m of book.markets ?? []) {
        for (const o of m.outcomes ?? []) {
          for (const s of o.snapshots ?? []) {
            rows.push({
              book: book.title ?? book.key,
              market: m.key,
              player: o.description ?? "",
              side: o.name,
              when: formatTime(s.recorded_at),
              point: formatPoint(s.point ?? null),
              price: formatPrice(s.price),
            });
          }
        }
      }
    }
    if (rows.length === 0) {
      process.stdout.write(
        `(no snapshots returned — check tier access and the time window)\n`,
      );
      return;
    }
    const cols: Column<Row>[] = [
      { label: "BOOK", value: (r) => r.book },
      { label: "MARKET", value: (r) => r.market },
      { label: "PLAYER", value: (r) => truncate(r.player, 24) },
      { label: "SIDE", value: (r) => r.side },
      { label: "WHEN", value: (r) => r.when },
      { label: "LINE", value: (r) => r.point, numeric: true },
      { label: "PRICE", value: (r) => r.price, numeric: true },
    ];
    printTable(rows, cols);
  });
}

/* ── closing ────────────────────────────────────────────────────────── */

export function cmdClv(
  file: string,
  flags: CommonFlags,
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);

    // JSON only, deliberately. A bet log is usually a CSV, but a naive
    // split(",") mangles any quoted field — "Tatis Jr., Fernando" becomes
    // two columns — and silently grading the wrong bet is exactly the
    // failure this endpoint's fail-closed matching exists to prevent.
    // Pipe CSV through jq/csvkit rather than trusting a half parser here.
    const raw =
      file === "-"
        ? await new Promise<string>((resolve, reject) => {
            let buf = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (c) => (buf += c));
            process.stdin.on("end", () => resolve(buf));
            process.stdin.on("error", reject);
          })
        : await readFile(file, "utf8");

    let bets: unknown;
    try {
      bets = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Could not parse ${file === "-" ? "stdin" : file} as JSON: ${
          (e as Error).message
        }`,
      );
    }
    if (!Array.isArray(bets)) {
      throw new Error("Expected a JSON array of bet objects.");
    }

    const res = await client.gradeClv(bets as never);
    if (flags.json) return printJson(res);

    const s = res.summary;
    process.stdout.write(
      `${s.matched}/${s.bets} matched` +
        (s.unmatched ? ` · ${s.unmatched} unmatched` : "") +
        (s.pending ? ` · ${s.pending} pending (event not started)` : "") +
        `\n`,
    );
    if (s.avg_clv_pct !== null && s.avg_clv_pct !== undefined) {
      process.stdout.write(
        `avg CLV ${s.avg_clv_pct > 0 ? "+" : ""}${s.avg_clv_pct}% · ` +
          `vs de-vigged close ${
            s.avg_ev_vs_close_pct !== null && s.avg_ev_vs_close_pct !== undefined
              ? `${s.avg_ev_vs_close_pct > 0 ? "+" : ""}${s.avg_ev_vs_close_pct}%`
              : "n/a"
          } · beat the close ${s.beat_close_pct ?? "n/a"}%` +
          (s.profit_units !== null && s.profit_units !== undefined
            ? ` · ${s.profit_units > 0 ? "+" : ""}${s.profit_units}u`
            : "") +
          `\n`,
      );
    }

    type Row = {
      ref: string;
      selection: string;
      price: string;
      close: string;
      clv: string;
      evClose: string;
      anchor: string;
      result: string;
    };
    const rows: Row[] = (res.bets ?? []).map((b) => ({
      ref: b.ref ?? "",
      selection: `${b.selection}${b.side ? ` ${b.side}` : ""}${
        b.point !== null && b.point !== undefined ? ` ${b.point}` : ""
      }`,
      price: formatPrice(b.price),
      close: b.matched
        ? b.closing_price === null || b.closing_price === undefined
          ? ""
          : formatPrice(b.closing_price)
        : `— ${b.unmatched_reason ?? "unmatched"}`,
      clv:
        b.clv_pct === null || b.clv_pct === undefined
          ? ""
          : `${b.clv_pct > 0 ? "+" : ""}${b.clv_pct}%`,
      evClose:
        b.ev_vs_close_pct === null || b.ev_vs_close_pct === undefined
          ? ""
          : `${b.ev_vs_close_pct > 0 ? "+" : ""}${b.ev_vs_close_pct}%`,
      // Pre-kickoff rows have no real close; say so rather than printing a
      // CLV that is ~0 by construction.
      anchor: b.matched && !b.closing_is_final ? "pending" : b.fair_source ?? "",
      result: b.resolution ?? "",
    }));

    const cols: Column<Row>[] = [
      { label: "REF", value: (r) => r.ref },
      { label: "SELECTION", value: (r) => truncate(r.selection, 30) },
      { label: "TOOK", value: (r) => r.price, numeric: true },
      { label: "CLOSE", value: (r) => r.close, numeric: true },
      { label: "CLV", value: (r) => r.clv, numeric: true },
      { label: "VS DEVIG", value: (r) => r.evClose, numeric: true },
      { label: "ANCHOR", value: (r) => r.anchor },
      { label: "RESULT", value: (r) => r.result },
    ];
    printTable(rows, cols);
  });
}

export function cmdClosing(
  sport: string,
  eventId: string,
  flags: CommonFlags & { markets?: string; bookmakers?: string; period?: string },
): Promise<void> {
  return runCommand(async () => {
    const client = buildClient(flags);
    const markets = parseMarketsFlag(flags.markets);
    const closing = await client.getOddsClosing(sport, eventId, {
      markets,
      bookmakers: flags.bookmakers,
      period: flags.period,
    });
    if (flags.json) return printJson(closing);
    type Row = {
      book: string;
      market: string;
      player: string;
      side: string;
      closingAt: string;
      openPoint: string;
      openPrice: string;
      point: string;
      price: string;
    };
    const rows: Row[] = [];
    for (const book of closing.bookmakers ?? []) {
      for (const m of book.markets ?? []) {
        for (const o of m.outcomes ?? []) {
          rows.push({
            book: book.title ?? book.key,
            market: m.key,
            player: o.description ?? "",
            side: o.name,
            closingAt: o.closing_at ? formatTime(o.closing_at) : "",
            openPoint: formatPoint(o.opening_point ?? null),
            openPrice:
              o.opening_price === null || o.opening_price === undefined
                ? ""
                : formatPrice(o.opening_price),
            point: formatPoint(o.point ?? null),
            price: o.price === null ? "" : formatPrice(o.price),
          });
        }
      }
    }
    if (rows.length === 0) {
      process.stdout.write(
        `(no closing lines returned — check tier access; free tier sees redacted structure)\n`,
      );
      return;
    }
    process.stdout.write(
      `${closing.away_team} @ ${closing.home_team} (event ${closing.id})\n`,
    );
    const cols: Column<Row>[] = [
      { label: "BOOK", value: (r) => r.book },
      { label: "MARKET", value: (r) => r.market },
      { label: "PLAYER", value: (r) => truncate(r.player, 24) },
      { label: "SIDE", value: (r) => r.side },
      { label: "CLOSED AT", value: (r) => r.closingAt },
      { label: "OPEN", value: (r) => r.openPoint, numeric: true },
      { label: "OPEN PRICE", value: (r) => r.openPrice, numeric: true },
      { label: "LINE", value: (r) => r.point, numeric: true },
      { label: "PRICE", value: (r) => r.price, numeric: true },
    ];
    printTable(rows, cols);
  });
}

/* ── helpers ────────────────────────────────────────────────────────── */

function parseMarketsFlag(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Avoid an unused-import warning while still re-exporting the type
 *  for downstream consumers who want to wire their own subcommands. */
export type { PropLine };
