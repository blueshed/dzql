import type { PatchOp } from "../json-patch";
import { afterDrawing, ask, walked, type Answer, type Write } from "./app";
import { isBox, rendered, type Field } from "./form-value";

// The page's writes as tools for an assistant (todo n99), for an app that opts in: its client/main.ts
// imports this after the kernel's client, `import "eta/src/client/tools"`. Every control a person
// could press on the page now, that the app has labelled, is a tool -- a form, an editing form, the
// buttons and rows of one label, an applet's `data-writes` -- and undo and redo are two more. A
// tool makes the write its control would; the server permits it or not, as it does a person's.
//
// A tool is named and described only in the app's own words: the label it gave the control (an
// aria-label, a form's legend, a field's label), never what the control shows, which may be anyone's
// words -- a room's name, a message -- and an assistant reads a tool's description as an instruction.
// So a tool stays as it is while the page's content changes, and is registered once. After each
// drawing the tools are registered with WebMCP where the browser has it (`document.modelContext`),
// and `window.eta.tools()` and `use(name, input)` list and run them wherever it does not.

/** A JSON Schema, as much of one as a tool's input needs. */
export type Schema = { type?: string; enum?: unknown[]; format?: string; pattern?: string; description?: string; properties?: Record<string, Schema>; required?: string[] };

/** A tool: what WebMCP registers, and the write it makes of an input -- or why it makes none. */
export type Tool = { name: string; title: string; description: string; inputSchema: Schema; write(input: Record<string, unknown>): Write | string };

type Spec = { doc: string; op: PatchOp["op"]; path: string; values?: unknown[] };

/** Can a person press it now: not inert, hidden, nor disabled, itself or by what it is in (the stories' rule). */
const pressable = (el: Element): boolean => !el.closest("[inert],[hidden]") && !el.matches(":disabled");

/** The longest label a tool takes of the app's. */
const MOST_SAID = 80;
const words = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim().slice(0, MOST_SAID);

const isField = (el: Element): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

/** The label the app gave a control: its aria-label; a form's legend; a field's label. Never what it shows. */
const labelOf = (el: Element): string =>
  words(el.getAttribute("aria-label")) || words((el instanceof HTMLFormElement ? el.querySelector("legend") : isField(el) ? el.labels?.[0] : null)?.textContent);

/** A name WebMCP takes, of the app's words: `Say something` is `say_something`; the parts of one apart by dots. */
const nameOf = (...parts: string[]): string =>
  parts.map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")).filter(Boolean).join(".").slice(0, 64);

const specOf = (el: HTMLElement): Spec => JSON.parse(el.dataset.write!);

/** A field's input, as it holds one: a box true or false, else text; described by its label. */
function schemaOf(field: Field): Schema {
  const description = labelOf(field) || undefined;
  if (isBox(field)) return { type: "boolean", description };
  const format = field instanceof HTMLInputElement && ({ date: "date", time: "time", email: "email", url: "uri" } as Record<string, string>)[field.type];
  return { type: "string", description, ...(format && { format }) };
}

/** What a field sends of `given`, as a person's form would: a box a tick, anything else text. */
const sent = (field: Field, given: unknown): unknown => (isBox(field) || given == null ? given : String(given));

/** A form that creates: sends its one field's value, or a record of its fields, as on submit (form-value.ts); a field the page fills (hidden, readonly) as the page filled it. */
function formTool(form: HTMLFormElement, label: string): Tool {
  const spec = specOf(form);
  const fields = new Map<string, Field>();
  for (const el of form.elements as unknown as Iterable<Field>) {
    if (el.name && el.matches("input,select,textarea") && !el.matches(":disabled,[type=submit],[type=button],[type=reset],[type=image],[type=file]") && !fields.has(el.name)) fields.set(el.name, el);
  }
  const asked = [...fields].filter(([, f]) => !(f as HTMLInputElement).readOnly && f.type !== "hidden");
  const required = asked.filter(([, f]) => f.required).map(([name]) => name);
  return {
    name: nameOf(label),
    title: label,
    description: `${label}: a form${asked.length ? ` of ${asked.map(([name]) => name).join(", ")}` : ""}.`,
    inputSchema: { type: "object", properties: Object.fromEntries(asked.map(([name, f]) => [name, schemaOf(f)])), required },
    write(input) {
      const missing = required.filter((name) => input[name] == null);
      if (missing.length) return `Give ${missing.join(", ")}.`;
      const value = Object.fromEntries([...fields].map(([name, f]) => [name, asked.some(([n]) => n === name) && name in input ? sent(f, input[name]) : rendered(f)]));
      return { doc: spec.doc, ops: [{ op: spec.op, path: spec.path, value: fields.size > 1 ? value : Object.values(value)[0] }] };
    },
  };
}

/** An editing form: one tool, each field it edits an input, keyed by its name -- several set in one write, as the form commits them. */
function editTool(form: HTMLFormElement, label: string): Tool | undefined {
  const fields: [string, Field, Spec][] = [];
  for (const el of form.querySelectorAll<Field & HTMLElement>("input[data-write],textarea[data-write],select[data-write]:not([multiple])")) {
    const spec = specOf(el);
    const key = el.name || spec.path.split("/").at(-1)!;
    if (pressable(el) && !fields.some(([k]) => k === key)) fields.push([key, el, spec]);
  }
  if (!fields.length) return undefined;
  const keys = fields.map(([key]) => key).join(", ");
  return {
    name: nameOf(label),
    title: label,
    description: `${label}: sets any of ${keys}, in one write.`,
    inputSchema: { type: "object", properties: Object.fromEntries(fields.map(([key, f]) => [key, schemaOf(f)])) },
    write(input) {
      const given = fields.filter(([key]) => key in input);
      if (!given.length) return `Give one or more of ${keys}.`;
      return { doc: given[0]![2].doc, ops: given.map(([key, f, spec]) => ({ op: spec.op, path: spec.path, value: sent(f, input[key]) })) };
    },
  };
}

/** The buttons and rows of one label: one tool, told which to press by what differs between their writes, its path or its value. */
function pressTool(label: string, presses: HTMLElement[]): Tool {
  const writes = presses.map((el) => ({ ...specOf(el), value: el.dataset.value }));
  const asks = (["path", "value"] as const).filter((k) => new Set(writes.map((w) => w[k])).size > 1);
  return {
    name: nameOf(label),
    title: label,
    description: asks.length ? `${label}: give the ${asks.join(" and ")} of the one to press, as the page's markup says.` : `${label}.`,
    inputSchema: { type: "object", properties: Object.fromEntries(asks.map((k) => [k, { type: "string" }])), required: [...asks] },
    write(input) {
      const w = writes.find((w) => asks.every((k) => w[k] === input[k]));
      return w ? { doc: w.doc, ops: [{ op: w.op, path: w.path, value: w.value }] } : `That is none of the page's ${label}.`;
    },
  };
}

/** What an applet says its controls write (`appletWrites`, the app's own words): a `*` segment is any one member, named in the input's path. */
function appletTools(applet: HTMLElement, label: string): Tool[] {
  return (JSON.parse(applet.dataset.writes!) as Spec[]).map((d) => {
    const any = d.path.includes("*");
    const pattern = `^${d.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "(?!-/|-$)[^/]+")}$`;
    const properties: Record<string, Schema> = {
      ...(any && { path: { type: "string", pattern, description: `${d.path}, each * an id` } }),
      ...(d.op !== "remove" && { value: d.values ? { enum: d.values } : { description: "what the control sends" } }),
    };
    return {
      name: nameOf(label, d.op, d.path.replaceAll("*", "")),
      title: label,
      description: `${label}: ${d.op} ${d.path}.`,
      inputSchema: { type: "object", properties, required: Object.keys(properties) },
      write(input) {
        const path = any ? String(input.path) : d.path;
        if (!new RegExp(pattern).test(path)) return `path is ${d.path}, each * an id`;
        return { doc: d.doc, ops: [{ op: d.op, path, ...(d.op !== "remove" && { value: input.value }) }] };
      },
    };
  });
}

const walkTool = (way: "undo" | "redo"): Tool => ({
  name: way,
  title: way[0]!.toUpperCase() + way.slice(1),
  description: `${way === "undo" ? "Undoes" : "Redoes"} the last change made in this browser's session -- yours or the person's -- or, given change, that change alone: the handle a tool's answer gave.`,
  inputSchema: { type: "object", properties: { change: { type: "string" } } },
  write: (input) => walked(way, input.change),
});

/**
 * The tools the page in `root` offers now, in its order, then undo and redo: each labelled control a
 * person could press. Where two kinds of control take one label -- the form that names a new room,
 * the buttons into the rooms there are -- the later is told apart by its kind (`go_in.form`).
 */
export function pageTools(root: Element): Tool[] {
  const found: [kind: string, made: Tool | [string, HTMLElement[]]][] = []; // a tool, or the presses of one label, in the page's order
  const presses = new Map<string, HTMLElement[]>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-write],form[data-write-on],[data-applet][data-writes]")) {
    const label = labelOf(el);
    if (!pressable(el) || !nameOf(label)) continue;
    if (el instanceof HTMLFormElement) {
      const tool = el.dataset.writeOn ? editTool(el, label) : formTool(el, label);
      if (tool) found.push(["form", tool]);
    } else if (el.dataset.applet) for (const t of appletTools(el, label)) found.push(["applet", t]);
    else if (!isField(el) && specOf(el).doc !== "ledger") {
      // a field's write is its form's; the ledger's are undo and redo
      if (!presses.has(label)) found.push(["press", [label, presses.set(label, []).get(label)!]]);
      presses.get(label)!.push(el);
    }
  }
  const tools: Tool[] = [];
  for (const [kind, made] of [...found, ["", walkTool("undo")], ["", walkTool("redo")]] as typeof found) {
    const tool = Array.isArray(made) ? pressTool(...made) : made;
    const name = tools.some((t) => t.name === tool.name) ? `${tool.name}.${kind}` : tool.name;
    if (!tools.some((t) => t.name === name)) tools.push({ ...tool, name });
  }
  return tools;
}

/** A model context, as the WebMCP draft has it (`document.modelContext`): enough to register a tool with it. */
type ModelContext = { registerTool(tool: object, options: { signal: AbortSignal }): Promise<unknown> };

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
      registered.set(name, [keys.get(name)!, stop]);
      new Promise((done) => done(context.registerTool({ name, title, description, inputSchema, execute: (input: unknown) => use(name, input) }, { signal: stop.signal }))).catch(
        () => registered.get(name)?.[1] === stop && registered.delete(name),
      );
    }
  };
}

const app = document.querySelector<HTMLElement>("#app")!;

/** Uses a tool the page offers now, by name, and answers what came of it. */
function use(name: string, input?: unknown): Promise<Answer> {
  const tool = pageTools(app).find((t) => t.name === name);
  return ask(tool ? tool.write(input && typeof input === "object" ? (input as Record<string, unknown>) : {}) : `This page offers no ${name} now: ask for its tools again.`);
}

const offer = offerer(use);
afterDrawing(() => {
  const context = (document as { modelContext?: ModelContext }).modelContext;
  if (typeof context?.registerTool === "function") offer(context, pageTools(app));
});
Object.assign(window.eta!, { tools: () => pageTools(app).map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })), use });
