import { effect, signal } from "@blueshed/railroad";
import { Save } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { message } from "./message";

export function MessageView() {
  const text = signal(message.data.peek()?.text ?? "");
  let shown = text.peek(); // what the box last took from the document

  // Follow the document, unless the box holds typing that has not been saved
  effect(() => {
    const doc = message.data.get();
    if (doc && (text.peek() === shown || text.peek() === doc.text)) {
      shown = doc.text;
      text.set(doc.text);
    }
  });

  // Say "Saved" only once the server has applied the change and sent it back
  async function onsave() {
    try {
      await message.send([{ op: "replace", path: "/text", value: text.peek() }]);
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
