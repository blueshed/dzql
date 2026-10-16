import { list, signal, when, type ReadonlySignal } from "@blueshed/railroad";
import type { DeltaOp } from "@blueshed/delta/core";
import { Pencil, Send, Trash2 } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import type { Me } from "../auth/auth-api";
import { me } from "../auth/auth";
import type { Post } from "./posts-api";
import { openMine, openPosts } from "./posts";

/** Every post, newest first, for whoever is signed in: their own they may change and take away. */
export function PostsView() {
  return <>{when(me, (m$) => <Board who={m$.peek() as Me} />)}</>;
}

function Board({ who }: { who: Me }) {
  const posts = openPosts();
  const mine = openMine(who.id);
  const all = posts.data.map((d) => Object.values(d?.posts ?? {}).sort((a, b) => b.id - a.id));
  const editing = signal<Post | null>(null);

  // Send through your own posts, and let the change that comes back draw it, here and in every window
  const change = (ops: DeltaOp[]) =>
    mine.send(ops).then(
      () => true,
      (err) => (toast(err?.message ?? "Not saved", "alert"), false),
    );

  return (
    <>
      <h1>Posts</h1>
      <NewPost publish={(title, content) => change([{ op: "add", path: "/posts/-", value: { title, content } }])} />
      <ul class="posts">
        {list(all, (p) => p.id, (p$) => (
          <li>
            <h3 class="title">{p$.map((p) => p.title)}</h3>
            <p class="content">{p$.map((p) => p.content)}</p>
            {when(p$.map((p) => p.author_id === who.id), () => (
              <div class="toolbar">
                <button class="edit" onclick={() => editing.set(p$.peek())}>
                  <Icon icon={Pencil} label="Edit" />
                </button>
                <button class="delete" onclick={() => void change([{ op: "remove", path: `/posts/${p$.peek().id}` }])}>
                  <Icon icon={Trash2} /> Delete
                </button>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {when(editing, (e$) => (
        <EditSheet
          post={e$}
          save={(title, content) =>
            change([
              { op: "replace", path: `/posts/${e$.peek().id}/title`, value: title },
              { op: "replace", path: `/posts/${e$.peek().id}/content`, value: content },
            ]).then((ok) => ok && editing.set(null))}
          cancel={() => editing.set(null)}
        />
      ))}
    </>
  );
}

function NewPost({ publish }: { publish: (title: string, content: string) => Promise<boolean> }) {
  const title = signal("");
  const content = signal("");
  return (
    <form
      class="new-post"
      onsubmit={(e: Event) => {
        e.preventDefault();
        void publish(title.peek().trim(), content.peek().trim()).then((ok) => ok && (title.set(""), content.set("")));
      }}
    >
      <input name="title" placeholder="Title" value={title} oninput={(e: Event) => title.set((e.currentTarget as HTMLInputElement).value)} />
      <textarea name="content" placeholder="What's on your mind?" value={content} oninput={(e: Event) => content.set((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
      <div class="toolbar">
        <button class="primary publish">
          <Icon icon={Send} /> Publish
        </button>
      </div>
    </form>
  );
}

/** A post's title and words, changed in a sheet over the list: saved, the list shows it in every window. */
function EditSheet({ post, save, cancel }: { post: ReadonlySignal<Post>; save: (title: string, content: string) => unknown; cancel: () => void }) {
  const title = signal(post.peek().title);
  const content = signal(post.peek().content);
  return (
    <div class="sheet">
      <form
        class="edit-post"
        onsubmit={(e: Event) => {
          e.preventDefault();
          void save(title.peek().trim(), content.peek().trim());
        }}
      >
        <h2>Edit</h2>
        <input name="title" value={title} oninput={(e: Event) => title.set((e.currentTarget as HTMLInputElement).value)} />
        <textarea name="content" value={content} oninput={(e: Event) => content.set((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
        <div class="toolbar">
          <button class="primary save">Save</button>
          <button type="button" class="cancel" onclick={cancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
