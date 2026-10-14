import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { compileDomain } from "../../src/cli/compile.js";

// An entity whose only column is its primary key has nothing to UPDATE. The
// generated save used to emit `UPDATE t SET  WHERE ...`, which is invalid SQL,
// so the whole schema failed to load.
const domain = {
  entities: {
    users: {
      schema: {
        id: "serial PRIMARY KEY",
        email: "text UNIQUE NOT NULL",
        password_hash: "text",
      },
      hidden: ["password_hash"],
      permissions: { view: ["TRUE"], create: [], update: [], delete: [] },
    },
    face_acceptses: {
      schema: { id: "serial PRIMARY KEY" },
      permissions: {
        view: ["TRUE"],
        create: ["AUTHENTICATED"],
        update: ["AUTHENTICATED"],
        delete: ["AUTHENTICATED"],
      },
    },
    // Temporal: nothing beyond the key and the temporal fields.
    stamps: {
      schema: {
        id: "serial PRIMARY KEY",
        ref: "int NOT NULL",
        valid_from: "timestamptz NOT NULL DEFAULT now()",
        valid_to: "timestamptz",
      },
      temporal: { refField: "ref", validFrom: "valid_from", validTo: "valid_to" },
      permissions: {
        view: ["TRUE"],
        create: ["AUTHENTICATED"],
        update: ["AUTHENTICATED"],
        delete: ["AUTHENTICATED"],
      },
    },
  },
  subscribables: {},
};

describe("an entity whose only column is its primary key", () => {
  let db: V2TestDatabase;
  let sql: any;

  beforeAll(async () => {
    const log = console.log;
    console.log = () => {};
    const compiled = compileDomain(domain as any);
    console.log = log;

    db = new V2TestDatabase();
    sql = await db.setup();
    await sql.unsafe(compiled.coreSQL);
    await sql.unsafe(compiled.schemaSQL);
    await sql.unsafe(compiled.subscribableSQL);
    await sql`INSERT INTO users (id, email) VALUES (1, 'a@x')`;
  });

  afterAll(async () => {
    await db?.teardown();
  });

  test("save creates a row", async () => {
    const [{ r }] = await sql`SELECT dzql_v2.save_face_acceptses(1, '{}'::jsonb) AS r`;
    expect(typeof r.id).toBe("number");
    const rows = await sql`SELECT id FROM face_acceptses WHERE id = ${r.id}`;
    expect(rows.length).toBe(1);
  });

  test("save of an existing row is a no-op that returns it and still checks the update rule", async () => {
    const [{ r: created }] = await sql`SELECT dzql_v2.save_face_acceptses(1, '{}'::jsonb) AS r`;
    const [{ r }] = await sql`SELECT dzql_v2.save_face_acceptses(1, ${sql.json({ id: created.id })}) AS r`;
    expect(r).toEqual({ id: created.id });

    let err: any;
    try {
      await sql`SELECT dzql_v2.save_face_acceptses(${null}, ${sql.json({ id: created.id })})`;
    } catch (e) {
      err = e;
    }
    expect(err, "anonymous update should be refused").toBeDefined();
    expect(String(err.message)).toMatch(/permission_denied/);
  });

  test("temporal: saving an existing ref writes a new version", async () => {
    const [{ r: v1 }] = await sql`SELECT dzql_v2.save_stamps(1, '{}'::jsonb) AS r`;
    const [{ r: v2 }] = await sql`SELECT dzql_v2.save_stamps(1, ${sql.json({ ref: v1.ref })}) AS r`;
    expect(v2.ref).toBe(v1.ref);
    expect(v2.id).not.toBe(v1.id);
    const open = await sql`SELECT id FROM stamps WHERE ref = ${v1.ref} AND valid_to IS NULL`;
    expect(open.map((x: any) => x.id)).toEqual([v2.id]);
  });
});
