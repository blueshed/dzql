import { effect, signal } from "@blueshed/railroad";
import { joinPath } from "@blueshed/delta/core";
import { Save } from "lucide";
import { bento, go, here } from "../bento";
import { toast } from "../toast";
import { message } from "./message";

const { cell, drawer, tool } = bento();

/** Where the message's drawer opens: over the box, by its address (`#/?message`). */
const OPEN = "message";

/** The message on the box: what it says, and ✎ to change it in its drawer. */
export function MessageCell() {
  return cell({
    name: "Message",
    span: 2,
    thing: { open: go("", OPEN), chosen: () => here.get().what === OPEN },
    summary: () => message.data.get()?.messages.text ?? "",
  });
}

/** The message's drawer: the box it is typed in, and Save. */
export function MessageDrawer() {
  const text = signal(message.data.peek()?.messages.text ?? "");
  let shown = text.peek(); // what the box last took from the document

  // Follow the document, unless the box holds typing that has not been saved
  effect(() => {
    const row = message.data.get()?.messages;
    if (row && (text.peek() === shown || text.peek() === row.text)) {
      shown = row.text;
      text.set(row.text);
    }
  });

  // Say "Saved" only once the server has applied the change and sent it back
  async function onsave() {
    try {
      const id = message.data.peek()!.messages.id;
      await message.send([{ op: "replace", path: joinPath("messages", id, "text"), value: text.peek() }]);
      toast("Saved");
    } catch {
      toast("Not saved", "alert");
    }
  }

  return drawer(
    "message",
    "Message",
    <>
      <div class="prop">
        <label class="prop-name cap" for="message-text">Text</label>
        <div class="prop-value">
          <textarea
            class="field"
            id="message-text"
            rows="6"
            value={text}
            oninput={(e: Event) => text.set((e.currentTarget as HTMLTextAreaElement).value)}
            onkeydown={(e: KeyboardEvent) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onsave(); // Cmd+Enter, or Ctrl+Enter
            }}
          ></textarea>
        </div>
      </div>
      <div class="drawer-foot">{tool("Save", { kind: "add", icon: Save, on: onsave })}</div>
      <p class="help">Change the message and hit <strong>Save</strong>: every open page shows it.</p>
    </>,
    go(""),
  );
}
