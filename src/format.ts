// Pretty-printing helpers — zero deps. Default output is a fixed-width
// table with right-aligned numeric columns; pass --json on any command
// to bypass and emit raw response JSON instead. Tables are streamed to
// stdout via console.log so a downstream `| head` short-circuits cleanly.

export interface Column<T> {
  label: string;
  /** Stringified cell value. */
  value: (row: T) => string;
  /** Right-align (numeric) vs default left-align. */
  numeric?: boolean;
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printTable<T>(rows: T[], columns: Column<T>[]): void {
  if (rows.length === 0) {
    process.stdout.write("(no rows)\n");
    return;
  }
  const cells: string[][] = rows.map((r) =>
    columns.map((c) => {
      const v = c.value(r);
      return v === undefined || v === null ? "" : String(v);
    }),
  );
  const headers = columns.map((c) => c.label);

  // Width = max(header, max cell). Capped at 60 chars so a long player
  // name or URL doesn't blow the layout open; the table is for skim
  // reading, full data is one --json away.
  const widths = headers.map((h, i) =>
    Math.min(60, Math.max(h.length, ...cells.map((row) => (row[i] ?? "").length))),
  );

  function pad(s: string, w: number, numeric: boolean): string {
    const truncated = s.length > w ? s.slice(0, w - 1) + "…" : s;
    if (numeric) return truncated.padStart(w);
    return truncated.padEnd(w);
  }

  // Header
  process.stdout.write(
    headers
      .map((h, i) => pad(h, widths[i] ?? 0, columns[i]?.numeric ?? false))
      .join("  ") + "\n",
  );
  // Underline
  process.stdout.write(widths.map((w) => "─".repeat(w)).join("  ") + "\n");
  // Rows
  for (const row of cells) {
    process.stdout.write(
      row
        .map((c, i) => pad(c, widths[i] ?? 0, columns[i]?.numeric ?? false))
        .join("  ") + "\n",
    );
  }
}

export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return "–";
  if (price === 0) return "EVEN";
  return price > 0 ? `+${price}` : String(price);
}

export function formatPoint(point: number | null | undefined): string {
  if (point === null || point === undefined) return "";
  if (Number.isInteger(point)) return String(point);
  return point.toFixed(1);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Truncate to N chars with ellipsis — used for long player/market names. */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
