import { effect, signal } from "@blueshed/railroad";
import { joinPath } from "@blueshed/delta/core";
import { Save } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { message } from "./message";

export function MessageView() {
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

  return (
    <>
      <h1>Message</h1>
      <textarea
        value={text}
        oninput={(e: Event) => text.set((e.currentTarget as HTMLTextAreaElement).value)}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onsave(); // Cmd+Enter, or Ctrl+Enter
        }}
      ></textarea>
      <div class="toolbar">
        <button class="primary" onclick={onsave}>
          <Icon icon={Save} /> Save
        </button>
      </div>
      <p class="help">Edit the message above and hit <strong>Save</strong>: every open page shows it.</p>
    </>
  );
}
