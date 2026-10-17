/**
 * One app, every place its truth can live -- a JSON file, SQLite, and dzql's
 * Postgres (in the process, or a server) -- and the same answers from each.
 *
 * A project may start on a JSON file, move to SQLite, then to Postgres on
 * dzql. The app does not change on the
 * way: the same schema, the same documents, the same writes, the same data
 * with the same serial ids. Only where the truth lives changes. This is the
 * proof: each backend's file supplies an adapter (`PathBackend`) and asks
 * every case below of it. Where a backend answers differently, it is wrong.
 *
 * Every case ends on the law: each document still open, with
 * everything it was told applied to what it opened, equals a fresh open. A
 * message missing, extra, misshapen or out of order breaks it, whatever the
 * case set out to show. Values are compared exactly as Postgres gives them:
 * ids are numbers, a temporal row has no validity columns. Only a copy's
 * version (`_v`) is left out of the law; versions have their own cases.
 */
import { asItStoodCases, temporalCases } from "./path/temporal";
import { columnCases, documentCases, registrationCases, serialCases } from "./path/documents";
import { customDocCases } from "./path/custom";
import { drivenCases } from "./path/driven";
import { fanOutCases as fanOut } from "./path/fanout";
import { impliedCases } from "./path/implied";
import { ledgerCases } from "./path/ledger";
import type { PathBackend } from "./path/law";

export * from "./path/fixture";
export { assertCopiesHold, everyDocument, expectSilent, expectTold, openAll, readAll, told, toldOps, write, type PathBackend, type PathProcess } from "./path/law";
export { asItStoodCases, columnCases, documentCases, drivenCases, registrationCases, serialCases };

/** Fan-out, and what rides it: temporal rows, the ledger, implied documents, custom documents. */
export function fanOutCases(backend: () => PathBackend): void {
  fanOut(backend);
  temporalCases(backend);
  ledgerCases(backend);
  impliedCases(backend);
  customDocCases(backend);
}

/** Every case, asked of the backend `backend()` answers (a fresh one per case), a file a feature under `./path/`. */
export function pathCases(backend: () => PathBackend): void {
  documentCases(backend);
  columnCases(backend);
  fanOutCases(backend);
  serialCases(backend);
  asItStoodCases(backend);
  registrationCases(backend);
  drivenCases(backend);
}
