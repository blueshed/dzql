/**
 * Message — a singleton resource, stored as one JSON file in the data folder.
 * A save is published to the "message" topic, so every open page sees it.
 *
 * The type is shared: the client imports it as a type only (`import type`), so none
 * of the server code below reaches the browser bundle.
 */
import type { Server } from "bun";

export type Message = { message: string };

const empty: Message = { message: "Hello" };

export function messageApi(dataDir: string) {
  // A new BunFile per call: one keeps the size it first saw, so after a write it reads too little (nothing, if there was no file)
  const file = () => Bun.file(`${dataDir}/message.json`);

  return {
    get: async () => {
      const stored = file();
      return Response.json(((await stored.exists()) ? await stored.json() : empty) satisfies Message);
    },

    put: async (req: Request, server: Server<undefined>) => {
      const body = await req.json().catch(() => null);
      if (typeof body?.message !== "string") {
        return Response.json({ error: "message must be a string" }, { status: 400 });
      }
      const message: Message = { message: body.message };
      await Bun.write(file(), JSON.stringify(message)); // creates the data folder if it is missing
      server.publish("message", JSON.stringify(message)); // to every socket, the saver's included
      return Response.json(message);
    },
  };
}
