import { effect, signal, when } from "@blueshed/railroad";
import { Save } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { load, message, save } from "./message";

export function MessageView() {
  const text = signal(message.peek()?.message ?? "");
  const failed = signal(false);
  let shown = text.peek(); // what the box last took from the server

  load().catch(() => failed.set(true));

  // Follow the server, unless the box holds typing that has not been saved
  effect(() => {
    const m = message.get();
    if (m && (text.peek() === shown || text.peek() === m.message)) {
      shown = m.message;
      text.set(m.message);
    }
  });

  // Say "Saved" only once the server has said so
  async function onsave() {
    try {
      await save(text.peek());
      toast("Saved");
    } catch {
      toast("Not saved", "alert");
    }
  }

  return (
    <>
      <h1>Message</h1>
      {when(failed, () => <p class="help">The message could not be loaded.</p>)}
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
