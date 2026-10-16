import { call, openDoc } from "@blueshed/delta/client";
import type { People } from "./people-api";

/** Everyone here, live. Opened inside a view, it closes when the view goes. Add someone with `send(ops)`. */
export const openPeople = () => openDoc<People>("people:");

/** A new link to be `person`: its address, to send them. */
export const linkFor = (person: number) => call<{ url: string; expires: string }>("link", { person });
