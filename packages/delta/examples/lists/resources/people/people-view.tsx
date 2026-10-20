/**
 * People's part of the page: who you are (and signing out), "Who are you?" for nobody, and
 * everyone here with a button that makes their link.
 */
import { list, signal, when, type JSX } from "@blueshed/railroad";
import type { Person } from "./people-api";
import { becomeAs, everyone, linkFor, me, openPeople, signOut } from "./people";

/** You, and Sign out: the session ends and the page starts again as nobody. */
export function Me(): JSX.Element {
  return (
    <p class="me">
      <b id="me">{me.map((m) => m?.name ?? "")}</b> <button class="sign-out" onclick={() => void signOut()}>Sign out</button>
    </p>
  );
}

/** Nobody: in development, pick who you are (one window each is two people); in production, ask for a link. */
export function WhoAreYou(): JSX.Element {
  const people = signal<Person[]>([]);
  void everyone<Person>().then((all) => people.set(all));   // nobody, in production
  return (
    <div class="who">
      <p>Who are you?</p>
      {when(people.map((p) => p.length > 0),
        () => <div class="pick">{list(people, (p) => p.id, ({ id, name }) => <button onclick={() => void becomeAs(id.peek())}>{name}</button>)}</div>,
        () => <p class="note">Ask someone here for your link.</p>)}
    </div>
  );
}

/** Everyone here (`people:`, live), each with their link to make and send: a tap of it signs them in. */
export function PeopleView(): JSX.Element {
  const people = openPeople();
  const all = people.data.map((d) => Object.values(d?.people ?? {}).sort((a, b) => a.name.localeCompare(b.name)));
  const sent = signal("");
  return (
    <section class="people">
      <h2>People</h2>
      {list(all, (p) => p.id, ({ id, name }) => (
        <p>{name} <button class="link" onclick={() => void linkFor(id.peek()).then(({ url }) => sent.set(url))}>their link</button></p>
      ))}
      {when(sent, (s$) => <p class="note">For them to tap once: <code>{s$}</code></p>)}
    </section>
  );
}
