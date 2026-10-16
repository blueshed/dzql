import { list, signal, when } from "@blueshed/railroad";
import { LogOut } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import type { Person } from "../people/people-api";
import { becomeAs, everyone, me, signOut } from "./auth";

/** Who is signed in, and the way out; else "Who are you?": in development, everyone, a click each. */
export function AuthView() {
  return (
    <>
      {when(
        me,
        (m$) => (
          <div class="toolbar who">
            <span>Signed in as <strong>{m$.map((m) => m.name)}</strong></span>
            <button class="sign-out" onclick={() => void signOut()}>
              <Icon icon={LogOut} /> Sign out
            </button>
          </div>
        ),
        () => when(me.map((m) => m === null), () => <WhoAreYou />),
      )}
    </>
  );
}

function WhoAreYou() {
  const people = signal<Person[]>([]);
  void everyone<Person>().then((all) => people.set(all)); // none in production
  return (
    <>
      <h2>Who are you?</h2>
      {when(
        people.map((p) => p.length > 0),
        () => (
          <div class="toolbar pick">
            {list(people, (p) => p.id, (p$) => (
              <button class="be" onclick={() => void becomeAs(p$.peek().id).catch((err) => toast(err.message, "alert"))}>
                {p$.map((p) => p.name)}
              </button>
            ))}
          </div>
        ),
        () => <p class="help">Ask someone here for your link. The first person's comes from <code>bun run link &lt;your name&gt;</code>.</p>,
      )}
    </>
  );
}
