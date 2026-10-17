import { describe, expect, test } from "bun:test";
import { parseCommand } from "dzql/rendering/cli/commands";
import { aliases } from "./cli";

describe("wedding's cli aliases", () => {
  test("each verb maps to its wire ops", () => {
    expect(parseCommand(["enter", "okafor"], aliases)).toEqual({ kind: "write", doc: "session", ops: [{ op: "replace", path: "/code", value: "okafor" }] });
    expect(parseCommand(["leave"], aliases)).toEqual({ kind: "write", doc: "session", ops: [{ op: "remove", path: "/code" }] });
    expect(parseCommand(["answer", "yes"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "replace", path: "/answer", value: "yes" }] });
    expect(parseCommand(["say", "see", "you", "there"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "replace", path: "/message", value: "see you there" }] });
    expect(parseCommand(["coming", "2", "no"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "replace", path: "/guests/2/coming", value: "no" }] });
    expect(parseCommand(["ask", "Kemi", "Okafor"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "add", path: "/asks/-", value: "Kemi Okafor" }] });
    expect(parseCommand(["claim", "3"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "add", path: "/claims/-", value: "3" }] });
    expect(parseCommand(["unclaim", "3"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "remove", path: "/claims/3" }] });
    expect(parseCommand(["reply", "1", "1", "yes"], aliases)).toEqual({ kind: "write", doc: "board", ops: [{ op: "replace", path: "/households/1/asks/1/reply", value: "yes" }] });
    expect(parseCommand(["invite", "g@example.com", "Grace,", "Ada"], aliases)).toEqual({ kind: "write", doc: "board", ops: [{ op: "add", path: "/households/-", value: { email: "g@example.com", names: "Grace, Ada" } }] });
  });

  test("a verb with its argument missing still builds a well-formed op, for the server to refuse", () => {
    expect(parseCommand(["answer"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "replace", path: "/answer", value: "" }] });
    expect(parseCommand(["coming"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "replace", path: "/guests//coming", value: "" }] });
    expect(parseCommand(["claim"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "add", path: "/claims/-", value: "" }] });
    expect(parseCommand(["unclaim"], aliases)).toEqual({ kind: "write", doc: "household", ops: [{ op: "remove", path: "/claims/" }] });
    expect(parseCommand(["reply"], aliases)).toEqual({ kind: "write", doc: "board", ops: [{ op: "replace", path: "/households//asks//reply", value: "" }] });
    expect(parseCommand(["invite"], aliases)).toEqual({ kind: "write", doc: "board", ops: [{ op: "add", path: "/households/-", value: { email: "", names: "" } }] });
  });

  test("undo stays the kernel's own generic command, not a wedding alias", () => {
    expect(parseCommand(["undo"], aliases)).toEqual({ kind: "write", doc: "ledger", ops: [{ op: "remove", path: "/latest" }] });
    expect(parseCommand(["dance"], aliases)).toBeUndefined();
  });
});
