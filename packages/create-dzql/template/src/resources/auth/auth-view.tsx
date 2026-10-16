import { signal, when } from "@blueshed/railroad";
import { LogIn, LogOut, UserPlus } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { me, register, signIn, signOut } from "./auth";

/** Who is signed in, and the way out; else the way in: sign in, or register as someone new. */
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
        () => when(me.map((m) => m === null), () => <SignInForm />),
      )}
    </>
  );
}

function SignInForm() {
  const registering = signal(false);
  const name = signal("");
  const email = signal("");
  const password = signal("");
  const field = (s: typeof name) => (e: Event) => s.set((e.currentTarget as HTMLInputElement).value);
  const send = () =>
    (registering.peek()
      ? register(name.peek().trim(), email.peek().trim(), password.peek())
      : signIn(email.peek().trim(), password.peek())
    ).catch((err) => {
      password.set("");
      toast(err?.message ?? "Not signed in", "alert");
    });
  return (
    <>
      <h2>{registering.map((r) => (r ? "Create an account" : "Sign in"))}</h2>
      <form
        class="sign-in"
        onsubmit={(e: Event) => {
          e.preventDefault();
          void send();
        }}
      >
        {when(registering, () => <input name="name" placeholder="Your name" autocomplete="name" value={name} oninput={field(name)} />)}
        <input name="email" type="email" placeholder="you@example.com" autocomplete="email" value={email} oninput={field(email)} />
        <input name="password" type="password" placeholder="Password" autocomplete="current-password" value={password} oninput={field(password)} />
        <div class="toolbar">
          <button class="primary">
            {when(registering, () => <><Icon icon={UserPlus} /> Create account</>, () => <><Icon icon={LogIn} /> Sign in</>)}
          </button>
          <button type="button" class="switch" onclick={() => registering.set(!registering.peek())}>
            {registering.map((r) => (r ? "I have an account" : "Create one"))}
          </button>
        </div>
      </form>
    </>
  );
}
