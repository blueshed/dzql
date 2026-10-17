// A page with both kinds of <Icon>, for site.test.ts: the app draws one beside a label (Save), never one on its own.
import { mount } from "@blueshed/railroad";
import { Save, X } from "lucide";
import { Icon } from "../src/resources/icon";

mount(document.body, () => (
  <>
    <button id="beside">
      <Icon icon={Save} /> Save
    </button>
    <button id="alone">
      <Icon icon={X} label="Close" />
    </button>
  </>
));
