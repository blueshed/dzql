// The Londons rights market, told as stories, standing in the picture. See docs/stories.md at the
// root and, for the page, apples.md ("The page": a page is a bento box; a ground drawn as itself).
// These are the 133 stories of the hjeli model in
// `the original hjeli model`, retold in eta's words as the whole
// specification of an app that does not exist: the modeller's tests read it as a project of stories alone.
//
// THE MARKETPLACE. An authority plans a series of occasions and invites venues, or venues propose
// themselves; a venue owner has areas and sites with a performance baseline; a promoter packages
// rights at an occasion and may gather packages into campaigns; a sponsor has brands and artwork,
// opens an engagement with a brief, commissions a scenario from a contractor, approves it, and buys
// a package or a campaign; the contractor keeps a catalogue of modules, places them against the
// rights, dresses their faces, prices the placement, and runs the project -- deployments the venue
// owner accepts, work windows, trips, workers, supply lines that suppliers bid on; a worker builds
// and strikes. Four agreements are two-sided and every field has one writer: hosting (authority and
// venue), scenario (sponsor and contractor), deployment (contractor and venue), supply (supplier
// and contractor). Whose move it is stays visible on the thing itself.
//
// A package is sold alone or in a campaign, and either way it is agreed: from then on no other
// sponsor can have it, and every campaign holding it leaves the market, on offer or not. Nothing
// ended is made to go again: a declined invitation, a withdrawn scenario or a revoked permit stays
// as it is, and to try again (invite the venue that said no) a new one is made.
//
// THE PICTURE. Apples says it: a racecourse is its sites at scale with time as a tool. So the
// venue is drawn as its map -- Ashcombe with its areas and their sites in place -- and every
// ground that stands on the racecourse is that map read another way: the promoter's occasion is
// the map with the rights coloured by package; the contractor's scenario is the map with the
// placements on the rights; the project is the map with the deployments on the sites. The time
// tool floats on the map: slide it to a day and the map shows what is there that day. Grounds
// that stand on time rather than on ground are drawn as the wall of their days: the authority's
// series is the year with its occasions on it, venues as lanes; the project's work windows and
// trips are the wall of its days; a worker's home is the wall of their days. Grounds with no
// picture are boxes: an organisation, a catalogue product, an engagement.
//
// THE PAGES, per actor. The root is the organisation (a person, for a worker); home is its box,
// and home is the move queue: every cell shows its count and is marked when it is your
// move. `""` is home. Names below are pages; after " @ " is what the session holds there:
// `drawer=<kind>/<id>` (a figure's drawer: its properties, marked ✎), `time=<day>` (the time tool
// on a map or a wall), `reading.<cell>=<reading>` (a cell read another way). A
// modal is never named: a named thing is made or destroyed in one question and the modal is gone;
// the story says which cell then shows it.
//   authority:   "" (box: series, profile) · "series/1" (the wall of the year; cells:
//                venues with the choice on the row, occasions on the wall, permits in an
//                occasion's drawer)
//   venueOwner:  "" (box: venues, profile) · "venue/1" (the map; cells drawn on it: areas
//                and their sites, hosting as a strip with the choice on the row, occasions on the
//                time tool, delegations in an occasion's drawer, permits on the sites) ·
//                "venue/1/deployments" (the map with the deployments proposed at the venue, the
//                choice on each)
//   promoter:    "" (box: occasions delegated to it, campaigns, profile) · "occasion/1" (the map,
//                rights coloured by package; cells: packages, the events and moments on
//                the time tool) · "campaigns" (a collection; a campaign's drawer)
//   sponsor:     "" (the queue: scenarios awaiting approval, the market, brands,
//                engagements, stock, profile) · "market" (a collection of the packages on
//                offer, and the campaigns on offer with no sold package among them,
//                each row's rights on the map beneath; buy on the row) · "engagements/1" (a box:
//                the brief in place, scenarios as a cell with approve/reject on the row) ·
//                "brands" · "stock"
//   contractor:  "" (the queue: commissions, offers to answer, blocked builds, catalogue,
//                projects, custody, rates, profile) · "catalogue" (a collection) · "catalogue/1"
//                (a product's box: parts, faces, tasks) · "scenario/3" (the map with the
//                placements on the rights; the brief read beside it; drawers for a placement, a
//                face, a requirement; propose/withdraw as tools) · "projects/1" (the map with the
//                deployments on the sites, and the wall of its days: windows, trips, assignments;
//                supply lines as a cell with the offers' choice on the row) · "custody" ·
//                "rates"
//   supplier:    "" (the queue: open lines with offer on the row, my offers) · "open-supply" ·
//                "opportunities" (a collection; an offer's drawer)
//   worker:      "" (the wall of my days: assignments, each a way into its build) ·
//                "assignments/1" (the build's box: the tasks as a tickable list, done or skip on
//                the row; built and blocked as tools on the box; the site on the map beneath)
//
// THE SEED the stories assume ("the small Ashcombe", one row in every state a story needs):
// organisations 1 Board (authority), 2 The Downs Company (venue owner), 3 Festival Promotions
// (promoter), 4 Harrow (sponsor), 5 Londons (contractor), 6 Northgate Signs (supplier); person 1
// Sam (worker, of Londons). Venue 1 Ashcombe Racecourse with area 1 Paddock (site 1 the
// parade ring screen, site 2 the winning-post boards) and area 2 the Old Hollow enclosure. Series 1
// the Jump season 2027 (Board) with hosting agreements 1 (venue 1, invited) and 2 (venue 1,
// proposed); occasion 1 The Festival 2027 (16-19 March) at venue 1 in series 1, delegated to
// promoter 3, with event 1 Silver Bowl day, moment 1 the Ashcombe Roar, permit 1 (area 1, granted)
// and permit 2 (revoked), and the venue's own permit 3 (site 1, granted); packages 1 (draft, right
// 1 on site 1), 2 (offered, right 2 on site 2) and 3 (agreed: sold); campaigns 1 (draft, promoter
// 3), 2 (offered, with package 2) and 3 (offered, with package 3). Brand 1 Harrow with artwork 1;
// engagement 1 (sponsor 4) with scenarios 1 (draft), 2 (proposed), 3 (approved) and 4 (rejected),
// all by contractor 5; placement 1 (scenario 3, right 2, product 1) with face 1 and requirement 1
// (buy). Products 1 the 6m banner frame (part 1, face 1, taskdef 1 rig and taskdef 2 strike
// depending on 1, resource 1) and 2 the LED tower; rate card 1 (rigger). Stock 1 (sponsor 4, held
// by contractor 5, 12 banners, good). Project 1 (contractor 5, occasion 1, open) with deployments 1
// (proposed, site 1), 2 (accepted, site 2, permit 1), 3 (built), 4 (blocked), 5 (rejected); work
// window 1 (14 March, area 1) with assignment 1 (Sam, assigned, deployment 2) and assignment 2
// (done, deployment 3); trip 1; tasks 1 (todo), 2 (done) and 3 (skipped) on deployment 2; supply
// line 1 (open, requirement 1) with offer 1 (Northgate Signs, offered) and supply line 2 (accepted).
import type { PatchOp } from "../../src/json-patch";
import { story, type Stories, type Write } from "../../src/stories";

type Op = "add" | "replace" | "remove";
const w = (doc: string, op: Op, path: string, value?: unknown): Write => ({ doc, ops: [op === "remove" ? { op, path } : { op, path, value }] });
const many = (doc: string, sets: [string, unknown][]): Write => ({ doc, ops: sets.map(([path, value]) => ({ op: "replace" as const, path, value })) });
const code = (value: string): Write => w("session", "replace", "/code", value);

/** "page @ key=value, key=value" as one session write: the page first, since it closes drawers. */
function goTo(address: string): Write {
  const [page, rest] = address.split(" @ ");
  const ops: PatchOp[] = [{ op: "replace", path: "/page", value: page }];
  for (const pair of rest ? rest.split(", ") : []) {
    const [key, raw] = pair.split("=") as [string, string];
    ops.push({ op: "replace", path: key.startsWith("reading.") ? `/reading/${key.slice(8)}` : `/${key}`, value: raw });
  }
  return { doc: "session", ops };
}

export const stories: Stories = {
  cast: {
    authority: [code("Board")],
    venueOwner: [code("DOWNS")],
    promoter: [code("FESTIVAL")],
    sponsor: [code("HARROW")],
    contractor: [code("LONDONS")],
    supplier: [code("SIGNS")],
    worker: [code("SAM")],
    stranger: [],
  },
  goTo,
  stories: [
    // ── Coming in: the box of an organisation ──
    story("A venue owner registers their organisation, and stands in its box", { as: "stranger", does: w("profile", "add", "/-", { name: "Fenmoor Racecourse Co", base_location: "Liverpool", role: "venue-owner" }), seen: { stranger: "" } }),
    story("Sam registers as a worker, and stands on the wall of an empty week", { as: "stranger", does: w("worker", "add", "/-", { name: "Sam Reilly", skills: "rigger", day_rate: 240 }), seen: { stranger: "" } }),
    story("The Downs Company changes its name in place on its box, and nobody else's box moves", { as: "venueOwner", does: many("profile", [["/name", "The Downs Company Racecourses"], ["/base_location", "Newmarket"]]), seen: { venueOwner: "" }, untold: ["authority", "promoter", "sponsor", "contractor", "supplier", "worker"] }),
    story("The Board changes where it is based, in place", { as: "authority", does: w("profile", "replace", "/base_location", "London"), seen: { authority: "" } }),
    story("Festival Promotions gives its box a picture", { as: "promoter", does: w("profile", "replace", "/image_url", "/pictures/festival.png"), seen: { promoter: "" } }),
    story("Harrow changes where it is based", { as: "sponsor", does: w("profile", "replace", "/base_location", "Dublin"), seen: { sponsor: "" } }),
    story("Londons changes where it is based", { as: "contractor", does: w("profile", "replace", "/base_location", "Bristol"), seen: { contractor: "" } }),
    story("Northgate Signs changes its name", { as: "supplier", does: w("profile", "replace", "/name", "Northgate Signs Ltd"), seen: { supplier: "" } }),
    story("The Downs Company declares it also promotes, and the roles cell on its box shows two", { as: "venueOwner", does: w("profile", "add", "/roles/-", { role: "promoter" }), seen: { venueOwner: "" } }),
    story("The Downs Company retires a role in the role's drawer; it stays on the box, dated", { as: "venueOwner", does: w("profile", "replace", "/roles/1/valid_to", "2027-12-31"), seen: { venueOwner: " @ drawer=role/1" } }),
    story("Harrow declares a role", { as: "sponsor", does: w("profile", "add", "/roles/-", { role: "supplier" }), seen: { sponsor: "" } }),
    story("Harrow revalidates a role it had retired", { as: "sponsor", does: w("profile", "replace", "/roles/1/valid_to", null), seen: { sponsor: " @ drawer=role/1" } }),
    story("The Board declares a role", { as: "authority", does: w("profile", "add", "/roles/-", { role: "promoter" }), seen: { authority: "" } }),
    story("Festival Promotions declares a role", { as: "promoter", does: w("profile", "add", "/roles/-", { role: "contractor" }), seen: { promoter: "" } }),
    story("Londons declares a role", { as: "contractor", does: w("profile", "add", "/roles/-", { role: "supplier" }), seen: { contractor: "" } }),
    story("Northgate Signs declares a role", { as: "supplier", does: w("profile", "add", "/roles/-", { role: "contractor" }), seen: { supplier: "" } }),
    story("A stranger has no box and nothing to change on it", { as: "stranger", cannot: w("profile", "replace", "/name", "Nobody") }),

    // ── The venue: the map ──
    story("The Downs Company registers a second venue, and its box shows two venues to step into", { as: "venueOwner", does: w("venue", "add", "/-", { name: "Fenmoor", lat: 53.47, lng: -2.94, timezone: "Europe/London" }), seen: { venueOwner: "" } }),
    story("The Downs Company renames Ashcombe in place on its map, and gives it a picture", { as: "venueOwner", does: many("venue", [["/1/name", "Ashcombe Racecourse, Ashcombe Park"], ["/1/image_url", "/pictures/ashcombe.jpg"]]), seen: { venueOwner: "venue/1" } }),
    story("The Downs Company draws a new area on the map", { as: "venueOwner", does: w("venue", "add", "/1/areas/-", { name: "The Harrow Village" }), seen: { venueOwner: "venue/1" } }),
    story("The Downs Company renames an area in its drawer, and the map's label follows", { as: "venueOwner", does: w("venue", "replace", "/1/areas/1/name", "Paddock Enclosure"), seen: { venueOwner: "venue/1 @ drawer=area/1" } }),
    story("The Downs Company retires the Old Hollow enclosure in its drawer; the map greys it, and revalidating is the same field", { as: "venueOwner", does: w("venue", "replace", "/1/areas/2/valid_to", "2027-01-01"), seen: { venueOwner: "venue/1 @ drawer=area/2" } }),
    story("The Downs Company places a site on the map with its performance baseline", { as: "venueOwner", does: w("venue", "add", "/1/areas/1/sites/-", { name: "The big screen", kind: "screen", tv: 90, footfall: 60000, hospitality: 20, social_media: 40, pr: 30 }), seen: { venueOwner: "venue/1" } }),
    story("The Downs Company raises the winning-post boards' TV rating in the site's drawer, and on the market the right on those boards reads brighter", { as: "venueOwner", does: w("venue", "replace", "/1/areas/1/sites/2/tv", 95), seen: { venueOwner: "venue/1 @ drawer=site/2", sponsor: "market" } }),
    story("The Downs Company retires the parade ring screen", { as: "venueOwner", does: w("venue", "replace", "/1/areas/1/sites/1/valid_to", "2027-01-01"), seen: { venueOwner: "venue/1 @ drawer=site/1" } }),
    story("Londons cannot touch a site on someone else's map", { as: "contractor", cannot: w("venue", "replace", "/1/areas/1/sites/1/tv", 1) }),

    // ── Hosting: the strip on the map, the lane on the wall ──
    story("The Board plans a series, and its box shows a second wall to step onto", { as: "authority", does: w("series", "add", "/-", { name: "The Flat season 2027", year: 2027 }), seen: { authority: "" } }),
    story("The Board renames the series in place at the top of its wall, and the venue's hosting strip says the new name", { as: "authority", does: many("series", [["/1/name", "The Jump season 2027/28"], ["/1/year", 2027]]), seen: { authority: "series/1", venueOwner: "venue/1" } }),
    story("The Board invites Ashcombe to host; a lane appears on the wall marked waiting, and on Ashcombe's map the hosting strip shows an invitation with accept and decline on the row", { as: "authority", does: w("series", "add", "/1/venues/-", { venue_id: 1 }), seen: { authority: "series/1", venueOwner: "venue/1" } }),
    story("The Downs Company accepts on the row, and the Board's lane turns solid", { as: "venueOwner", does: w("venue", "replace", "/1/hosting/1/status", "accepted"), seen: { venueOwner: "venue/1", authority: "series/1" } }),
    story("The Downs Company declines on the row", { as: "venueOwner", does: w("venue", "replace", "/1/hosting/1/status", "declined"), seen: { venueOwner: "venue/1", authority: "series/1" } }),
    story("The Downs Company proposes Ashcombe for the series from its map, and on the Board's wall a lane appears marked their move", { as: "venueOwner", does: w("venue", "add", "/1/hosting/-", { series_id: 1 }), seen: { venueOwner: "venue/1", authority: "series/1" } }),
    story("The Board accepts the proposal on the lane", { as: "authority", does: w("series", "replace", "/1/venues/2/status", "accepted"), seen: { authority: "series/1", venueOwner: "venue/1" } }),
    story("The Board declines the proposal on the lane", { as: "authority", does: w("series", "replace", "/1/venues/2/status", "declined"), seen: { authority: "series/1", venueOwner: "venue/1" } }),
    story("The Board's own invitation carries no accept for the Board; that control is on the venue's row", { as: "authority", cannot: w("series", "replace", "/1/venues/1/status", "accepted") }),
    story("The Downs Company's own proposal carries no accept for the Downs Company", { as: "venueOwner", cannot: w("venue", "replace", "/1/hosting/2/status", "accepted") }),

    // ── Occasions on the wall and on the time tool; permits on the sites ──
    story("The Board puts an occasion on Ashcombe's lane, and on the venue's map the time tool gains three days in November", { as: "authority", does: w("series", "add", "/1/occasions/-", { venue_id: 1, name: "The November Meeting", from_date: "2027-11-12", to_date: "2027-11-14" }), seen: { authority: "series/1", venueOwner: "venue/1" } }),
    story("The Downs Company puts its own occasion on the time tool, in no series", { as: "venueOwner", does: w("venue", "add", "/1/occasions/-", { name: "The October Meeting", from_date: "2027-10-22", to_date: "2027-10-23" }), seen: { venueOwner: "venue/1" } }),
    story("The Downs Company slides the Festival a day earlier in its drawer; the Board's wall, the promoter's time tool and the market's rights all move with it", { as: "venueOwner", does: many("venue", [["/1/occasions/1/from_date", "2027-03-15"], ["/1/occasions/1/to_date", "2027-03-18"]]), seen: { venueOwner: "venue/1 @ drawer=occasion/1", authority: "series/1", promoter: "occasion/1", sponsor: "market" } }),
    story("The Downs Company renames the Festival in its drawer", { as: "venueOwner", does: w("venue", "replace", "/1/occasions/1/name", "The Ashcombe Festival 2027"), seen: { venueOwner: "venue/1 @ drawer=occasion/1", authority: "series/1", promoter: "occasion/1" } }),
    story("The Downs Company hands the Festival's packaging to Festival Promotions in the occasion's drawer, and the occasion appears on the promoter's box", { as: "venueOwner", does: w("venue", "add", "/1/occasions/1/delegations/-", { promoter_org_id: 3 }), seen: { venueOwner: "venue/1 @ drawer=occasion/1", promoter: "" } }),
    story("The Board grants a permit for the Old Hollow enclosure in the occasion's drawer on its wall", { as: "authority", does: w("series", "add", "/1/occasions/1/permits/-", { area_id: 2 }), seen: { authority: "series/1 @ drawer=occasion/1", venueOwner: "venue/1" } }),
    story("The Board revokes the Paddock permit, and the accepted deployment standing on it shows a revoked permit on the project's map, on the venue's map and on Sam's build", { as: "authority", does: w("series", "replace", "/1/occasions/1/permits/1/status", "revoked"), seen: { authority: "series/1 @ drawer=occasion/1", contractor: "projects/1", venueOwner: "venue/1/deployments", worker: "assignments/1" } }),
    story("The Downs Company grants a permit for its own winning-post boards, and the site on its map shows it", { as: "venueOwner", does: w("venue", "add", "/1/occasions/1/permits/-", { site_id: 2 }), seen: { venueOwner: "venue/1" } }),
    story("The Downs Company revokes its own permit on the parade ring screen, and the deployment proposed there shows it on the project's map", { as: "venueOwner", does: w("venue", "replace", "/1/occasions/1/permits/3/status", "revoked"), seen: { venueOwner: "venue/1", contractor: "projects/1" } }),
    story("A permit is revoked by whoever granted it: the Board's drawer has no revoke on the venue's own permit", { as: "authority", cannot: w("series", "replace", "/1/occasions/1/permits/3/status", "revoked") }),
    story("Festival Promotions has no permit to grant on anyone's map", { as: "promoter", cannot: w("series", "add", "/1/occasions/1/permits/-", { area_id: 1 }) }),

    // ── The promoter: the map with the rights coloured by package ──
    story("Festival Promotions adds an event, and it appears on the occasion's time tool", { as: "promoter", does: w("occasion", "add", "/events/-", { name: "Champion day", from_at: "2027-03-16T10:00", to_at: "2027-03-16T18:00" }), seen: { promoter: "occasion/1" } }),
    story("Festival Promotions adds a moment to the time tool", { as: "promoter", does: w("occasion", "add", "/moments/-", { name: "Silver Bowl presentation", at: "2027-03-19T16:35" }), seen: { promoter: "occasion/1" } }),
    story("Festival Promotions moves an event in its drawer, and the time tool follows", { as: "promoter", does: many("occasion", [["/events/1/from_at", "2027-03-19T10:30"], ["/events/1/to_at", "2027-03-19T18:30"]]), seen: { promoter: "occasion/1 @ drawer=event/1" } }),
    story("Festival Promotions strikes an event created in error; it is retired in its drawer, not deleted, and the time tool greys it", { as: "promoter", does: w("occasion", "replace", "/events/1/valid_to", "2027-01-01"), seen: { promoter: "occasion/1 @ drawer=event/1" } }),
    story("Festival Promotions strikes a moment", { as: "promoter", does: w("occasion", "replace", "/moments/1/valid_to", "2027-01-01"), seen: { promoter: "occasion/1 @ drawer=moment/1" } }),
    story("Festival Promotions names a package, and a new colour appears in the packages cell beside the map; the venue sees it on its occasion", { as: "promoter", does: w("occasion", "add", "/packages/-", { name: "Parade ring" }), seen: { promoter: "occasion/1", venueOwner: "venue/1 @ drawer=occasion/1" } }),
    story("Festival Promotions paints the parade ring screen with the draft package's colour, for four days", { as: "promoter", does: w("occasion", "add", "/packages/1/rights/-", { site_id: 1, from_at: "2027-03-16T09:00", to_at: "2027-03-19T19:00" }), seen: { promoter: "occasion/1", venueOwner: "venue/1 @ time=2027-03-16" } }),
    story("Festival Promotions widens a right's window in its drawer on an offered package, and the market's row shows the new hours", { as: "promoter", does: many("occasion", [["/packages/2/rights/2/from_at", "2027-03-16T08:00"], ["/packages/2/rights/2/to_at", "2027-03-19T20:00"]]), seen: { promoter: "occasion/1 @ drawer=right/2", venueOwner: "venue/1 @ time=2027-03-16", sponsor: "market" } }),
    story("Festival Promotions renames a package in its drawer", { as: "promoter", does: w("occasion", "replace", "/packages/1/name", "Parade ring, all four days"), seen: { promoter: "occasion/1 @ drawer=package/1", venueOwner: "venue/1 @ drawer=occasion/1" } }),
    story("Festival Promotions offers the package with the tool on its row, and it is a row on the market", { as: "promoter", does: w("occasion", "replace", "/packages/1/status", "offered"), seen: { promoter: "occasion/1", venueOwner: "venue/1 @ drawer=occasion/1", sponsor: "market" } }),
    story("An offered package's row has no offer tool left on it", { as: "promoter", cannot: w("occasion", "replace", "/packages/2/status", "offered") }),
    story("Harrow sees the rights but can paint none", { as: "sponsor", cannot: w("occasion", "add", "/packages/-", { name: "Ours" }) }),

    // ── Campaigns, and the market every sponsor reads ──
    story("Festival Promotions assembles a campaign from a package, and it is a row in its campaigns", { as: "promoter", does: w("campaigns", "add", "/-", { name: "Festival week", packages: [1] }), seen: { promoter: "campaigns" } }),
    story("Festival Promotions renames a campaign in its drawer and gives it a picture", { as: "promoter", does: many("campaigns", [["/1/name", "Festival week, parade ring"], ["/1/image_url", "/pictures/parade.jpg"]]), seen: { promoter: "campaigns @ drawer=campaign/1" } }),
    story("Festival Promotions offers a campaign with the tool on its row, and it is a row on the market with its rights on the map beneath", { as: "promoter", does: w("campaigns", "replace", "/1/status", "offered"), seen: { promoter: "campaigns", sponsor: "market" } }),
    story("Festival Promotions withdraws a campaign that is no longer viable, and the market's row goes", { as: "promoter", does: w("campaigns", "replace", "/2/status", "withdrawn"), seen: { promoter: "campaigns", sponsor: "market" } }),
    story("Harrow's market rows carry buy, never offer", { as: "sponsor", cannot: w("campaigns", "replace", "/1/status", "offered") }),

    // ── The sponsor: brands, the brief in place, stock ──
    story("Harrow adds a brand, and the brands cell on its box shows two", { as: "sponsor", does: w("sponsor", "add", "/brands/-", { name: "Harrow 0.0" }), seen: { sponsor: "" }, untold: ["contractor", "promoter"] }),
    story("Harrow renames a brand in its drawer and gives it a picture", { as: "sponsor", does: many("sponsor", [["/brands/1/name", "Harrow Draught"], ["/brands/1/image_url", "/pictures/harp.png"]]), seen: { sponsor: "brands @ drawer=brand/1" } }),
    story("Harrow drops artwork into a brand's drawer", { as: "sponsor", does: w("sponsor", "add", "/brands/1/artwork/-", { url: "/pictures/gold-cup-2027.png" }), seen: { sponsor: "brands @ drawer=brand/1" } }),
    story("Harrow replaces a piece of artwork", { as: "sponsor", does: w("sponsor", "replace", "/brands/1/artwork/1/url", "/pictures/gold-cup-2027-v2.png"), seen: { sponsor: "brands @ drawer=brand/1" } }),
    story("Harrow opens an engagement with a brief, and it is a box to step into from its home", { as: "sponsor", does: w("engagements", "add", "/-", { budget: 250000, objective: "Own the parade ring", target_tv: 90, target_footfall: 200000 }), seen: { sponsor: "" } }),
    story("Harrow revises the brief in place on the engagement's box, and Londons reads the new targets beside its map", { as: "sponsor", does: many("engagements", [["/1/budget", 300000], ["/1/objective", "Own the parade ring and the winning post"], ["/1/target_pr", 50]]), seen: { sponsor: "engagements/1", contractor: "scenario/2" } }),
    story("Harrow declares stock, and it is a row in its stock", { as: "sponsor", does: w("stock", "add", "/-", { product_id: 1, artwork_id: 1, location: "Dublin warehouse", qty: 20, condition: "new" }), seen: { sponsor: "stock" } }),
    story("Harrow corrects a quantity on the row, and Londons's custody shows it", { as: "sponsor", does: w("stock", "replace", "/1/qty", 10), seen: { sponsor: "stock", contractor: "custody" } }),
    story("Londons records the stock's condition and where it is on return, in the row's drawer, and Harrow's row says so", { as: "contractor", does: many("custody", [["/1/location", "Londons yard, Bristol"], ["/1/qty", 11], ["/1/condition", "one torn"]]), seen: { contractor: "custody @ drawer=stock/1", sponsor: "stock" } }),

    // ── Scenarios: the map with the placements on the rights ──
    story("Harrow commissions a scenario from Londons; it is a row in the engagement's scenarios, and a commission on Londons's queue", { as: "sponsor", does: w("engagements", "add", "/1/scenarios/-", { contractor_org_id: 5, name: "Parade ring takeover" }), seen: { sponsor: "engagements/1", contractor: "" } }),
    story("Londons renames a scenario in place at the top of its map, and Harrow's row says so", { as: "contractor", does: w("scenario", "replace", "/name", "Parade ring and winning post"), seen: { contractor: "scenario/1", sponsor: "engagements/1" } }),
    story("Londons drops the LED tower onto the winning-post right on its map; the venue and the promoter see the placement on the same right", { as: "contractor", does: w("scenario", "add", "/placements/-", { right_id: 2, product_id: 2, from_at: "2027-03-15T08:00", to_at: "2027-03-19T22:00" }), seen: { contractor: "scenario/1", sponsor: "engagements/1", venueOwner: "venue/1 @ time=2027-03-16", promoter: "occasion/1 @ time=2027-03-16" } }),
    story("Londons dresses the placed module's face for the four days, in the placement's drawer", { as: "contractor", does: w("scenario", "add", "/placements/1/faces/-", { face_id: 1, from_at: "2027-03-16T09:00", to_at: "2027-03-19T19:00", elevation: 3, orientation: "S" }), seen: { contractor: "scenario/3 @ drawer=placement/1", sponsor: "engagements/1" } }),
    story("Londons adjusts the dressed face's effective performance in its drawer, and Harrow's box measures the scenario against its targets again", { as: "contractor", does: many("scenario", [["/placements/1/faces/1/tv", 85], ["/placements/1/faces/1/footfall", 55000], ["/placements/1/faces/1/pr", 40]]), seen: { contractor: "scenario/3 @ drawer=face/1", sponsor: "engagements/1" } }),
    story("Londons adjusts the dressing's window and rig", { as: "contractor", does: many("scenario", [["/placements/1/faces/1/from_at", "2027-03-16T08:00"], ["/placements/1/faces/1/elevation", 4]]), seen: { contractor: "scenario/3 @ drawer=face/1", sponsor: "engagements/1" } }),
    story("Londons widens a placement's physical window in its drawer, and on the venue's map the module is there a day earlier", { as: "contractor", does: many("scenario", [["/placements/1/from_at", "2027-03-14T08:00"], ["/placements/1/to_at", "2027-03-20T12:00"]]), seen: { contractor: "scenario/3 @ drawer=placement/1", sponsor: "engagements/1", venueOwner: "venue/1 @ time=2027-03-14" } }),
    story("Londons prices the placement in its drawer, and the scenario's total moves on Harrow's row", { as: "contractor", does: many("scenario", [["/placements/1/acquisition_cost", 12000], ["/placements/1/transport_cost", 1800], ["/placements/1/activity_cost", 6500]]), seen: { contractor: "scenario/3 @ drawer=placement/1", sponsor: "engagements/1" } }),
    story("Londons adds a requirement to the face: buy four banners", { as: "contractor", does: w("scenario", "add", "/placements/1/faces/1/requirements/-", { product_id: 1, artwork_id: 1, qty: 4, fulfilment: "buy" }), seen: { contractor: "scenario/3 @ drawer=face/1" } }),
    story("Londons changes the requirement to stock in its drawer, and the open line on every supplier's queue shows the change", { as: "contractor", does: many("scenario", [["/placements/1/faces/1/requirements/1/qty", 6], ["/placements/1/faces/1/requirements/1/fulfilment", "stock"]]), seen: { contractor: "scenario/3 @ drawer=requirement/1", supplier: "open-supply" } }),
    story("Londons proposes the scenario with the tool on its map, and it is Harrow's move on its queue", { as: "contractor", does: w("scenario", "replace", "/status", "proposed"), seen: { contractor: "scenario/1", sponsor: "" } }),
    story("Harrow approves on the row, and Londons's map says approved", { as: "sponsor", does: w("engagements", "replace", "/1/scenarios/2/status", "approved"), seen: { sponsor: "engagements/1", contractor: "scenario/2" } }),
    story("Harrow rejects on the row", { as: "sponsor", does: w("engagements", "replace", "/1/scenarios/2/status", "rejected"), seen: { sponsor: "engagements/1", contractor: "scenario/2" } }),
    story("Harrow takes back an approval given in error, and the scenario is proposed again", { as: "sponsor", does: w("engagements", "replace", "/1/scenarios/3/status", "proposed"), seen: { sponsor: "engagements/1", contractor: "scenario/3" } }),
    story("Londons revises and re-proposes a rejected scenario", { as: "contractor", does: w("scenario", "replace", "/status", "proposed"), seen: { contractor: "scenario/4", sponsor: "engagements/1" } }),
    story("Londons withdraws a rejected scenario", { as: "contractor", does: w("scenario", "replace", "/status", "withdrawn"), seen: { contractor: "scenario/4", sponsor: "engagements/1" } }),
    story("Londons withdraws from an approved commission", { as: "contractor", does: w("scenario", "replace", "/status", "withdrawn"), seen: { contractor: "scenario/3", sponsor: "engagements/1" } }),
    story("Londons's map has no approve tool; that control is on Harrow's row", { as: "contractor", cannot: w("scenario", "replace", "/status", "approved") }),
    story("Harrow's engagement has no map to place on; the placements are the contractor's", { as: "sponsor", cannot: w("scenario", "add", "/placements/-", { right_id: 2, product_id: 1 }) }),
    story("A draft nobody has proposed carries no approve", { as: "sponsor", cannot: w("engagements", "replace", "/1/scenarios/1/status", "approved") }),

    // ── The purchase, on the market's row ──
    story("Harrow buys the offered campaign on its market row, with its approved scenario; the engagement's box says agreed, the promoter's row says sold, its package is agreed too, and the rights on the venue's map say sold", { as: "sponsor", does: w("market", "replace", "/campaigns/2/status", "agreed"), seen: { sponsor: "engagements/1", promoter: "campaigns", venueOwner: "venue/1 @ time=2027-03-16" } }),
    story("Harrow buys an offered package on its own market row, with its approved scenario; the engagement's box says agreed, the promoter's package row says sold, and the campaign holding it leaves the market", { as: "sponsor", does: w("market", "replace", "/packages/2/status", "agreed"), seen: { sponsor: "engagements/1", promoter: "occasion/1", venueOwner: "venue/1 @ time=2027-03-16" } }),
    story("A campaign not on offer has no row on the market to buy from", { as: "sponsor", cannot: w("market", "replace", "/campaigns/1/status", "agreed") }),
    story("A sold package has no row on any sponsor's market", { as: "sponsor", cannot: w("market", "replace", "/packages/3/status", "agreed") }),
    story("A campaign holding a sold package has left the market, though the promoter still has it on offer", { as: "sponsor", cannot: w("market", "replace", "/campaigns/3/status", "agreed") }),

    // ── The catalogue: a collection, and a product's box ──
    story("Londons creates a product, and it is a row in the catalogue; no one else's page moves", { as: "contractor", does: w("catalogue", "add", "/-", { name: "3m A-frame", kind: "module", cost: 800, markup_percent: 30, rentable_days: 5 }), seen: { contractor: "catalogue" }, untold: ["sponsor", "worker"] }),
    story("Londons changes a product's details in place on its box, and Sam's build, which uses it, reads the new name", { as: "contractor", does: many("catalogue", [["/1/name", "6m banner frame, aluminium"], ["/1/cost", 2400], ["/1/rentable_days", 7]]), seen: { contractor: "catalogue/1", worker: "assignments/1" } }),
    story("Londons retires the LED tower on its box; revalidating is the same field", { as: "contractor", does: w("catalogue", "replace", "/2/valid_to", "2027-06-30"), seen: { contractor: "catalogue/2" } }),
    story("Londons adds a part in the parts cell", { as: "contractor", does: w("catalogue", "add", "/1/parts/-", { child_product_id: 2, qty: 2 }), seen: { contractor: "catalogue/1" } }),
    story("Londons changes a part's quantity on its row", { as: "contractor", does: w("catalogue", "replace", "/1/parts/1/qty", 3), seen: { contractor: "catalogue/1" } }),
    story("Londons adds a face in the faces cell", { as: "contractor", does: w("catalogue", "add", "/1/faces/-", { name: "Reverse" }), seen: { contractor: "catalogue/1" } }),
    story("Londons renames a face in its drawer", { as: "contractor", does: w("catalogue", "replace", "/1/faces/1/name", "Front, trackside"), seen: { contractor: "catalogue/1 @ drawer=face/1" } }),
    story("Londons says in the face's drawer which products it can carry", { as: "contractor", does: w("catalogue", "add", "/1/faces/1/supports/-", { product_id: 2 }), seen: { contractor: "catalogue/1 @ drawer=face/1" } }),
    story("Londons adds a lifecycle task in the tasks cell, and Sam's build gains a step to tick", { as: "contractor", does: w("catalogue", "add", "/1/tasks/-", { kind: "build", name: "Level the base", duration_mins: 30, skill: "rigger", crew: 2 }), seen: { contractor: "catalogue/1", worker: "assignments/1" } }),
    story("Londons changes a task's duration and crew in its drawer", { as: "contractor", does: many("catalogue", [["/1/tasks/1/duration_mins", 90], ["/1/tasks/1/crew", 3]]), seen: { contractor: "catalogue/1 @ drawer=task/1", worker: "assignments/1" } }),
    story("Londons links a task to the one it depends on, in its drawer, and Sam's list reorders", { as: "contractor", does: w("catalogue", "add", "/1/tasks/1/depends/-", { depends_on_task_id: 2 }), seen: { contractor: "catalogue/1 @ drawer=task/1", worker: "assignments/1" } }),
    story("Londons adds a resource to a task", { as: "contractor", does: w("catalogue", "add", "/1/tasks/1/resources/-", { resource_product_id: 2, qty: 1, shared: true }), seen: { contractor: "catalogue/1 @ drawer=task/1" } }),
    story("Londons changes a task resource", { as: "contractor", does: many("catalogue", [["/1/tasks/1/resources/1/qty", 2], ["/1/tasks/1/resources/1/shared", false]]), seen: { contractor: "catalogue/1 @ drawer=task/1" } }),
    story("Londons sets a skill rate, a row in its rates", { as: "contractor", does: w("rates", "add", "/-", { skill: "electrician", hourly_rate: 48 }), seen: { contractor: "rates" } }),
    story("Londons changes a rate on its row", { as: "contractor", does: many("rates", [["/1/skill", "rigger, senior"], ["/1/hourly_rate", 42]]), seen: { contractor: "rates" } }),
    story("Northgate Signs has no catalogue but its own to edit", { as: "supplier", cannot: w("catalogue", "replace", "/1/cost", 1) }),

    // ── The project: the map with the deployments on the sites ──
    story("Londons opens a project for the Festival, and its box shows a project to step into", { as: "contractor", does: w("projects", "add", "/-", { occasion_id: 1 }), seen: { contractor: "" } }),
    story("Londons drops a deployment onto the parade ring screen on the project's map, and on the venue's deployments map it is a proposal with accept and reject on it", { as: "contractor", does: w("projects", "add", "/1/deployments/-", { placement_id: 1, venue_id: 1 }), seen: { contractor: "projects/1", venueOwner: "venue/1/deployments", sponsor: "engagements/1" } }),
    story("The Downs Company accepts the deployment on its map, and the project's map turns it solid", { as: "venueOwner", does: w("venue-deployments", "replace", "/1/status", "accepted"), seen: { venueOwner: "venue/1/deployments", contractor: "projects/1", sponsor: "engagements/1" } }),
    story("The Downs Company rejects the deployment", { as: "venueOwner", does: w("venue-deployments", "replace", "/1/status", "rejected"), seen: { venueOwner: "venue/1/deployments", contractor: "projects/1", sponsor: "engagements/1" } }),
    story("Londons re-proposes an adjusted deployment from its drawer", { as: "contractor", does: w("projects", "replace", "/1/deployments/5/status", "proposed"), seen: { contractor: "projects/1 @ drawer=deployment/5", venueOwner: "venue/1/deployments" } }),
    story("Londons cancels a rejected deployment, and it leaves both maps", { as: "contractor", does: w("projects", "replace", "/1/deployments/5/status", "cancelled"), seen: { contractor: "projects/1", venueOwner: "venue/1/deployments" } }),
    story("Londons withdraws an accepted deployment; the venue's map, Sam's wall and Harrow's box all lose it", { as: "contractor", does: w("projects", "replace", "/1/deployments/2/status", "cancelled"), seen: { contractor: "projects/1", venueOwner: "venue/1/deployments", worker: "", sponsor: "engagements/1" } }),
    story("Londons resolves a blocked deployment back to accepted with the tool in its drawer, and the build is back on Sam's wall to do", { as: "contractor", does: w("projects", "replace", "/1/deployments/4/status", "accepted"), seen: { contractor: "projects/1 @ drawer=deployment/4", venueOwner: "venue/1/deployments", worker: "" } }),
    story("Londons cancels a deployment that cannot proceed, and Sam's blocked build comes off the wall", { as: "contractor", does: w("projects", "replace", "/1/deployments/4/status", "cancelled"), seen: { contractor: "projects/1", venueOwner: "venue/1/deployments", worker: "" } }),
    story("Londons's own proposal carries no accept; that control is on the venue's map", { as: "contractor", cannot: w("projects", "replace", "/1/deployments/1/status", "accepted") }),
    story("The venue's map has no built tool; that is on Sam's build", { as: "venueOwner", cannot: w("venue-deployments", "replace", "/2/status", "built") }),
    story("Londons closes the project with the tool at the foot of its page, and the venue's map shows the project closed", { as: "contractor", does: w("projects", "replace", "/1/status", "closed"), seen: { contractor: "projects/1", venueOwner: "venue/1/deployments" } }),

    // ── The work: the wall of the project's days, and Sam's wall ──
    story("Londons draws a work window on the wall", { as: "contractor", does: w("projects", "add", "/1/windows/-", { area_id: 1, from_at: "2027-03-14T07:00", to_at: "2027-03-14T19:00" }), seen: { contractor: "projects/1" } }),
    story("Londons stretches the window in its drawer, and Sam's wall shows the longer day", { as: "contractor", does: many("projects", [["/1/windows/1/from_at", "2027-03-14T06:00"], ["/1/windows/1/to_at", "2027-03-14T20:00"]]), seen: { contractor: "projects/1 @ drawer=window/1", worker: "" } }),
    story("Londons plans a trip on the wall", { as: "contractor", does: w("projects", "add", "/1/trips/-", { departs_at: "2027-03-13T14:00", returns_at: "2027-03-20T12:00", fuel_cost: 180, tolls_cost: 0, accommodation_cost: 1400 }), seen: { contractor: "projects/1" } }),
    story("Londons brings the trip's departure forward in its drawer, and Sam's wall says so", { as: "contractor", does: many("projects", [["/1/trips/1/departs_at", "2027-03-13T12:00"], ["/1/trips/1/accommodation_cost", 1600]]), seen: { contractor: "projects/1 @ drawer=trip/1", worker: "" } }),
    story("Londons puts Sam in the window from its drawer, and the day appears on Sam's wall", { as: "contractor", does: w("projects", "add", "/1/windows/1/assignments/-", { person_id: 1, trip_id: 1, deployment_id: 2 }), seen: { contractor: "projects/1 @ drawer=window/1", worker: "" } }),
    story("A deployment the venue has not accepted takes no worker", { as: "contractor", cannot: w("projects", "add", "/1/windows/1/assignments/-", { person_id: 1, trip_id: 1, deployment_id: 1 }) }),
    story("Londons opens a task on an accepted deployment in its drawer, and Sam's build has a step to tick", { as: "contractor", does: w("projects", "add", "/1/deployments/2/tasks/-", { taskdef_id: 2 }), seen: { contractor: "projects/1 @ drawer=deployment/2", worker: "assignments/1" } }),
    story("Sam marks the week unavailable in place at the top of the wall, and Londons's wall shows Sam away", { as: "worker", does: w("worker", "replace", "/available", false), seen: { worker: "", contractor: "projects/1" } }),
    story("Sam marks the week available again, and Londons's wall shows Sam free", { as: "worker", does: w("worker", "replace", "/available", true), seen: { worker: "", contractor: "projects/1" } }),
    story("Sam changes name, skills and rate in place", { as: "worker", does: many("worker", [["/name", "Sam Reilly"], ["/skills", "rigger, electrician"], ["/day_rate", 260]]), seen: { worker: "" } }),
    story("Sam ticks a task on the row, and the project's map shows the build a step further", { as: "worker", does: w("worker", "replace", "/assignments/1/deployment/tasks/1/status", "done"), seen: { worker: "assignments/1", contractor: "projects/1 @ drawer=deployment/2" } }),
    story("Sam unticks a task ticked by mistake", { as: "worker", does: w("worker", "replace", "/assignments/1/deployment/tasks/2/status", "todo"), seen: { worker: "assignments/1", contractor: "projects/1 @ drawer=deployment/2" } }),
    story("Sam unskips a task skipped by mistake", { as: "worker", does: w("worker", "replace", "/assignments/1/deployment/tasks/3/status", "todo"), seen: { worker: "assignments/1", contractor: "projects/1 @ drawer=deployment/2" } }),
    story("Sam skips a task on the row; not needed for this build", { as: "worker", does: w("worker", "replace", "/assignments/1/deployment/tasks/1/status", "skipped"), seen: { worker: "assignments/1", contractor: "projects/1 @ drawer=deployment/2" } }),
    story("Sam presses built on the build's box; the project's map, the venue's map and Harrow's box all show the module up", { as: "worker", does: many("worker", [["/assignments/1/status", "done"], ["/assignments/1/deployment/status", "built"]]), seen: { worker: "assignments/1", contractor: "projects/1", venueOwner: "venue/1/deployments", sponsor: "engagements/1" } }),
    story("Sam takes back a built pressed by mistake", { as: "worker", does: w("worker", "replace", "/assignments/2/deployment/status", "accepted"), seen: { worker: "assignments/2", contractor: "projects/1", venueOwner: "venue/1/deployments" } }),
    story("Sam reopens an assignment marked done by mistake, and it is back on the wall as work", { as: "worker", does: w("worker", "replace", "/assignments/2/status", "assigned"), seen: { worker: "", contractor: "projects/1" } }),
    story("Sam presses struck, and the module leaves the maps", { as: "worker", does: many("worker", [["/assignments/2/status", "done"], ["/assignments/2/deployment/status", "struck"]]), seen: { worker: "assignments/2", contractor: "projects/1", venueOwner: "venue/1/deployments" } }),
    story("Sam presses blocked, and it is Londons's move on its queue", { as: "worker", does: w("worker", "replace", "/assignments/1/deployment/status", "blocked"), seen: { worker: "assignments/1", contractor: "", venueOwner: "venue/1/deployments" } }),
    story("Sam declines an assignment on its row, and it comes off the wall", { as: "worker", does: w("worker", "replace", "/assignments/1/status", "declined"), seen: { worker: "", contractor: "projects/1 @ drawer=window/1" } }),
    story("Sam's build box has no accept; that is on the venue's map", { as: "worker", cannot: w("worker", "replace", "/assignments/1/deployment/status", "accepted") }),
    story("Londons's project shows Sam's tasks but the ticks are Sam's", { as: "contractor", cannot: w("projects", "replace", "/1/deployments/2/tasks/1/status", "done") }),

    // ── Supply: the fourth agreement, on rows ──
    story("Londons lists a supply line from the buy requirement, and it is an open line on every supplier's queue with offer on the row", { as: "contractor", does: w("projects", "add", "/1/supply/-", { requirement_id: 1 }), seen: { contractor: "projects/1", supplier: "" } }),
    story("Northgate Signs offers on the row, and on the project the line's row shows an offer with accept and decline on it", { as: "supplier", does: w("opportunities", "add", "/-", { supply_line_id: 1, price: 1150 }), seen: { supplier: "opportunities", contractor: "projects/1" } }),
    story("Northgate Signs revises its price in the offer's drawer, and the project's row shows the new price", { as: "supplier", does: w("opportunities", "replace", "/1/price", 1050), seen: { supplier: "opportunities @ drawer=offer/1", contractor: "projects/1" } }),
    story("Northgate Signs withdraws its offer on the row", { as: "supplier", does: w("opportunities", "replace", "/1/status", "withdrawn"), seen: { supplier: "opportunities", contractor: "projects/1" } }),
    story("Londons accepts the offer on the row; the line is filled, and it leaves every supplier's open list", { as: "contractor", does: many("projects", [["/1/supply/1/offers/1/status", "accepted"], ["/1/supply/1/status", "accepted"]]), seen: { contractor: "projects/1", supplier: "opportunities" } }),
    story("Londons declines the offer on the row", { as: "contractor", does: w("projects", "replace", "/1/supply/1/offers/1/status", "declined"), seen: { contractor: "projects/1", supplier: "opportunities" } }),
    story("Northgate Signs's own offer carries no accept", { as: "supplier", cannot: w("opportunities", "replace", "/1/status", "accepted") }),
    story("A filled line has no offer on its row", { as: "supplier", cannot: w("opportunities", "add", "/-", { supply_line_id: 2, price: 900 }) }),
    story("A stranger sees the open lines and their rows carry nothing", { as: "stranger", cannot: w("opportunities", "add", "/-", { supply_line_id: 1, price: 1 }) }),
  ],
};
