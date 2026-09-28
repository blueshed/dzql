import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { urlFor, waitFor } from "../../../src/webview";
import { createServer } from "../../../src/server";
import { example } from "../index";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});


const NAME_FORM_VISIBLE = `document.querySelector('#name') !== null`;
const ROOM_FORM_VISIBLE = `document.querySelector('.cell.open[data-key="rooms"]') !== null`;
const USER_LABEL = `document.querySelector('.user-label')?.textContent ?? null`;
const MESSAGES_TEXT = `document.querySelector('.messages')?.textContent ?? ""`;
const LOGOUT_SELECTOR = `[data-write='{"doc":"session","op":"remove","path":"/name"}']`;
const LEAVE_ROOM_SELECTOR = `[data-write='{"doc":"session","op":"remove","path":"/room"}']`;
const SEND_MESSAGE_FORM_VISIBLE = `document.querySelector('[data-write=\\'{"doc":"room","op":"add","path":"/messages/-"}\\']') !== null`;

async function submitName(view: Bun.WebView, name: string) {
  await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  await view.click("#name");
  await view.type(name);
  await view.click("button[type=submit]");
}

// a room is made, and entered, by naming it in the form at the foot of the rooms
async function joinRoom(view: Bun.WebView, room: string) {
  await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
  await view.click("input[name=room]");
  await view.type(room);
  await view.press("Enter");
}

// the way out of a room is the "Chat" crumb, the root of the trail
async function leaveRoom(view: Bun.WebView) {
  await waitFor(view, `document.querySelector(\`${LEAVE_ROOM_SELECTOR}\`) !== null`, (v) => v === true);
  await view.evaluate(`document.querySelector(\`${LEAVE_ROOM_SELECTOR}\`).click()`);
}

async function sendChatMessage(view: Bun.WebView, text: string) {
  await view.click("input[name=text]");
  await view.type(text);
  await view.click("button[type=submit]");
}

/** Each field on the page, by its name, with the size of its text; and what the page says of the reader's zoom. */
const FIELDS = `[...document.querySelectorAll('input, select, textarea')].map((el) => el.name + ' ' + getComputedStyle(el).fontSize)`;
const VIEWPORT = `document.querySelector('meta[name=viewport]').content`;

describe("app.ts in a real browser", () => {
  test("on a phone no field is under 16px, so iOS does not zoom into it, and the reader may zoom", async () => {
    await using view = new Bun.WebView({ width: 375, height: 740 });
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
    expect(await view.evaluate<string>(VIEWPORT)).not.toMatch(/maximum-scale|user-scalable/);
    expect(await view.evaluate<string[]>(FIELDS)).toEqual(["name 16px"]);
    await submitName(view, "Iris");
    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
    expect(await view.evaluate<string[]>(FIELDS)).toEqual(["room 16px"]);
    await joinRoom(view, `phone-${crypto.randomUUID()}`);
    await waitFor(view, SEND_MESSAGE_FORM_VISIBLE, (v) => v === true);
    expect(await view.evaluate<string[]>(FIELDS)).toEqual(["text 16px"]);
  });

  test("a fresh session shows the name form, then the user bar after submitting", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));

    await submitName(view, "Ada");

    const label = await waitFor(view, USER_LABEL, (v) => v === "Ada");
    expect(label).toBe("Ada");
  });

  test("the session survives a reload via the session cookie", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));

    await submitName(view, "Grace");
    await waitFor(view, USER_LABEL, (v) => v === "Grace");

    await view.reload();

    const label = await waitFor(view, USER_LABEL, (v) => v === "Grace");
    expect(label).toBe("Grace");
  });

  test("reconnection backoff resets after a successful reconnect, rather than compounding", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));

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
    await view.navigate(urlFor(view, server.url));

    await submitName(view, "Linus");
    await waitFor(view, USER_LABEL, (v) => v === "Linus");

    await view.click(LOGOUT_SELECTOR);

    await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  });

  test("joining a room then changing room returns to the room selector", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await submitName(view, `Chatter-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    await waitFor(view, SEND_MESSAGE_FORM_VISIBLE, (v) => v === true);

    await leaveRoom(view);

    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
  });

  test("tapping a room's row enters it", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await submitName(view, `Clicker-${crypto.randomUUID()}`);

    const target = `click-target-${crypto.randomUUID()}`;
    await joinRoom(view, target);
    await waitFor(view, SEND_MESSAGE_FORM_VISIBLE, (v) => v === true);
    await sendChatMessage(view, "so the room is still there when nobody is in it"); // a room stays while something has been said in it
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("still there"));
    await leaveRoom(view);

    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
    await view.evaluate(`document.getElementById("r-${target}").click()`); // the row may be far down a long list

    await waitFor(view, `document.querySelector('.cell-name')?.textContent ?? ""`, (v) => typeof v === "string" && v.includes(target));
  });

  test("a sent chat message appears in the message list", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await submitName(view, `Chatter-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    const text = `hello room ${crypto.randomUUID()}`;
    await sendChatMessage(view, text);

    const messages = await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));
    expect(messages).toContain(text);
  });

  test("a sent message clears the input, but a rejected (blank) one hands the text back", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
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
    await view.navigate(urlFor(view, server.url));
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

    await viewA.navigate(urlFor(viewA, server.url));
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
    await viewB.navigate(urlFor(viewB, server.url));
    await submitName(viewB, `ScrollB-${crypto.randomUUID()}`);
    await joinRoom(viewB, room);
    await waitFor(
      viewA,
      `document.querySelector('#people')?.textContent ?? ""`,
      (v) => typeof v === "string" && v.includes("ScrollB"),
    );

    expect((await viewA.evaluate(scrollTopScript)) as number).toBe(0);
  }, 20000); // fifteen messages typed, one by one

  test("a room with history opens scrolled to the newest message, not the oldest", async () => {
    await using viewA = new Bun.WebView();
    await viewA.navigate(urlFor(viewA, server.url));
    await submitName(viewA, `Fresh-${crypto.randomUUID()}`);
    const room = crypto.randomUUID();
    await joinRoom(viewA, room);
    for (let i = 0; i < 15; i++) {
      await sendChatMessage(viewA, `history ${i}`);
    }
    await waitFor(viewA, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("history 14"));

    // Reload: the first render already contains the whole transcript, so
    // nothing "grew" -- the list itself is what's new, and it must start at
    // the bottom.
    await viewA.navigate(urlFor(viewA, server.url));
    await waitFor(viewA, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("history 14"));
    const m = `document.querySelector('.messages')`;
    expect(await viewA.evaluate<boolean>(`${m}.scrollHeight > ${m}.clientHeight`)).toBe(true);
    expect(await viewA.evaluate<boolean>(`${m}.scrollTop + ${m}.clientHeight >= ${m}.scrollHeight - 1`)).toBe(true);
  }, 20000); // fifteen messages typed, one by one

  // Fails until the kernel's client is fixed (todo n70): drawing() in src/client/app.ts pins a
  // [data-autoscroll] list only when its count of children grows, and a full room's stays at fifty.
  // Remembering the last child instead makes it pass; make this a plain test() when that lands.
  test.failing("a full room still scrolls to the newest message: the fifty-first takes the oldest out, and lands in view", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await submitName(view, `Full-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());
    await waitFor(view, SEND_MESSAGE_FORM_VISIBLE, (v) => v === true);

    // a room keeps its last fifty (documents/room.ts); fill it, as fast as the socket takes them
    await view.evaluate(`(() => { for (let i = 0; i < 50; i++) window.eta.socket().send(JSON.stringify({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: "filler " + i }] })); return 1; })()`);
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("filler 49"));
    const m = `document.querySelector('.messages')`;
    const atFoot = `${m}.scrollTop + ${m}.clientHeight >= ${m}.scrollHeight - 1`;
    expect(await view.evaluate<boolean>(`${m}.scrollHeight > ${m}.clientHeight`)).toBe(true);
    expect(await view.evaluate<boolean>(atFoot)).toBe(true); // the list grew, so it was pinned

    // the fifty-first, and longer than the one it takes out: one in, the oldest out, the count still
    // fifty -- and it must be in view, whatever the height it brings
    const long = `the fifty-first, ${"and it goes on for a while ".repeat(12)}`;
    await sendChatMessage(view, long);
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes("the fifty-first"));
    expect(await view.evaluate<number>(`${m}.children.length`)).toBe(50);
    expect(await view.evaluate<boolean>(atFoot)).toBe(true);
  }, 20000);

  test("a message sent from one browser appears live in another browser in the same room", async () => {
    await using viewA = new Bun.WebView();
    await using viewB = new Bun.WebView();

    await viewA.navigate(urlFor(viewA, server.url));
    await viewB.navigate(urlFor(viewB, server.url));

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

    await viewA.navigate(urlFor(viewA, server.url));
    await viewB.navigate(urlFor(viewB, server.url));

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

  test("eta.docs() gains the message delta made when another browser sends one", async () => {
    await using viewA = new Bun.WebView();
    await using viewB = new Bun.WebView();

    await viewA.navigate(urlFor(viewA, server.url));
    await viewB.navigate(urlFor(viewB, server.url));

    await submitName(viewA, `EchoA-${crypto.randomUUID()}`);
    await submitName(viewB, `EchoB-${crypto.randomUUID()}`);

    const room = crypto.randomUUID();
    await joinRoom(viewA, room);
    await joinRoom(viewB, room);

    const text = `echo test ${crypto.randomUUID()}`;
    await sendChatMessage(viewA, text);

    // the echo names the whole document, room:<name>: a connection may see any number of rooms.
    const doc = JSON.stringify(`room:${room}`);
    const gainedOp = `window.eta.docs()[${doc}]?.ops.some(
      (op) => op.op === "add" && op.path.startsWith("/messages/") && op.value.text === ${JSON.stringify(text)}
    ) ?? false`;
    await waitFor(viewB, gainedOp, (v) => v === true);

    // the version tracked alongside it is a real, positive document version, not just a message counter
    const version = await viewB.evaluate(`window.eta.docs()[${doc}]?.version`);
    expect(typeof version).toBe("number");
    expect(version as number).toBeGreaterThan(0);
  });

  test("eta.inspect() reports the last write sent and whether it was echoed", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await submitName(view, `Inspector-${crypto.randomUUID()}`);
    const room = crypto.randomUUID();
    await joinRoom(view, room);

    const text = `inspect this ${crypto.randomUUID()}`;
    await sendChatMessage(view, text);
    await waitFor(view, MESSAGES_TEXT, (v) => typeof v === "string" && v.includes(text));

    // the form names the room by its type alone (the one this page is on); the echo names it whole,
    // and is still known as this write's
    const lastSentDoc = await waitFor(view, `window.eta.inspect().lastSent?.doc ?? null`, (v) => v === "room");
    expect(lastSentDoc).toBe("room");

    const echoed = await waitFor(view, `window.eta.inspect().lastSent?.echoed ?? false`, (v) => v === true);
    expect(echoed).toBe(true);

    expect((await view.evaluate(`${JSON.stringify(`room:${room}`)} in window.eta.inspect().docs`)) as boolean).toBe(true);
  });
});
