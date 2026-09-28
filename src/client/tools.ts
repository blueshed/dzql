import type { PatchOp } from "../json-patch";
import { groupOf, rendered, type Field } from "./form-value";

// The page's writes as tools for an assistant (todo n99). Every control a person could press on the
// page now is a tool, read from what the page already says -- a form's `data-write`, an editing
// form's fields', a button's or a row's, an applet's `data-writes` -- and undo and redo are two
// more. A tool makes the write its control would; the server permits it or not, as it does a
// person's, so nothing here is a gate: an input schema says what the page offers, and a tool sends
// what it is given. Registered with WebMCP where the browser has it (`offerer`), and listed on
// `window.eta.tools()` wherever it does not.

/** A JSON Schema, as much of one as a tool's input needs. */
export type Schema = { type?: string; enum?: unknown[]; format?: string; pattern?: string; minimum?: number; description?: string; properties?: Record<string, Schema>; required?: string[] };

export type Write = { doc: string; ops: PatchOp[] };

/** A tool: what WebMCP registers, and the write it makes of an input -- or why it makes none. */
export type Tool = { name: string; title: string; description: string; inputSchema: Schema; write(input: Record<string, unknown>): Write | string };

type Spec = { doc: string; op: PatchOp["op"]; path: string; values?: unknown[] };

/** Can a person press it now: not inert, hidden, nor disabled, itself or by what it is in (the stories' rule). */
const pressable = (el: Element): boolean => !el.closest("[inert],[hidden]") && !el.matches(":disabled");

const words = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

/** What a person reads an element as: its aria-label, its title, or its text. */
const said = (el: Element | null): string => (el ? words(el.getAttribute("aria-label")) || words(el.getAttribute("title")) || words(el.textContent) : "");

/** What a form is called: its aria-label or title, its legend, or what its button says. */
const titleOf = (form: HTMLFormElement): string =>
  words(form.getAttribute("aria-label")) || words(form.getAttribute("title")) || said(form.querySelector("legend")) || said(form.querySelector("button:not([type=button],[type=reset])"));

/** What a field is called: its label, aria-label, placeholder, or name. */
const called = (field: Field): string => said(field.labels?.[0] ?? null) || words(field.getAttribute("aria-label")) || words(field.getAttribute("placeholder")) || field.name;

/**
 * A tool's name, from the write it makes, so it stays the same while the control does: `add.room.messages.-`
 * for `add /messages/-` on `room`. WebMCP takes letters, digits, `_`, `-` and `.`, at most 128: a
 * name that loses anything to that is told apart by a hash of what it was.
 */
function nameOf(verb: string, doc: string, path: string): string {
  const dotted = `${verb}.${doc}${path}`.replace(/[:/]+/g, ".").replace(/\.$/, "");
  const name = dotted.replace(/[^\w.-]/g, "_");
  if (name === dotted && name.length <= 128) return name;
  let h = 5381;
  for (const c of dotted) h = (Math.imul(h, 33) ^ c.codePointAt(0)!) >>> 0;
  return `${name.slice(0, 100)}-${h.toString(36)}`;
}

const writes = ({ op, path, doc }: Spec): string => `${op} ${path || "/"} on ${doc}`;
const specOf = (el: HTMLElement): Spec => JSON.parse(el.dataset.write!);
const box = (field: Field): boolean => field instanceof HTMLInputElement && field.type === "checkbox";

/** A field's input, as it holds one: a box true or false, a choice one of those offered, else text. */
function schemaOf(field: Field): Schema {
  const description = called(field);
  if (box(field)) return { type: "boolean", description };
  if (field instanceof HTMLSelectElement) return { enum: [...field.options].filter((o) => !o.disabled).map((o) => o.value), description };
  if (field instanceof HTMLInputElement && field.type === "radio") return { enum: groupOf(field).filter(pressable).map((r) => r.value), description };
  const format = field instanceof HTMLInputElement && ({ date: "date", time: "time", email: "email", url: "uri" } as Record<string, string>)[field.type];
  return { type: "string", description, ...(format && { format }) };
}

/** What a field sends of `given`, as a person's form would: a box a tick, anything else text. */
const sent = (field: Field, given: unknown): unknown => (box(field) || given == null ? given : String(given));

/** A form that creates: sends its one field's value, or a record of its fields, as on submit (form-value.ts); a field the page fills (hidden, readonly) as the page filled it. */
function formTool(form: HTMLFormElement): Tool {
  const spec = specOf(form);
  const fields = new Map<string, Field>();
  for (const el of form.elements as unknown as Iterable<Field>) {
    if (el.name && !el.matches(":disabled,button,[type=submit],[type=button],[type=reset],[type=image],[type=file]") && !fields.has(el.name)) fields.set(el.name, el);
  }
  const asked = [...fields].filter(([, f]) => !(f as HTMLInputElement).readOnly && f.type !== "hidden");
  const title = titleOf(form) || writes(spec);
  const required = asked.filter(([, f]) => f.required).map(([name]) => name);
  return {
    name: nameOf(spec.op, spec.doc, spec.path),
    title,
    description: `${title}: the form that ${writes(spec)}.`,
    inputSchema: { type: "object", properties: Object.fromEntries(asked.map(([name, f]) => [name, schemaOf(f)])), required },
    write(input) {
      const missing = required.filter((name) => input[name] == null);
      if (missing.length) return `Give ${missing.join(", ")}.`;
      const value = Object.fromEntries([...fields].map(([name, f]) => [name, asked.some(([n]) => n === name) && name in input ? sent(f, input[name]) : rendered(f)]));
      return { doc: spec.doc, ops: [{ op: spec.op, path: spec.path, value: fields.size > 1 ? value : Object.values(value)[0] }] };
    },
  };
}

/** An editing form: one tool a document, each field it edits an input -- several set in one write, as the form commits them. */
function editTools(form: HTMLFormElement): Tool[] {
  const byDoc = new Map<string, [string, Field, Spec][]>();
  for (const el of form.querySelectorAll<Field & HTMLElement>("input[data-write],textarea[data-write],select[data-write]:not([multiple])")) {
    if (!pressable(el)) continue;
    const spec = specOf(el);
    const key = el.name || spec.path.split("/").at(-1)!;
    const fields = byDoc.get(spec.doc) ?? [];
    if (!fields.some(([k]) => k === key)) fields.push([key, el, spec]);
    byDoc.set(spec.doc, fields);
  }
  return [...byDoc].map(([doc, fields]) => {
    const keys = fields.map(([key]) => key).join(", ");
    const title = titleOf(form) || `Edit ${keys}`;
    // named by the path its fields share: /stops/4 for /stops/4/title and /stops/4/kind
    const paths = fields.map(([, , spec]) => spec.path.split("/"));
    let shared = 0;
    while (paths.every((p) => shared < p.length - 2 && p[shared + 1] === paths[0]![shared + 1])) shared++;
    return {
      name: nameOf("edit", doc, paths[0]!.slice(0, shared + 1).join("/")),
      title,
      description: `${title}: sets any of ${keys} on ${doc}, in one write.`,
      inputSchema: { type: "object", properties: Object.fromEntries(fields.map(([key, f]) => [key, schemaOf(f)])) },
      write(input) {
        const ops = fields.filter(([key]) => key in input).map(([key, f, spec]) => ({ op: spec.op, path: spec.path, value: sent(f, input[key]) }));
        return ops.length ? { doc, ops } : `Give one or more of ${keys}.`;
      },
    };
  });
}

/** Buttons and rows that make one write: one tool, its value one of theirs where they send several. */
function pressTool(presses: HTMLElement[]): Tool {
  const spec = specOf(presses[0]!);
  const values = [...new Set(presses.map((el) => el.dataset.value))];
  const labels = [...new Set(presses.map(said))];
  const title = labels.length === 1 && labels[0] ? labels[0] : writes(spec);
  const choose = values.length > 1;
  return {
    name: nameOf(spec.op, spec.doc, spec.path),
    title,
    description: choose ? `${writes(spec)}, as these do: ${presses.map((el) => `${JSON.stringify(el.dataset.value ?? null)} ${said(el)}`).join("; ")}.` : `${title}: ${writes(spec)}.`,
    inputSchema: { type: "object", properties: choose ? { value: { enum: values.filter((v) => v !== undefined) } } : {} },
    write: (input) => ({ doc: spec.doc, ops: [{ op: spec.op, path: spec.path, value: choose ? input.value : values[0] }] }),
  };
}

/** What an applet says its controls write (`appletWrites`): a `*` segment is any one member, named in the input's path. */
function appletTools(applet: HTMLElement): Tool[] {
  const title = said(applet) || applet.dataset.applet!;
  return (JSON.parse(applet.dataset.writes!) as Spec[]).map((d) => {
    const any = d.path.includes("*");
    const pattern = `^${d.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "(?!-/|-$)[^/]+")}$`;
    const properties: Record<string, Schema> = {
      ...(any && { path: { type: "string", pattern, description: `${d.path}, each * an id` } }),
      ...(d.op !== "remove" && { value: d.values ? { enum: d.values } : { description: "what the control sends" } }),
    };
    return {
      name: nameOf(d.op, d.doc, d.path),
      title,
      description: `${title}: ${writes(d)}.`,
      inputSchema: { type: "object", properties, required: Object.keys(properties) },
      write(input) {
        const path = any ? String(input.path) : d.path;
        if (!new RegExp(pattern).test(path)) return `path is ${d.path}, each * an id`;
        return { doc: d.doc, ops: [{ op: d.op, path, ...(d.op !== "remove" && { value: input.value }) }] };
      },
    };
  });
}

/** The ledger write that walks the session's last change, or the one `entry` names (the entry a tool's answer gave). */
export function walked(way: "undo" | "redo", entry?: unknown): Write | string {
  if (entry !== undefined && !(Number.isSafeInteger(entry) && (entry as number) > 0)) return "entry is the number a tool's answer gave";
  return { doc: "ledger", ops: [{ op: way === "undo" ? "remove" : "add", path: `/${entry ?? "latest"}` }] };
}

const walkTool = (way: "undo" | "redo"): Tool => ({
  name: way,
  title: way[0]!.toUpperCase() + way.slice(1),
  description: `${way === "undo" ? "Undoes" : "Redoes"} the last change made on this page -- by you or the person -- or, given entry, that change alone: the entry a tool's answer gave.`,
  inputSchema: { type: "object", properties: { entry: { type: "integer", minimum: 1 } } },
  write: (input) => walked(way, input.entry),
});

/**
 * The tools the page in `root` offers now, in its order, then undo and redo. Where two kinds of
 * control make one write -- the buttons into the rooms there are, and the form that names a new
 * one -- the later is told apart by its kind (`replace.session.room.form`).
 */
export function pageTools(root: Element): Tool[] {
  const found: [kind: string, made: Tool | HTMLElement[]][] = []; // a tool, or the presses that make one write, in the page's order
  const presses = new Map<string, HTMLElement[]>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-write],form[data-write-on],[data-applet][data-writes]")) {
    if (!pressable(el)) continue;
    if (el instanceof HTMLFormElement) for (const t of el.dataset.writeOn ? editTools(el) : [formTool(el)]) found.push(["form", t]);
    else if (el.dataset.applet) for (const t of appletTools(el)) found.push(["applet", t]);
    else if (!el.matches("input,textarea,select") && specOf(el).doc !== "ledger") {
      // a field's write is its form's; the ledger's are undo and redo
      const key = el.dataset.write!;
      if (!presses.has(key)) found.push(["press", presses.set(key, []).get(key)!]);
      presses.get(key)!.push(el);
    }
  }
  const tools: Tool[] = [];
  for (const [kind, made] of [...found, ["", walkTool("undo")], ["", walkTool("redo")]] as typeof found) {
    const tool = Array.isArray(made) ? pressTool(made) : made;
    const name = tools.some((t) => t.name === tool.name) ? `${tool.name}.${kind}` : tool.name;
    if (!tools.some((t) => t.name === name)) tools.push({ ...tool, name });
  }
  return tools;
}

/** A model context, as the WebMCP draft has it (`document.modelContext`), or as Chromium had it before (`navigator.modelContext`, a handle to unregister). */
export type ModelContext = { registerTool(tool: object, options: { signal: AbortSignal }): unknown };

/** The browser's model context, if it has one. */
export function modelContext(): ModelContext | undefined {
  const context = (document as { modelContext?: ModelContext }).modelContext ?? (navigator as { modelContext?: ModelContext }).modelContext;
  return typeof context?.registerTool === "function" ? context : undefined;
}

/**
 * Keeps a model context told of the page's tools: each registered once, and withdrawn (its signal
 * aborted) when the page no longer offers it, or offers it changed, then registered anew. A tool's
 * `execute` runs `use`, by name, against the page as it is then. A registration refused (a document
 * the browser will not let register) is tried again at the next drawing.
 */
export function offerer(use: (name: string, input: unknown) => Promise<unknown>) {
  const registered = new Map<string, [key: string, stop: AbortController]>();
  return (context: ModelContext, tools: Tool[]): void => {
    const keys = new Map(tools.map(({ name, title, description, inputSchema }) => [name, JSON.stringify([title, description, inputSchema])]));
    for (const [name, [key, stop]] of registered) {
      if (keys.get(name) === key) continue;
      stop.abort();
      registered.delete(name);
    }
    for (const { name, title, description, inputSchema } of tools) {
      if (registered.has(name)) continue;
      const stop = new AbortController();
      const forget = () => registered.get(name)?.[1] === stop && registered.delete(name);
      registered.set(name, [keys.get(name)!, stop]);
      try {
        const done = context.registerTool({ name, title, description, inputSchema, execute: (input: unknown) => use(name, input) }, { signal: stop.signal });
        Promise.resolve(done).catch(forget);
        const unregister = (done as { unregister?: () => void } | undefined)?.unregister;
        if (unregister) stop.signal.addEventListener("abort", () => unregister());
      } catch {
        forget();
      }
    }
  };
}
