# Meta‑Driven UX Wireframe (Concept, No Code)

> Purpose: Manifest the graph as a **navigable, composable surface** (not a wizard), driven entirely by metadata: entities, relations, paths, permissions, notifications, schema hints.

---

## 0) Legend
- **Node** = a `navigationGraph` entry (context: where you are, what you can do, how you got here).
- **Edge** = a `navigation_options` transition (why/how to go somewhere else).
- **Guard** = `permission_paths` rule (whether an action is available, per actor & record).
- **Surface** = a composite view mode selected by `ui_hints` + schema semantics (table, form, calendar, map, kanban, gantt).
- **Facet** = secondary panel (FK badges, notifications, related summaries) that composes into the surface.

---

## 1) Global Map (the Graph manifested)
```
[user] ──acts_for──▶ (organisations)
   │                         │
   │                         ├──▶ (venues) ──▶ (areas) ──▶ (sites)
   │                         │                      ╲──────╱
   │                         │                          (packages) ◀──┐
   │                         └──▶ (products)                            │
   │                                                                    │
   └────────────────────────────────────────────────────────────────────┘

(organisations) ───▶ (occasions) ─▶ (packages) ── invites ─▶ (sponsors)
        │                                        └─ rights ─▶ (contractors)
        │                                                         │
        └─────────────────────────────────────────────────────────┴─▶ (contractor_rights)

(packages) ◀── many‑to‑many ──▶ (sites) via (allocations) [from_date,to_date]

Decisions/Status live on: packages.status; allocations lifecycle
Temporal: allocations.from_date/to_date; occasions.start_date/end_date
Geo: venues.address (map entry point)
```

> The **Global Map** is always available as a collapsible overlay: a zoomable graph showing your breadcrumb path and reachable neighbors (edges), with guards coloring what you can activate.

---

## 2) Node Template (applies to *every* node)
```
┌─────────────────────────────────────────────────────────────────────┐
│ Breadcrumb: acts_for › organisations › venues                        │
│ Path: acts_for.id→organisations.id→venues.org_id                     │
├─────────────────────────────────────────────────────────────────────┤
│ Primary Surface  [table | form | calendar | map | kanban | gantt]   │
│  • Decided by ui_hints + schema semantics                            │
│  • Selection modes: none | single | multi                            │
├───────────────┬───────────────────────────────┬──────────────────────┤
│ Actions       │ Facets                        │ Next Steps (Edges)   │
│  • Create*    │  • FK badges (fk_includes)    │  → To: sites (1‑M)   │
│  • Update*    │  • Notifications (pre‑view)   │    via venues.id→…    │
│  • Delete*    │  • Related summaries           │  → To: packages (M‑M)│
│  (*guarded)   │  • Audit/History (temporal)   │  …                   │
└───────────────┴───────────────────────────────┴──────────────────────┘

- **Actions** exist only if their **guards** pass in the current selection context.
- **Facets** are read‑through context: FK includes, recipients (derived from notification paths), related mini‑lists.
- **Next Steps** are edges from `navigation_options`, always visible (grayed if guard on landing action would fail).
```

---

## 3) Surface Synthesis Rules (no hardcoded switch)
**Inputs:** `ui_hints`, `schema[entity]`, field semantics (e.g., temporal pairs), data volume.

1. **Map**
   - Chosen when `ui_hints.geo_fields.length > 0` (e.g., venues.address).
   - Composite: map canvas + tabular drawer. Cluster by relation (e.g., venues per organisation).
2. **Calendar / Gantt**
   - Chosen when temporal fields exist: explicit in `ui_hints.temporal_fields` or pair `[start,end]` in schema.
   - Calendar for day/week/month; Gantt for multi‑record spans (allocations by site/package).
3. **Kanban**
   - Chosen when an enum/status column is present (e.g., packages.status).
   - Columns = status values; transitions = guarded actions.
4. **Table**
   - Default for non‑geo, non‑temporal entities. Columns and filters from schema; FK chips.
5. **Form**
   - Secondary surface for create/update; appears inline as a drawer/modal, not a page.

> Surfaces can **compose** (e.g., Map + Table; Gantt + Filters). The node decides the *primary*; others are tabs.

---

## 4) Key Wireframes by Domain

### 4.1 Organisations (Table primary)
```
[Search: name/description]   (Create Organisation) [guarded]
┌──────┬──────────────┬──────────────┐
│ id   │ name         │ description  │
├──────┼──────────────┼──────────────┤
│ …    │ …            │ …            │
└──────┴──────────────┴──────────────┘
Facets: Acts‑for members; Counts (venues, products, packages)
Next Steps: Venues (1‑M, Map); Products (1‑M, Table); Packages (M‑M, Table)
```

### 4.2 Venues (Map primary)
```
Map( markers = geocoded address )
Drawer Table: id | name | address | description
Actions: Create Venue [guarded], Update/Delete per selection
Next Steps: Sites (1‑M, Table); Organisations (M‑1, Table)
```

### 4.3 Areas (Table primary)  *extension*
```
Within a selected Venue:
Table: id | name | description
Next Steps: Sites (1‑M)
```

### 4.4 Sites (Table primary)
```
Filter by Venue/Area
Table: id | name | description | venue
Next Steps: Packages (M‑M via allocations); Venue (M‑1 Map)
```

### 4.5 Products (Table / Kanban optional)
```
Table: id | name | price | org
Optional Kanban: by category/status if defined
```

### 4.6 Occasions (Calendar/Gantt)  *extension*
```
Calendar: start_date/end_date blocks (per organisation)
Gantt grouping: Packages under an Occasion
Next Steps: Packages (1‑M)
```

### 4.7 Packages (Kanban primary, Table secondary)
```
Kanban columns: draft | proposed | confirmed | fulfilled
Card: name • price • owner_org • sponsor_org
Actions: Invite sponsor (notification facet preview) [guarded]
Next Steps: Sites (M‑M); Organisations (M‑M: owner/sponsor); Contractor Rights
```

### 4.8 Contractor Rights (Table primary)
```
Table: contractor_org | sponsor_org | package | valid_from | valid_to
Actions: Create/Update/Delete [guarded by sponsor]
Next Steps: Packages, Organisations (contractor), Organisations (sponsor)
```

### 4.9 Allocations (Calendar/Gantt primary)
```
Calendar: from_date → to_date windows per Site/Package
Gantt view: Rows grouped by Site (or by Contractor), bars = allocations
Actions: Propose/Confirm/Cancel (status transitions, each with a guard)
Facets: Notification preview (delegated/ownership/commercial audiences)
```

---

## 5) Non‑Wizard Progression (Guided, but Freeform)
- **Ambient Guidance:** A slim “Recommended Next” chip appears if any adjacent node’s guard passes (e.g., after creating a package, suggest “Invite sponsor”).
- **No Forced Linear Flow:** Users always see all edges; guards color them (green = available, grey = blocked with reason tooltip).
- **Context Carrying:** When traversing an edge, the selection is carried as params (e.g., current package filters Sites panel automatically).

---

## 6) Guards & Effects as First‑Class UI
- **Guards** (permission paths) render as:
  - Enabled/disabled state of actions.
  - Explanation tooltip: “Requires acts_for membership in owner_org (valid today).”
- **Effects** (notification paths) render as:
  - Pre‑flight “Recipients” facet: list of users to be notified if this action commits.
  - Post‑commit toast with recipient summary.

---

## 7) Breadcrumb & Path Awareness
- Breadcrumb is the human spine of the node; the **Path** string is the technical spine.
- Both are visible: users know *where they are* and *how they arrived*.
- Clicking breadcrumb segments jumps to that node with the prior selection context.

---

## 8) Composite Examples

### A) Venue Node (Map + Table)
```
┌ Map canvas ────────────────────────────────────────────────┐
│ markers: venues.address                                    │
└────────────────────────────────────────────────────────────┘
┌ Table: venues                                              │
│ id | name | address | description                          │
└────────────────────────────────────────────────────────────┘
Actions: [Create Venue]* [Update]* [Delete]*    (*guarded)
Facets: Organisation badge; Counts (sites)
Edges: → Sites (1‑M), → Organisations (M‑1)
```

### B) Packages Node (Kanban + Facets)
```
[draft] [proposed] [confirmed] [fulfilled]
Cards show: name • price • owner_org • sponsor_org
Actions per card: Invite Sponsor*, Add Contractor Right*, Link Sites*  (*guarded)
Facet on hover: Next notifications → {ownership, commercial}
Edges: → Sites (M‑M), → Organisations (owner/sponsor), → Allocations
```

### C) Allocations Node (Gantt)
```
Rows: Sites
Bars: allocations.from_date → to_date
Swimlanes: by Package (color), optional by Contractor
Actions on bar: Confirm*, Cancel* (explain guard on hover)
Edges: ← back to Packages, → Sites, → Organisations
```

---

## 9) Minimal Metadata Extensions (Concept‑only)
- **Field semantics:** declare `status` fields and `[start,end]` temporal pairs to power Kanban/Gantt selection.
- **Areas & Occasions:** light entities filling the domain gaps; add associated nodes/edges.
- **Effect labels:** name notification bundles to surface in the UI as facets (“Ownership”, “Commercial”, “Delegated”).

> Everything else is already present in your metadata (entities, relations, guards, hints). The UI only needs to *read* it.

---

## 10) How This Scales (Graph Evolution)
- New entity? Add schema + entity + relations + node with hints → appears as a new island with edges; guards control visibility.
- New relation? Add an edge → immediately visible as a “Next Step” card and in the Global Map.
- New rule? Modify a permission path → the UI instantly reflects availability without code changes.

---

## 11) What you’ll see when implemented (still concept)
- A **left rail**: Global Map mini‑graph + search by node/entity.
- A **center**: Node primary surface with tabs for alternative surfaces.
- A **right rail**: Actions (guarded), Facets (FK/notifications), and Next Steps (edges).
- **Status bar**: Breadcrumb, Path, Actor identity.

> This is *not* a wizard. It is a **living graph canvas** where each node is a composite surface and all edges stay visible. Guards and notifications make the rules explicit to the user.



---

## 12) Expanded Problem Space (from meta2)
> New domains: **Campaigns**, **Occasions/Moments/Events/Work Windows**, **Proposals/Selections**, **Modules/Faces/Components**, **Inventory (module_items/product_items/inventory_allocations)**, **Teams/Tasks/Dependencies/Resources**, **Performance**, **Rights (contractor_rights/promotion_rights)**.

### 12.1 Layered Global Map
- **Planning layer**: Organisations ⇢ Campaigns ⇢ Packages ⇢ Package Proposals.
- **Occasion layer**: Venues ⇢ Occasions ⇢ Work Windows & Events & Moments.
- **Site structure**: Venues ⇢ Areas (tree) ⇢ Sites.
- **Asset layer**: Products (with Product Items) & Modules (with Faces, Module Items, Components & Task Templates).
- **Selection layer**: Allocations ⇄ Allocation Options ⇄ Sponsor Selections.
- **Execution layer**: Teams ⇢ Tasks (+ Dependencies, Resources) bound to Work Windows and Inventory Allocations.
- **Feedback layer**: Performance linked to Faces × Sites × Products.
- **Access/Rights layer**: Acts_for; Contractor Rights; Promotion Rights.

Each node still uses the **Node Template** (Actions, Facets, Next Steps), but surfaces now include **Gantt** (Tasks/Work Windows), **Matrix** (Inventory), and **Dependency Graph** (Tasks/Templates).

### 12.2 Actor Lenses (Home surfaces)
- **Owner**: Packages (Kanban by status), Venues (Map), Occasions (Calendar). Quick edges: Promotion Rights, Contractor Rights.
- **Promoter**: Occasions (Calendar/Gantt), Campaigns (Table), Packages (Kanban), Sponsor Briefs.
- **Sponsor**: Campaigns (Table), Packages (Kanban limited by view guard), Sponsor Selections (Review queue), Product Items.
- **Contractor**: Modules/Module Items (Inventory Matrix), Faces (Table), Allocation Options (Proposals), Tasks (Gantt), Teams (Roster).

Lenses are **filters + default node** presets—no new routes.

### 12.3 Composite Surfaces for new domains
- **Campaigns**: Table primary; Facet shows included Packages; Edge to Packages via campaign_packages.
- **Occasions**: Calendar primary (start/end); tabs for Work Windows (Calendar) & Events/Moments. Facet: Promotion Rights.
- **Work Windows**: Calendar/Gantt; grouping by Team or Site.
- **Package Proposals**: Two‑pane review (Proposed By ⇄ Proposed To); actions: Accept/Reject (guarded) with notification preview.
- **Allocation Options & Sponsor Selections**: Side‑by‑side **Option Picker** (module×face×product) with compare cards; sponsor confirms → Selection created; Facet shows who is notified.
- **Modules/Faces/Components**: Hierarchical browser; Faces table with linked Products (face_products) and Performance mini‑sparklines.
- **Inventory**: Matrix surface (rows = Module Items, cols = Product Items) with overlays for Inventory Allocations; Facet reveals linked Sponsor Selection.
- **Teams/Tasks**: Gantt with swimlanes by Team; Dependency overlay (mini graph); Resources facet (Inventory Allocations); Actions gated by team/org guards.
- **Performance**: Tri‑linked browser (Face × Site × Product) with heatmap summary and drill‑through to tasks and allocations.

### 12.4 Edge Taxonomy (visual)
- **1‑M** solid arrow; **M‑M via X** dashed arrow labelled with join entity (e.g., allocations, campaign_packages).
- Guards tint edges (green: traversable; grey: not permitted) with tooltip reason.

### 12.5 Guard & Notification Explanations
- Every disabled action/edge shows a short, humanized rule (e.g., “Requires sponsor membership on this package”).
- Pre‑commit panel lists recipients grouped by channel (ownership, promotion, contractor, sponsor).

### 12.6 Non‑Wizard Guidance at Scale
- **Recommended next** chip appears whenever any adjacent node’s primary action is guard‑passing.
- **Context carry‑through** (selected Campaign narrows Packages; selected Package narrows Sites/Options; selected Option narrows Inventory).

### 12.7 Minimal Semantics Additions (concept)
- Declare status domains (e.g., tasks.status, packages.status).
- Mark temporal pairs: allocations.from_datetime/to_datetime; work_windows window.
- Identify inventory link semantics (module_item ⇄ product_item via inventory_allocations) to enable the Matrix surface.

### 12.8 Example Journeys (non‑linear)
1) **Sponsor brief → Selection → Tasking**: Sponsor Briefs → (edge) Allocation Options (review) → Sponsor Selections (confirm) → Inventory Allocations (reserve) → Tasks (auto‑generate from templates) → Gantt.
2) **Contractor setup → Proposal**: Modules → Faces → Face Products → Allocation Options (compose option) → notify Sponsor.
3) **Promoter timeline**: Occasions calendar → Work Windows (fit) → Teams (assign) → Tasks (dependencies) → Execution Gantt.

> All journeys remain optional; edges stay visible and explain their guards.

