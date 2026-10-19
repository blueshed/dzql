import { refuseOrigin } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import type { Example } from "dzql/rendering/example";
import { serverWrite } from "dzql/rendering/documents";
import { appOf, compose, sessionCookie } from "dzql/rendering/server";
import { scope } from "dzql/rendering/scope";
import homepage from "./index.html";
import { delta, open, pool, stories } from "./store";
import { links } from "./links";
import { render } from "./page";
import { floor } from "./resources/floor/floor";
import { menu } from "./resources/menu/menu";
import { table } from "./resources/table/table";
import { visit } from "./resources/visit/visit";
import { door } from "./resources/door/door";
import { read as visitOf, sessions } from "./resources/visit/visit-api";

// The cafe, built from its model: a manager seats customers and opens their invoices, a cook says
// what is on the menu and what is ready, and customers who scan their table's code order and pay.
// The stories were told on the model's page (./model.json); `dzql model` made ./model/ from them
// (the definitions, the guards, the migrations, the proof); the app is its routes and its
// resources, each document a folder of ./resources/, its stories ./stories.ts, each naming the
// model story it tells. ./README.md walks the path.

// every resource has registered its documents (the imports above): compile them, and open the listener
await open();

/** The code on a table: `/scan?table=1`, or the door's button. The visitor is at that table now (the model's story 3). */
async function scan(req: Request): Promise<Response> {
  let table = new URL(req.url).searchParams.get("table");
  if (req.method === "POST") {
    const refused = refuseOrigin(req);
    if (refused) return refused;
    table = String((await req.formData()).get("table") ?? "");
  }
  if (!table || !/^\d+$/.test(table) || (await pool.query(`SELECT 1 FROM "tables" WHERE id = $1`, [table])).rows.length === 0) return new Response("There is no such table here.", { status: 404 });
  const home = (cookie?: string) => new Response(null, { status: 303, headers: { Location: "/", ...(cookie ? { "Set-Cookie": sessionCookie(cookie) } : {}) } });
  const visit = new RegExp(`(?:^|;\\s*)${scope().cookie.name}=([^;]+)`).exec(req.headers.get("cookie") ?? "")?.[1];
  if (!visit) return home((await sessions.start({ table })).cookie);
  await serverWrite(`visit:${await sessions.of(visit)}`, [{ op: "replace", path: "/visits/table", value: table }, { op: "replace", path: "/visits/page", value: "" }]);
  return home();
}

/** The page and its resources: one per document, the visit first, and the page they draw. */
export const app: Example = {
  name: "cafe",
  index: homepage,
  delta,
  resources: [visit, floor, menu, table, door],
  render,
  active: (sessionId) => visitOf(sessionId).role !== null, // staff signed in, or a customer at a table
  address: { doc: "visit", path: "/page" }, // a screen's URL is where the visit goes
  routes: { "/in/:token": links.route as never, "/scan": scan },
  session: sessions.of,
  store: stories, // the stories begin and end each story on the store, Postgres (./store.ts)
};

/** The server: on `PORT` (3000), and with `--model` (`bun dev`) the model's page beside the app. */
export async function startServer({ port = Number(process.env.PORT ?? 3000), model = process.argv.includes("--model") } = {}) {
  const modelling = model && (await (await import("dzql/model")).modelRoute({ port: String(port), file: `${import.meta.dir}/model.json`, out: `${import.meta.dir}/model` }));
  const server = serve(compose(appOf(app), modelling), { port });
  console.log(["The staff, signed in by a link:", ...links.say(server.url.origin).map((l) => `  ${l}`)].join("\n"));
  return server;
}

if (import.meta.main) await run(startServer);
