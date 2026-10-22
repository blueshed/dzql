import { expect, test } from "bun:test";
import type { ConnectionData } from "../../src/rendering/connection";
import { closeConnection, openConnection, setCookieIsSession, wireName } from "../../src/rendering/resources/audience";
import { scope } from "../../src/rendering/scope";

const tab = (sessionId: string) => ({ data: { sessionId } }) as unknown as Bun.ServerWebSocket<ConnectionData>;

// Naming each socket a change is told to asked whether the name's id was any open socket's
// session, going through every one: a change told to N sockets cost N times N.
test("whether a document's id is a live session's is asked of who is open by session, never of every open socket; a session is live while any tab of it is", () => {
  const was = setCookieIsSession(true);
  const me = tab("s-me");
  const [one, two] = [tab("s-other"), tab("s-other")];
  openConnection(one);
  openConnection(two);
  openConnection(two); // opened twice is open once
  const sockets = scope().openSockets;
  Object.defineProperty(sockets, Symbol.iterator, { configurable: true, value: () => { throw new Error("went through every open socket"); } });
  try {
    const refused = "month is keyed by a session id: declare its resource `perSession`, so the id never goes on the wire";
    expect(() => wireName("month", "s-other", me)).toThrow(refused);
    closeConnection(one);
    expect(() => wireName("month", "s-other", me)).toThrow(refused); // its other tab is open
    closeConnection(two);
    closeConnection(two); // closed twice is closed once
    expect(wireName("month", "s-other", me)).toBe("month:s-other"); // no longer anyone's live session
    expect(wireName("month", "s-me", me)).toBe("month");
  } finally {
    Reflect.deleteProperty(sockets, Symbol.iterator);
    closeConnection(one);
    closeConnection(two);
    setCookieIsSession(was);
  }
});
