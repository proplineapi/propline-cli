# propline-cli

Terminal interface for the [PropLine](https://prop-line.com) player props betting odds API. Wraps the [`propline`](https://www.npmjs.com/package/propline) Node SDK with pretty-printed tables and a `--json` opt-out.

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

Or pass `--api-key` per-invocation. Get a free key at <https://prop-line.com>.

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

# Scores from the last 3 days
propline scores basketball_nba

# Cross-book +EV plays (Pro tier)
propline ev baseball_mlb 12345 --plus

# Player prop history (Pro tier)
propline player-history baseball_mlb "Aaron Judge" --market batter_home_runs

# Bulk CSV export of resolved props (Pro tier)
propline export-resolved-props --sport baseball_mlb --since 2026-04-01T00:00:00Z --out mlb-resolved.csv

# Manage webhook subscriptions (Streaming tier)
propline webhooks list
propline webhooks create --url https://example.com/hook --events line_movement,resolution --sport baseball_mlb
propline webhooks deliveries 42
```

## Commands

| Command | Description |
| --- | --- |
| `propline sports` | List available sports |
| `propline events <sport>` | List upcoming events for a sport |
| `propline odds <sport> [event_id]` | Bulk odds (no event_id) or per-event (with). `--period q1` (or `h1`/`p1`/`f5`/…) filters to game-period markets. |
| `propline history <sport> <event_id>` | Historical line movement; supports `--from`/`--to`, `--relative-from`/`--relative-to`, `--interval`, `--changes-only`, `--period` (Hobby+) |
| `propline closing <sport> <event_id>` | Closing line per (book, market, outcome) — CLV helper. `--period` accepted (Hobby+) |
| `propline scores <sport>` | Recent scores + status |
| `propline resolution-summary` | Graded-prop volume + per-sport breakdown (free) |
| `propline live` | Every in-progress game across the major sports |
| `propline ev <sport> <event_id>` | Cross-book +EV vs no-vig fair line (Pro) |
| `propline player-history <sport> <player>` | Recent prop history for a player on a market |
| `propline export-resolved-props --sport <key>` | Bulk CSV export of resolved props (Pro) |
| `propline webhooks list / create / delete / test / deliveries` | Webhook management (Streaming) |

Run `propline <cmd> --help` for the full flag set on any command.

## Global flags

- `--api-key <key>` — overrides `PROPLINE_API_KEY`
- `--base-url <url>` — point at a self-hosted / staging deployment (default `https://api.prop-line.com/v1`)
- `--timeout <seconds>` — request timeout (default 15)
- `--json` — emit raw JSON instead of a table; pipe-friendly with `jq`

## License

MIT
