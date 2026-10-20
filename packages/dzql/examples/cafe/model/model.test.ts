// The model, proved on a store: written by `dzql model` from the model's page; never edited by hand.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createLocal } from "@blueshed/delta/local";
import { diff, stateOf } from "@blueshed/delta/migrations";
import { fromFolder, migrate, registerDocs } from "@blueshed/delta/sqlite";
import { guardWrites, rowsIn } from "dzql/modelling/guards";
import { guards } from "./guards";
import { docs, schema } from "./types";

const migrations = await fromFolder(`${import.meta.dir}/migrations`);
// what a person must finish by hand (a parent changed) is owed by the step that says so
const owed = (await Promise.all([...new Bun.Glob("*.ts").scanSync(`${import.meta.dir}/migrations`)].map((f) => Bun.file(`${import.meta.dir}/migrations/${f}`).text()))).join("\n");
async function store() {
  const db = new Database(":memory:");
  await migrate(db, migrations, { app: "model", schema });
  // a document whose root hangs from another is opened at a row that is there: row 1, and each above it,
  // but a row a story adds is that story's, made by the premise of whatever needs it
  for (const e of []) {
    const t = schema.tables[e]!;
    db.run(`INSERT OR IGNORE INTO "${t.name}" (id${t.parent ? `, "${t.parent.fkColumn}"` : ""}) VALUES (1${t.parent ? ", 1" : ""})`);
  }
  const local = createLocal();
  // the guards stand in front of the store, as in the app: each write is made as its story's teller
  guardWrites(local.server, guards, { actorOf: (who) => (who as { actor?: string } | undefined)?.actor, rowOf: rowsIn(db, schema) });
  registerDocs(local.server, db, schema, docs);
  return { local };
}

test("the migrations, from empty, are the schema the types describe", async () => {
  const { changes, byHand } = diff(stateOf(migrations), schema);
  expect({ changes, byHand: byHand.filter((b) => !owed.includes(`// By hand: ${b}`)) }).toEqual({ changes: [], byHand: [] });
});

type Write = { as: string; doc: string; ops: unknown[] };
type Check = { who: string; doc: string; entity: string; path?: string; to?: unknown; root: boolean };
// each story: its words, whether it is refused, the writes it needs first, its own, and who then sees what
const cases: [string, boolean, Write[], Write[], Check[]][] = [
  ["The manager says what tables there are", false, [], [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]}], [{"who":"manager","doc":"floor:","entity":"tables","path":"seated","to":false,"root":false},{"who":"cook","doc":"floor:","entity":"tables","path":"seated","to":false,"root":false}]],
  ["The cook says what is on the menu", false, [], [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"cook","doc":"menu:","ops":[{"op":"remove","path":"/items/1"}]}], []],
  ["The manager seats a customer at a free table and opens an invoice for it", false, [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]}], [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]}], [{"who":"manager","doc":"floor:","entity":"invoices","path":"paid","to":false,"root":false},{"who":"cook","doc":"floor:","entity":"invoices","path":"paid","to":false,"root":false},{"who":"customer","doc":"table:1","entity":"invoices","path":"paid","to":false,"root":false},{"who":"manager","doc":"floor:","entity":"tables","path":"seated","to":true,"root":false},{"who":"cook","doc":"floor:","entity":"tables","path":"seated","to":true,"root":false},{"who":"customer","doc":"table:1","entity":"tables","path":"seated","to":true,"root":true}]],
  ["The manager cannot open an invoice on a table that already has an unpaid one", true, [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]}], [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1}}]}], []],
  ["The customer orders from the menu onto their invoice", false, [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]}], [{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1,"status":"ordered"}}]}], [{"who":"customer","doc":"table:1","entity":"orders","path":"status","to":"ordered","root":false},{"who":"manager","doc":"floor:","entity":"orders","path":"status","to":"ordered","root":false},{"who":"cook","doc":"floor:","entity":"orders","path":"status","to":"ordered","root":false}]],
  ["The cook says an order is ready", false, [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1,"status":"ordered"}}]}], [{"as":"cook","doc":"floor:","ops":[{"op":"replace","path":"/orders/1/status","value":"ready"}]}], [{"who":"cook","doc":"floor:","entity":"orders","path":"status","to":"ready","root":false},{"who":"manager","doc":"floor:","entity":"orders","path":"status","to":"ready","root":false},{"who":"customer","doc":"table:1","entity":"orders","path":"status","to":"ready","root":false}]],
  ["The manager takes a ready order to its table and marks it placed", false, [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1,"status":"ordered"}}]},{"as":"cook","doc":"floor:","ops":[{"op":"replace","path":"/orders/1/status","value":"ready"}]}], [{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/orders/1/status","value":"placed"}]}], [{"who":"manager","doc":"floor:","entity":"orders","path":"status","to":"placed","root":false},{"who":"cook","doc":"floor:","entity":"orders","path":"status","to":"placed","root":false},{"who":"customer","doc":"table:1","entity":"orders","path":"status","to":"placed","root":false}]],
  ["The customer pays their invoice, which frees the table", false, [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]}], [{"as":"customer","doc":"table:1","ops":[{"op":"replace","path":"/invoices/1/paid","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"replace","path":"/tables/1/seated","value":false}]}], [{"who":"customer","doc":"table:1","entity":"invoices","path":"paid","to":true,"root":false},{"who":"manager","doc":"floor:","entity":"invoices","path":"paid","to":true,"root":false},{"who":"cook","doc":"floor:","entity":"invoices","path":"paid","to":true,"root":false},{"who":"customer","doc":"table:1","entity":"tables","path":"seated","to":false,"root":true},{"who":"manager","doc":"floor:","entity":"tables","path":"seated","to":false,"root":false},{"who":"cook","doc":"floor:","entity":"tables","path":"seated","to":false,"root":false}]],
  ["A customer cannot add to a paid invoice", true, [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"replace","path":"/invoices/1/paid","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"replace","path":"/tables/1/seated","value":false}]}], [{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1}}]}], []],
  ["The manager cannot order, pay or say an order is ready: that is the customer's and the cook's", true, [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1,"status":"ordered"}}]}], [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/invoices/1/paid","value":true}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/orders/1/status","value":"ready"}]}], []],
  ["The cook cannot say what tables there are, seat, open invoices, order, pay or place an order: that is the manager's and the customer's", true, [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1,"status":"ordered"}}]}], [{"as":"cook","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{}}]},{"as":"cook","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"cook","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1}}]},{"as":"cook","doc":"floor:","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1}}]},{"as":"cook","doc":"floor:","ops":[{"op":"replace","path":"/invoices/1/paid","value":true}]},{"as":"cook","doc":"floor:","ops":[{"op":"replace","path":"/orders/1/status","value":"placed"}]}], []],
  ["A customer cannot change the menu, say what tables there are, seat, open invoices, or say an order is ready or placed", true, [{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/tables/-","value":{"seated":false}}]},{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"floor:","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1,"paid":false}}]},{"as":"manager","doc":"floor:","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/orders/-","value":{"invoices_id":1,"dish_id":1,"status":"ordered"}}]}], [{"as":"customer","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"customer","doc":"menu:","ops":[{"op":"remove","path":"/items/1"}]},{"as":"customer","doc":"table:1","ops":[{"op":"replace","path":"/tables/1/seated","value":true}]},{"as":"customer","doc":"table:1","ops":[{"op":"add","path":"/invoices/-","value":{"tables_id":1}}]},{"as":"customer","doc":"table:1","ops":[{"op":"replace","path":"/orders/1/status","value":"changed"}]}], []],
  ["The manager cannot change the menu: that is the cook's", true, [{"as":"cook","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]}], [{"as":"manager","doc":"menu:","ops":[{"op":"add","path":"/items/-","value":{}}]},{"as":"manager","doc":"menu:","ops":[{"op":"remove","path":"/items/1"}]}], []],
];

describe("each story, on the store, each guarded", () => {
  for (const [name, refused, premise, does, checks] of cases)
    test(name, async () => {
      const { local } = await store();
      // a write goes to a document its writer has open, as on a page
      const write = async ({ as, ...w }: Write) => {
        const writer = local.as({ actor: as });
        expect((await writer.call("open", { doc: w.doc })).error, `open ${w.doc}`).toBeUndefined();
        return writer.call("delta", w);
      };
      for (const w of premise) expect(await write(w), `the premise: ${JSON.stringify(w)}`).toEqual({ result: { ack: true } });
      // a story someone cannot do is refused, in its own words
      for (const w of does) expect(await write(w), JSON.stringify(w)).toMatchObject(refused ? { error: { code: 403, message: name } } : { result: { ack: true } });
      for (const c of checks) {
        const doc = (await local.call("open", { doc: c.doc })).result as Record<string, any>;
        const rows = c.root ? [doc[c.entity]] : Object.values(doc[c.entity] ?? {});
        expect(rows.some((r: any) => r && (c.path === undefined || ("time" in c ? Date.parse(String(r[c.path])) === Date.parse(String(c.to)) : r[c.path] === c.to))), `${c.who} sees ${c.entity}${c.path ? `.${c.path} = ${c.to}` : ""} in ${c.doc}`).toBe(true);
      }
    });
});
