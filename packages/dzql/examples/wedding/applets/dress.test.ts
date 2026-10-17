import { describe, expect, test } from "bun:test";
import { dressHtml, partPop, type DressProps } from "./dress";

const props: DressProps = { guestId: 7, firstName: "Femi", spec: { skin: "#E0A97A", hair: "short", hair_color: "#2B2B33", top: "#1E3F8F", legs: "#2B2B33", face: "grin", attitude: "cool" } };

describe("dressHtml", () => {
  test("the figure with a lead and a hit for every part, the callouts at their heights, and no choices until a part is open", () => {
    const html = dressHtml(props, null);
    expect(html).toStartWith('<div class="dress"><svg class="dress-figure"');
    for (const part of ["hair", "face", "top", "arms", "legs"]) {
      expect(html).toContain(`class="hit hit-${part}"`);
      expect(html).toContain(`class="callout callout-${part}" style="--y:`);
      expect(html).toContain(`data-part="${part}"`);
    }
    expect(html).toContain(">Femi</text>");
    expect(html).toContain('<div class="options"></div>');
    expect(dressHtml({ ...props, out: true }, null)).toContain('class="fig att-cool out"');
  });

  test("the open part is marked on its lead, its hit and its callout, and its choices are drawn", () => {
    const html = dressHtml(props, "top");
    expect(html).toContain('class="hit hit-top on"');
    expect(html).toContain('class="lead lead-top on"');
    expect(html).toContain('class="callout callout-top on"');
    expect(html).toContain('<div class="pop pop-top"');
  });
});

describe("partPop", () => {
  test("each part offers the model's own values, the current one marked, each a field and a value to write", () => {
    const hair = partPop("hair", props.spec, "Femi");
    expect(hair).toContain('class="icon on" role="radio" aria-checked="true" aria-label="hair short" data-field="hair" data-value="short"');
    expect(hair).toContain('data-field="hair_color" data-value="#2B2B33"');
    expect(hair).toContain('class="dot on"');
    const face = partPop("face", props.spec, "Femi");
    expect(face).toContain('data-field="face" data-value="wink"');
    expect(face).toContain('data-field="skin" data-value="#E0A97A"');
    expect(partPop("top", props.spec, "Femi")).toContain('data-field="top" data-value="#7B2F4B"');
    expect(partPop("legs", props.spec, "Femi")).toContain('data-field="legs" data-value="#C97D83"');
    const arms = partPop("arms", props.spec, "Femi");
    expect(arms).toContain('class="icon tall on" role="radio" aria-checked="true" aria-label="attitude cool" data-field="attitude" data-value="cool"');
    expect(arms).toContain('<span class="icon-name">photo-bombing</span>');
  });
});
