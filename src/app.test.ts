import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "./server";

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

const NAME_FORM_VISIBLE = `document.querySelector('[data-event="set-name"]') !== null`;
const ROOM_FORM_VISIBLE = `document.querySelector('#room') !== null`;
const USER_LABEL = `document.querySelector('.user-label')?.textContent ?? null`;
const MESSAGES_TEXT = `document.querySelector('.messages')?.textContent ?? ""`;

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
  await view.click("button[type=submit]");
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

  test("logout clears the session and shows the name form again", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Linus");
    await waitFor(view, USER_LABEL, (v) => v === "Linus");

    await view.click("[data-event=logout]");

    await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  });

  test("joining a room then changing room returns to the room selector", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await submitName(view, `Chatter-${crypto.randomUUID()}`);
    await joinRoom(view, crypto.randomUUID());

    await waitFor(view, `document.querySelector('[data-event="send-message"]') !== null`, (v) => v === true);

    await view.click("[data-event=leave-room]");

    await waitFor(view, ROOM_FORM_VISIBLE, (v) => v === true);
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
});
