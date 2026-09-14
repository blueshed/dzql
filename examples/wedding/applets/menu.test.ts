import { describe, expect, test } from "bun:test";
import { menuHtml, type MenuProps } from "./menu";

const props: MenuProps = {
  guestId: 2,
  firstName: "Femi",
  courses: [
    { id: 1, name: "Starter", dishes: [{ id: 1, name: "Soup", dietary: "v" }, { id: 2, name: "Crab", dietary: null }], drinks: [{ id: 1, name: "Prosecco" }] },
    { id: 4, name: "The toast", dishes: [], drinks: [{ id: 6, name: "Champagne" }] },
  ],
  choices: { "1": { dish: 1, drink: null } },
};

describe("menuHtml", () => {
  test("a row per course with what is chosen, the open one showing its pills, the chosen pill on", () => {
    const closed = menuHtml(props, null);
    expect(closed).toContain('<p class="cap">Femi’s choices</p>');
    expect(closed).toContain('<span class="when">Starter</span><span class="chosen">Soup</span>');
    expect(closed).toContain('<span class="when">The toast</span><span class="unchosen">Choose…</span>');
    expect(closed).not.toContain('class="choice');

    const open = menuHtml(props, 1);
    expect(open).toContain('class="menu-row open"');
    expect(open).toContain('class="choice dish on" role="radio" aria-checked="true" data-course="1" data-kind="dish" data-id="1" data-on="true">Soup (v)</button>');
    expect(open).toContain('data-id="2" data-on="false">Crab</button>');
    expect(open).toContain('class="choice drink" role="radio" aria-checked="false" data-course="1" data-kind="drink" data-id="1" data-on="false">Prosecco</button>');
    // a course with no dishes draws no dish group
    const toast = menuHtml(props, 4);
    expect(toast).not.toContain("The toast: dish");
    expect(toast).toContain("The toast: drink");
  });

  test("locked after the deadline, the pills are disabled; not coming, there is no meal to choose", () => {
    expect(menuHtml({ ...props, locked: true }, 1)).toContain('data-on="true" disabled>');
    expect(menuHtml({ ...props, out: true }, 1)).toBe('<div class="menu"><p class="cap">Femi’s choices</p><p class="note">Femi is not coming, so there is no meal to choose.</p></div>');
  });
});
