# propline-cli

Terminal interface for the [PropLine](https://prop-line.com/?ref=cli) player props betting odds API. Wraps the [`propline`](https://www.npmjs.com/package/propline) Node SDK with pretty-printed tables and a `--json` opt-out.

```bash
npx propline-cli live
# or, for repeated use:
npm install -g propline-cli
propline live
```

## Auth

Set your API key once:

```bash
export PROPLINE_API_KEY=your_key_here
```

Or pass `--api-key` per-invocation. Get a free key at <https://prop-line.com/?ref=cli>.

## Quick examples

```bash
# Every game in progress, across every sport
propline live

# Today's MLB slate
propline events baseball_mlb

# Cross-book odds for one event
propline odds baseball_mlb 12345 --markets h2h,spreads,totals,player_points

# First-quarter NBA totals only (game-period filter on every odds command)
propline odds basketball_nba 12345 --markets totals --period q1

# Only DraftKings + FanDuel lines (bookmaker filter on every odds command)
propline odds baseball_mlb 12345 --markets pitcher_strikeouts --bookmakers draftkings,fanduel

# Add per-book event-page URLs (click out to the book) — also on best-line
propline best-line baseball_mlb 12345 --links

# Scores from the last 3 days
propline scores basketball_nba

# Game context — probable pitchers, umpire, first-pitch weather (free)
propline context baseball_mlb 12345

# Cross-book +EV plays (Pro tier)
propline ev baseball_mlb 12345 --plus

# ...priced only at the books you hold accounts at. This narrows the
# prices, never the fair-line anchor — DK is still measured against
# Pinnacle.
propline ev baseball_mlb 12345 --plus --bookmakers draftkings,fanduel

# Player prop history (Pro tier)
propline player-history baseball_mlb "Aaron Judge" --market batter_home_runs

# Aggregated hit-rate trends per market (Pro tier)
propline player-trends baseball_mlb "Aaron Judge"
propline player-trends baseball_mlb "Aaron Judge" --market batter_total_bases
# Scope the trend to a PrizePicks flavor's line (standard | goblin | demon)
propline player-trends baseball_mlb "Aaron Judge" --dfs-odds-type goblin

# Bulk CSV export of resolved props (Pro tier)
propline export-resolved-props --sport baseball_mlb --since 2026-04-01T00:00:00Z --out mlb-resolved.csv

# Manage webhook subscriptions (Streaming tier)
propline webhooks list
propline webhooks create --url https://example.com/hook --events line_movement,resolution --sport baseball_mlb
# Hear when 3+ books pull the same player pregame (a late scratch); drop --min-books-agreeing for every drop
propline webhooks create --url https://example.com/hook --events market_suspended --sport baseball_mlb --min-books-agreeing 3
propline webhooks deliveries 42
propline webhooks deliveries 42 --limit 200 --before-id 123456  # page backwards
```

## Commands

| Command | Description |
| --- | --- |
| `propline sports` | List available sports |
| `propline events <sport>` | List upcoming events for a sport |
| `propline odds <sport> [event_id]` | Bulk odds (no event_id) or per-event (with). `--period q1` (or `h1`/`p1`/`f5`/…) filters to game-period markets; `--bookmakers draftkings,fanduel` filters to specific books; `--links` adds each book's public event-page URL (Bovada/DK/FanDuel/BetMGM/Kalshi/Polymarket/Smarkets — also on `best-line`). |
| `propline history <sport> <event_id>` | Historical line movement; supports `--from`/`--to`, `--relative-from`/`--relative-to`, `--interval`, `--changes-only`, `--period` (Hobby+) |
| `propline closing <sport> <event_id>` | Opening **and** closing line per (book, market, outcome) — CLV helper. Table shows OPEN / OPEN PRICE beside LINE / PRICE. `--period` accepted (Hobby+) |
| `propline clv <file>` | Grade **placed** bets against their closing lines. Takes a JSON array of bets (or `-` for stdin) and prints TOOK / CLOSE / CLV / VS DEVIG / ANCHOR / RESULT per bet plus a portfolio summary (Hobby+) |
| `propline scores <sport>` | Recent scores + status |
| `propline futures <sport>` | Season-long futures — championship/division/conference winners, MVP + awards, season win totals across Bovada/FanDuel/DraftKings/Pinnacle (free) |
| `propline context <sport> <event_id>` | Game conditions a prop settles under — probable pitchers, lineup, home-plate umpire, first-pitch weather (free) |
| `propline movement <sport> <event_id>` | Line movement + steam detection across books — sharp-money signal (Hobby+) |
| `propline resolution-summary` | Graded-prop volume + per-sport breakdown (free) |
| `propline live` | Every in-progress game across the major sports |
| `propline ev <sport> <event_id>` | Cross-book +EV vs no-vig fair line (Pro) |
| `propline best-line <sport> <event_id>` | Cross-book line shopping — best price per (market, player, line) across all comparable books. `--markets` + `--bookmakers` filters (Hobby+) |
| `propline player-history <sport> <player>` | Recent prop history for a player on a market |
| `propline player-trends <sport> <player>` | Aggregated hit-rate trends per market — L5/L10/L20/L50 over/under splits + current streak. `--market <key>` to filter, `--dfs-odds-type <flavor>` to scope to a PrizePicks flavor (Pro full, Free redacted) |
| `propline export-resolved-props --sport <key>` | Bulk CSV export of resolved props (Pro) |
| `propline webhooks list / create / delete / test / deliveries` | Webhook management (Streaming) |

Run `propline <cmd> --help` for the full flag set on any command.

## Global flags

- `--api-key <key>` — overrides `PROPLINE_API_KEY`
- `--base-url <url>` — point at a self-hosted / staging deployment (default `https://api.prop-line.com/v1`)
- `--timeout <seconds>` — request timeout (default 15)
- `--json` — emit raw JSON instead of a table; pipe-friendly with `jq`

## Links

- **Website**: [prop-line.com](https://prop-line.com/?ref=cli)
- **API Docs**: [prop-line.com/docs](https://prop-line.com/docs?ref=cli)
- **Recipes** (code for common jobs): [prop-line.com/recipes](https://prop-line.com/recipes?ref=cli)
- **Odds API by sport and market** (live line, books, graded hit rate): [prop-line.com/odds-api](https://prop-line.com/odds-api?ref=cli)
- **Prop resolution** (every prop graded against the box score): [prop-line.com/prop-resolution-api](https://prop-line.com/prop-resolution-api?ref=cli)
- **Cross-book +EV**: [prop-line.com/ev](https://prop-line.com/ev?ref=cli)
- **Pricing**: [prop-line.com/pricing](https://prop-line.com/pricing?ref=cli)
- **Dashboard**: [prop-line.com/dashboard](https://prop-line.com/dashboard)
- **OpenAPI reference**: [api.prop-line.com/docs](https://api.prop-line.com/docs)
- **Node SDK** (what this wraps): [`npm install propline`](https://www.npmjs.com/package/propline)
- **Python SDK**: [`pip install propline`](https://pypi.org/project/propline/)

## License

MIT

### Grade your bets against the close

```bash
cat > bets.json <<'JSON'
[
  {"ref": "b1", "sport_key": "baseball_mlb", "event_id": 150791,
   "market": "batter_hits_runs_rbis", "bookmaker": "lowvig",
   "selection": "Drake Baldwin", "side": "Under", "point": 0.5,
   "price": 145, "stake": 1}
]
JSON

propline clv bets.json
```

```
1/1 matched
avg CLV +6.52% · vs de-vigged close +0.08% · beat the close 100% · -1u

REF  SELECTION            TOOK  CLOSE   CLV     VS DEVIG  ANCHOR    RESULT
b1   Drake Baldwin Under 0.5  +145   +130  +6.52%    +0.08%  pinnacle  lost
```

**Read the VS DEVIG column, not CLV.** `CLV` is price-vs-price — familiar,
but vig-blind, so it flatters a bet taken on the juicy side of a wide
market. `VS DEVIG` scores your price against the de-vigged close and is the
honest number; above they differ by 6.4 points on the same bet.

`ANCHOR` is the book whose closing pair the de-vig came from — the sharpest
book quoting that line, **not** the book you bet at. It reads `pending` when
the event has not started, in which case the "closing" price is just the
latest price and that row is excluded from the summary averages.

Unmatched bets show the reason in the CLOSE column rather than being
dropped — matching is fail-closed, so a bet that cannot be pinned to exactly
one stored outcome is refused instead of guessed at.

JSON in, JSON out: pipe with `-` and pass `--json` to keep it machine-readable.
CSV is deliberately not parsed — a naive split mangles quoted names like
`"Tatis Jr., Fernando"`, and grading the wrong bet is the failure this
endpoint exists to avoid. Convert with `jq`/`csvkit` first.
