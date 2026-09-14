import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../server";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(0);
});

afterAll(() => {
  server.stop(true);
});

async function waitFor(
  view: Bun.WebView,
  script: string,
  predicate: (value: unknown) => boolean,
  timeout = 5000,
): Promise<unknown> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}

const NAME_FORM_VISIBLE = `document.querySelector('#name') !== null`;
const ROOM_FORM_VISIBLE = `document.querySelector('#room') !== null`;
const USER_LABEL = `document.querySelector('.user-label')?.textContent ?? null`;
const MESSAGES_TEXT = `document.querySelector('.messages')?.textContent ?? ""`;
const LOGOUT_SELECTOR = `[data-write='{"doc":"session","op":"remove","path":"/name"}']`;
const LEAVE_ROOM_SELECTOR = `[data-write='{"doc":"session","op":"remove","path":"/room"}']`;
const SEND_MESSAGE_FORM_VISIBLE = `document.querySelector('[data-write=\\'{"doc":"room","op":"add","path":"/transcript/-"}\\']') !== null`;

async function submitName(view: Bun.WebView, name: string) {
  await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  await view.click("#name");
  await view.type(name);
  await view.click("button[type=submit]");
}

async function joinRoom(view: Bun.WebView, room: string) {
  await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
  await view.click("#room");
  await view.type(room);
  await view.press("Enter");
}

async function sendChatMessage(view: Bun.WebView, text: string) {
  await view.click("input[name=text]");
  await view.type(text);
  await view.click("button[type=submit]");
}

describe("app.ts in a real browser", () => {
  test("a fresh session shows the name form, then the user bar after submitting", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Ada");

    const label = await waitFor(view, USER_LABEL, (v) => v === "Ada");
    expect(label).toBe("Ada");
  });

  test("the session survives a reload via the session cookie", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Grace");
    await waitFor(view, USER_LABEL, (v) => v === "Grace");

    await view.reload();

    const label = await waitFor(view, USER_LABEL, (v) => v === "Grace");
    expect(label).toBe("Grace");
  });

  test("reconnection backoff resets after a successful reconnect, rather than compounding", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    const socketOpen = `window.eta?.socket()?.readyState === WebSocket.OPEN`;
    const reconnectDelay = `window.eta?.reconnectDelay()`;

    await waitFor(view, socketOpen, (v) => v === true);
    expect((await view.evaluate(reconnectDelay)) as number).toBe(1000);

    // drop the connection: the backoff scales up, then the (real, always-up) server
    // lets the client reconnect on its own.
    await view.evaluate(`window.eta.socket().close()`);
    const escalated = await waitFor(view, reconnectDelay, (v) => v === 2000);
    expect(escalated).toBe(2000);
    await waitFor(view, socketOpen, (v) => v === true);

    // the reconnect just succeeded: the backoff must be reset to the initial delay,
    // not left at the escalated value it reached while disconnected.
    expect((await view.evaluate(reconnectDelay)) as number).toBe(1000);
  });

  test("logout clears the session and shows the name form again", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Linus");
    await waitFor(view, USER_LABEL, (v) => v === "Linus");

    await view.click(LOGOUT_SELECTOR);

    await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  });

  test("joining a room then changing room returns to the room selector", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Chatter-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    await waitFor(view, SEND_MESSAGE_FORM_VISIBLE, (v) => v === true);

    await view.click(LEAVE_ROOM_SELECTOR);

    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
  });

  test("the room picker filters suggestions as you type, without a round trip", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Filter-${crypto.randomUUID()}`);

    const alpha = `alpha-${crypto.randomUUID()}`;
    const beta = `beta-${crypto.randomUUID()}`;
    await joinRoom(view, alpha);
    await view.click(LEAVE_ROOM_SELECTOR);
    await joinRoom(view, beta);
    await view.click(LEAVE_ROOM_SELECTOR);

    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
    await view.click("#room");
    await view.type("alpha");

    const suggestions = await waitFor(
      view,
      `[...document.querySelectorAll('.room-picker-suggestions li')].map(li => li.textContent)`,
      (v) => Array.isArray(v) && v.includes(alpha),
    );

    expect(suggestions).toContain(alpha);
    expect(suggestions).not.toContain(beta);
  });

  test("clicking a suggested room joins it", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Clicker-${crypto.randomUUID()}`);

    const target = `click-target-${crypto.randomUUID()}`;
    await joinRoom(view, target); // creates it
    await view.click(LEAVE_ROOM_SELECTOR);

    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
    await view.click("#room");
    await view.type(target);
    await waitFor(
      view,
      `document.querySelector('.room-picker-suggestions li')?.textContent ?? null`,
      (v) => v === target,
    );

    await view.click(".room-picker-suggestions li");

    await waitFor(
      view,
      `document.querySelector('.room-label')?.textContent ?? ""`,
      (v) => typeof v === "string" && v.includes(target),
    );
  });

  test("a sent chat message appears in the message list", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Chatter-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    const text = `hello room ${crypto.randomUUID()}`;
    await sendChatMessage(view, text);

    const messages = await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));
    expect(messages).toContain(text);
  });

  test("a sent message clears the input, but a rejected (blank) one hands the text back", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Typist-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    // whitespace-only passes the input's `required` check but is rejected server-side
    // (no patch echo), so the form must not reset -- the write was refused, not lost.
    await view.click("input[name=text]");
    await view.type("   ");
    await view.click("button[type=submit]");
    await Bun.sleep(200);
    expect((await view.evaluate(`document.querySelector('input[name=text]').value`)) as string).toBe("   ");

    await view.evaluate(`document.querySelector('input[name=text]').value = ""`);
    const text = `real message ${crypto.randomUUID()}`;
    await sendChatMessage(view, text);
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));

    // this write was echoed (applied), so the form resets
    expect((await view.evaluate(`document.querySelector('input[name=text]').value`)) as string).toBe("");
  });

  test("new messages are morphed in without replacing the existing message list DOM node", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Persist-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    await sendChatMessage(view, "first message");
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("first message"));

    // Tag the live node with a JS property (not an attribute -- morph legitimately
    // reconciles attributes against the server HTML, which would strip one). A
    // replaced node would come back without this; a morphed one keeps it.
    await view.evaluate(`document.querySelector('.messages')._probe = "untouched"`);

    await sendChatMessage(view, "second message");
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("second message"));

    const marker = await view.evaluate(`document.querySelector('.messages')._probe`);
    expect(marker).toBe("untouched");
  });

  test("a presence-only update does not reset the message list scroll position", async () => {
    await using viewA = new Bun.WebView();
    await using viewB = new Bun.WebView();

    await viewA.navigate(server.url.toString());
    await submitName(viewA, `ScrollA-${crypto.randomUUID()}`);
    const room = crypto.randomUUID();
    await joinRoom(viewA, room);

    for (let i = 0; i < 15; i++) {
      await sendChatMessage(viewA, `filler message ${i}`);
    }
    await waitFor(viewA, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("filler message 14"));

    // confirm the list actually overflows, so scrollTop 0 vs "at the bottom" is a real distinction
    const overflows = await viewA.evaluate(
      `document.querySelector('.messages').scrollHeight > document.querySelector('.messages').clientHeight`,
    );
    expect(overflows).toBe(true);

    // scroll away from the bottom, simulating a user reading older messages
    await viewA.evaluate(`document.querySelector('.messages').scrollTop = 0`);
    const scrollTopScript = `document.querySelector('.messages').scrollTop`;
    expect((await viewA.evaluate(scrollTopScript)) as number).toBe(0);

    // someone else joining the room triggers a .people-only broadcast to viewA, unrelated to .messages
    await viewB.navigate(server.url.toString());
    await submitName(viewB, `ScrollB-${crypto.randomUUID()}`);
    await joinRoom(viewB, room);
    await waitFor(
      viewA,
      `document.querySelector('.people')?.textContent ?? ""`,
      (v) => typeof v === "string" && v.includes("ScrollB"),
    );

    expect((await viewA.evaluate(scrollTopScript)) as number).toBe(0);
  });

  test("a message sent from one browser appears live in another browser in the same room", async () => {
    await using viewA = new Bun.WebView();
    await using viewB = new Bun.WebView();

    await viewA.navigate(server.url.toString());
    await viewB.navigate(server.url.toString());

    await submitName(viewA, `A-${crypto.randomUUID()}`);
    await submitName(viewB, `B-${crypto.randomUUID()}`);

    const room = crypto.randomUUID();
    await joinRoom(viewA, room);
    await joinRoom(viewB, room);

    const text = `broadcast test ${crypto.randomUUID()}`;
    await sendChatMessage(viewA, text);

    await waitFor(viewB, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));
  });

  test("browser A's half-typed message and caret survive a re-render triggered by browser B", async () => {
    await using viewA = new Bun.WebView();
    await using viewB = new Bun.WebView();

    await viewA.navigate(server.url.toString());
    await viewB.navigate(server.url.toString());

    await submitName(viewA, `TypistA-${crypto.randomUUID()}`);
    await submitName(viewB, `TypistB-${crypto.randomUUID()}`);

    const room = crypto.randomUUID();
    await joinRoom(viewA, room);
    await joinRoom(viewB, room);

    const halfMessage = "half a mess";
    await viewA.click("input[name=text]");
    await viewA.type(halfMessage);
    await viewA.evaluate(`document.querySelector('input[name=text]').setSelectionRange(3, 3)`);

    const text = `from B ${crypto.randomUUID()}`;
    await sendChatMessage(viewB, text);

    // A re-renders as a consequence of B's message -- morphing, not replacing,
    // is what should let its own half-typed text and caret survive that.
    await waitFor(viewA, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));

    expect((await viewA.evaluate(`document.querySelector('input[name=text]').value`)) as string).toBe(halfMessage);
    expect(
      (await viewA.evaluate(`document.activeElement === document.querySelector('input[name=text]')`)) as boolean,
    ).toBe(true);
    expect((await viewA.evaluate(`document.querySelector('input[name=text]').selectionStart`)) as number).toBe(3);
  });

  test("eta.docs() gains an add /transcript/- op when another browser sends a message", async () => {
    await using viewA = new Bun.WebView();
    await using viewB = new Bun.WebView();

    await viewA.navigate(server.url.toString());
    await viewB.navigate(server.url.toString());

    await submitName(viewA, `EchoA-${crypto.randomUUID()}`);
    await submitName(viewB, `EchoB-${crypto.randomUUID()}`);

    const room = crypto.randomUUID();
    await joinRoom(viewA, room);
    await joinRoom(viewB, room);

    const text = `echo test ${crypto.randomUUID()}`;
    await sendChatMessage(viewA, text);

    // request 3 onward: doc is the bare type ("room"), not a concrete id -- a
    // connection only ever sees one room doc at a time, so no id is needed.
    const gainedOp = `window.eta.docs()['room']?.ops.some(
      (op) => op.op === "add" && op.path === "/transcript/-" && op.value.text === ${JSON.stringify(text)}
    ) ?? false`;
    await waitFor(viewB, gainedOp, (v) => v === true);

    // the version tracked alongside it is a real, positive document version, not just a message counter
    const version = await viewB.evaluate(`window.eta.docs()['room']?.version`);
    expect(typeof version).toBe("number");
    expect(version as number).toBeGreaterThan(0);
  });

  test("eta.inspect() reports the last write sent and whether it was echoed", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Inspector-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    const text = `inspect this ${crypto.randomUUID()}`;
    await sendChatMessage(view, text);
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));

    const lastSentDoc = await waitFor(view, `window.eta.inspect().lastSent?.doc ?? null`, (v) => v === "room");
    expect(lastSentDoc).toBe("room");

    const echoed = await waitFor(view, `window.eta.inspect().lastSent?.echoed ?? false`, (v) => v === true);
    expect(echoed).toBe(true);

    expect((await view.evaluate(`"room" in window.eta.inspect().docs`)) as boolean).toBe(true);
  });
});
