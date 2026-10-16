import { list, signal, when } from "@blueshed/railroad";
import { Link, UserPlus } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { me } from "../auth/auth";
import { linkFor, openPeople } from "./people";

/** Everyone here, for whoever is signed in: add someone new, and make anyone's link to send them. */
export function PeopleView() {
  return <>{when(me, () => <Everyone />)}</>;
}

function Everyone() {
  const people = openPeople();
  const all = people.data.map((d) => Object.values(d?.people ?? {}).sort((a, b) => a.name.localeCompare(b.name)));
  const name = signal("");
  const sent = signal<{ name: string; url: string } | null>(null);

  const add = () =>
    people.send([{ op: "add", path: "/people/-", value: { name: name.peek().trim() } }]).then(
      () => name.set(""),
      (err) => toast(err?.message ?? "Not added", "alert"),
    );
  // A link is theirs to tap once: copied, to paste where they'll see it
  const send = async (id: number, who: string) => {
    const { url } = await linkFor(id);
    sent.set({ name: who, url });
    await navigator.clipboard?.writeText(url).then(() => toast(`${who}'s link copied`), () => {});
  };

  return (
    <>
      <h2>People</h2>
      <ul class="people">
        {list(all, (p) => p.id, (p$) => (
          <li>
            <span class="name">{p$.map((p) => p.name)}</span>
            <button class="send-link" onclick={() => void send(p$.peek().id, p$.peek().name)}>
              <Icon icon={Link} label="Make their link" />
            </button>
          </li>
        ))}
      </ul>
      {when(sent, (s$) => (
        <p class="help sent">
          {s$.map((s) => `${s.name}'s link, for them to tap once:`)} <code class="link">{s$.map((s) => s.url)}</code>
        </p>
      ))}
      <form
        class="toolbar add-person"
        onsubmit={(e: Event) => {
          e.preventDefault();
          void add();
        }}
      >
        <input name="person" placeholder="Someone new" value={name} oninput={(e: Event) => name.set((e.currentTarget as HTMLInputElement).value)} />
        <button>
          <Icon icon={UserPlus} /> Add
        </button>
      </form>
    </>
  );
}
