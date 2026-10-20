/**
 * The board's part of the page, rendered with railroad.
 *
 * Two patterns:
 *
 *   1. board.data.map(d => …)                     — derive sorted lists from the doc
 *   2. list(items$, keyFn, item$ => <Component>)  — keyed render; per-row updates
 *
 * No applyOpsToCollection — railroad's `list()` is the higher-level idiom for
 * keyed iteration. The Signal under each row is a stable reference, so a
 * field-level op produces a single text-node update, no DOM rebuild.
 *
 * No useState, no fetch, no subscription config. The doc IS the state.
 */
import { list, type JSX, type ReadonlySignal } from "@blueshed/railroad";
import type { Card, Column } from "./board-api";
import { board } from "./board";

// ---------------------------------------------------------------------------
// Op senders — one verb per intent. The router for every UI action.
// ---------------------------------------------------------------------------

async function moveCardRight(card: Card): Promise<void> {
  const state = board.data.peek();
  if (!state) return;
  const cols = Object.values(state.kanban_columns).sort((a, b) => a.position - b.position);
  const idx = cols.findIndex((c) => c.id === card.kanban_columns_id);
  const next = cols[(idx + 1) % cols.length];                 // wrap at the end
  if (!next || next.id === card.kanban_columns_id) return;
  await board.send([{ op: "replace", path: `/kanban_cards/${card.id}/kanban_columns_id`, value: next.id }]);
}

async function renameColumn(col: Column): Promise<void> {
  const next = prompt("Column title", col.title);
  if (!next || next === col.title) return;
  await board.send([{ op: "replace", path: `/kanban_columns/${col.id}/title`, value: next }]);
}

async function addCard(columnId: number): Promise<void> {
  const title = prompt("Card title");
  if (!title) return;
  const state = board.data.peek();
  const inCol = state
    ? Object.values(state.kanban_cards).filter((c) => c.kanban_columns_id === columnId)
    : [];
  await board.send([{
    op: "add",
    path: "/kanban_cards/-",                                  // server picks the id
    value: { kanban_columns_id: columnId, owner_id: 1, title, position: inCol.length },
  }]);
}

// ---------------------------------------------------------------------------
// Components — each takes a ReadonlySignal of its row, never the raw value.
// ---------------------------------------------------------------------------

function CardItem({ card$ }: { card$: ReadonlySignal<Card> }): JSX.Element {
  return (
    <div class="card" onclick={() => moveCardRight(card$.peek())}>
      {card$.map((c) => c.title)}
    </div>
  );
}

function ColumnView({ column$ }: { column$: ReadonlySignal<Column> }): JSX.Element {
  // Cards belonging to this column, sorted by position. Re-derived whenever
  // board.data updates; railroad's keyed `list()` reuses the per-card DOM nodes.
  const cards$ = board.data.map((d): Card[] => {
    if (!d) return [];
    const colId = column$.peek().id;
    return Object.values(d.kanban_cards)
      .filter((c) => c.kanban_columns_id === colId)
      .sort((a, b) => a.position - b.position);
  });

  return (
    <div class="column">
      <h3 ondblclick={() => renameColumn(column$.peek())}>{column$.map((c) => c.title)}</h3>
      {list<Card>(cards$, (c: Card) => c.id, (c$) => <CardItem card$={c$} />)}
      <button onclick={() => addCard(column$.peek().id)}>+ add card</button>
    </div>
  );
}

/** The board: its title, and its columns side by side. */
export function BoardView(): JSX.Element {
  const columns$ = board.data.map((d): Column[] => {
    if (!d) return [];
    return Object.values(d.kanban_columns).sort((a, b) => a.position - b.position);
  });
  const title$ = board.data.map((d) => {
    if (!d) return "";
    return Object.values(d.kanban_boards)[0]?.title ?? "";
  });

  return (
    <div class="board">
      <h1>{title$}</h1>
      <div class="columns">
        {list<Column>(columns$, (c: Column) => c.id, (c$) => <ColumnView column$={c$} />)}
      </div>
    </div>
  );
}
