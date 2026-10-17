# Genoa & Landfall: an overview

> **A record.** Kept as it was written, for the history and the citations. How an app is made
> now is the root [README](../../README.md#how-an-app-is-made); where this differs from the code, the code is
> right.

Two Python 2 / JavaScript projects from 2012–2013. They were published as git repositories under the **NavohPartners** GitHub organisation. Together they form a stack for building real-time, model-driven business web applications:

| | **Genoa** | **Landfall** |
|---|---|---|
| One-liner | "A websocket gateway": real-time RPC over Tornado | "Model driven development using Genoa" |
| Role | Server framework and plumbing | Application framework and generic UI on top of Genoa |
| Version | 0.011 | 0.020 |
| Own code | ~4.3k lines of Python (plus ~220 lines of client JS) | ~0.8k lines of Python, ~5k lines of JS and HTML templates (plus a lot of vendored JS libraries) |
| Commits | 41: Peter Bunyan 18, Robert Betts 15, Bill Gilbert 8 | 175: Bill Gilbert 102, Robert Betts 38, Peter Bunyan 35 |
| Git history | 18 Feb – 16 Apr 2013 | 18 Feb – 16 Apr 2013 |

The names follow a sailing theme: a *genoa* is a headsail, *landfall* is reaching shore, and the distribution modules are `topsail`, `moonsail` and `zsail`.

---

## Timeline

The git history starts with a "first pass" import on 18 Feb 2013, but the code is older than that. The `Created on` headers in the source show:

- **Jul–Sep 2011**: earliest pieces: `utils/plugin.py`, `access/person.py`, the Sphinx config (Aug 2011). So some ideas were in place soon after leaving Peloton.
- **May–Oct 2012**: audit trail (`audit_control.py`, May 2012), the `topsail` process pool (Oct 2012).
- **Nov 2012**: the main burst of work. On 22 and 25 Nov, about 24 modules were created (websocket, application, control, describe, moonsail, zsail, and more). Versioning with valid-from/valid-to followed on 28 Nov.
- **Dec 2012 – Feb 2013**: Landfall's `PanelControl` (3 Jan 2013), the modeller, and the panel UI.
- **Feb – Apr 2013**: moved to GitHub, and the team grew. Bill Gilbert did most of the later UI work (date/number widgets, pagination, bit-mask templates, password reset). Robert Betts did packaging, versioning, date parsing, the LDAP mixin and the docs.

Of the 54 `@author` headers in the Python code, 52 are `peterb`. The architecture is yours; the collaborators mostly extended and hardened it.

Some audit code has leftover fields named `_ticker_changes` and `_price_filter_change` (`genoa/access/audit_control.py`). This suggests the audit and broadcast design came from a trading or pricing system.

---

## Genoa: the real-time gateway

### Core idea

You write a plain Python `Control` class. Every public method becomes a remote procedure that the browser can call over a websocket. Changes are pushed back to all connected clients as broadcast "signals".

```
 Browser (Knockout.js)                     Tornado server
 ─────────────────────                     ──────────────
 GET /genoa.js  ─────────────────────────► JsHandler
   ◄── generated JS client: one stub per     describe_service(control) + describe_model()
       public Control method + the full
       model schema as JSON

 appl.save_thing(a, b, cb)
   {service, method, kwargs, request_id} ──► WebSocket.on_message
                                              └► Application.request
                                                   ├─ local:  control._perform_(method, kwargs, user)
                                                   └─ remote: services[name].work(...) → worker pool
   ◄── {method, result, error, request_id}
   ◄── {signal, message}   (broadcast to every client after commit)
```

### Key pieces

- **`core/application.py`**: a subclass of `tornado.web.Application`. It holds the connected clients, the pending requests, any named remote services, and a live `Status` object. It routes each request to the local `Control` or to a remote service, maps exceptions (access, integrity, validation) to error replies, and broadcasts signals. Broadcasts can go to everyone, to one user, or to users with a given permission.
- **`core/control.py`**: the base `Control`. It sets up the SQLAlchemy engine and sessions, creates or upgrades the schema, and dispatches methods (anything not starting with `_`). `_broadcast_on_success_` queues signals so they are only sent after the transaction succeeds.
- **`utils/describe.py`**: introspection, and the heart of the project.
  - `describe_service` reads a Control's public methods (arguments, defaults, docstrings, required permissions). `genoa.js` is a Tornado template that turns this into a JS API. The client stubs are generated, not written by hand.
  - `describe_model` reads every SQLAlchemy class: properties, types, primary and foreign keys, scalar and collection relationships, enums, read-only and hybrid properties, and whether the class is versioned. It sends this metadata to the browser.
- **`core/model.py`**: a declarative `Base` with conventions:
  - automatic snake_case table names
  - `to_json` / `from_pairs` serialisation that understands relationships
  - **surrogates** (`{label, value, _type}`) that stand in for foreign keys, using `name`, `label` or `title` as the display value
  - helpers for saving one-to-many and many-to-many collections, where a negative id means delete.
- **`access/`**: the security and history layer.
  - `AccessControl`: users, permissions and login, plus the `@requires_permissions(...)` decorator. The required permissions also appear in the service description, so the UI can hide actions a user can't take.
  - `AuditControl`: hooks into SQLAlchemy session events and writes an `Audit` row for every create, update, delete, and many-to-many add or remove. It includes before and after data and the user who made the change, then broadcasts after commit.
  - `Versioned` adds optimistic locking.
  - Also: an LDAP mixin, and login pages with forgot-password email.
- **`core/valid_from_valid_to.py`**: bitemporal-lite versioning. When a row is updated, it is closed off (`valid_to`) and a new row is inserted. Queries can ask for the data "as at" a date, including many-to-many relations over time.
- **`distribute/`**: three experiments in spreading work across processes:
  - **topsail**: a `multiprocessing.Pool` wrapper. It proxies an object's public methods to worker processes and merges the changed state back. `@sync` and `@local` decorators control how each method runs.
  - **moonsail**: a TCP manager and worker pool using Tornado IOStreams and a simple JSON protocol ending in `\r\n\r\n`. It includes a broadcaster and subscriber, and handles workers that die mid-call.
  - **zsail**: the same idea over ZeroMQ (REQ/REP plus PUB/SUB).
- **`utils/sa_create_upgrade.py`**: basic automatic schema migration for MySQL.

---

## Landfall: model-driven applications

### Core idea

Define a SQLAlchemy model and a declarative `ui.js`, and Landfall gives you a working CRUD application: list, search, edit, collections and uploads. It updates live, respects permissions, and adapts to phone, tablet and desktop. The README describes it as having "a functioning application" in minutes.

### Server side

`PanelControl` (in `panel_control.py`) extends `AuditControl` with a generic API that works for any model class, looked up by name:

- `genoa_list`: filtering on criteria (with `LIKE` prefix matching, date truncation and joins through relationship surrogates), ordering, paging, and sum/avg summaries.
- `genoa_item`: fetch one item with the requested collections and surrogates.
- `genoa_save`: create, update or delete (negative id), including nested one-to-many and many-to-many collections. It runs validation and broadcasts `saved_X`, `deleted_X`, `created_item` and similar signals.
- `genoa_lookup`: typeahead search on surrogates.

It also has upload handlers (including image thumbnails), a template loader that lets an app override Landfall templates, and `landfall_config`, a script that scaffolds a new project from `templates/default_project`.

### Client side

The client is built with Knockout.js, Bootstrap 2 and jQuery. `landfall_panel.js` reads `appl.ui.panels` and creates a panel for each model. The panel config supports:

- `columns`, `phonecolumns`, `fields`, `criteria`, `queries`
- `collections` and their per-collection column, field, edit-inline and limit settings
- `summary`, `table_limit`, `table_order_by`, `files`
- `visible_to` and `editable_by` (permissions)
- custom `js` panel classes.

Rendering uses per-type **micro-templates** (view, edit and inline cells, keyed by the model type from `describe_model`), so a new column type only needs new templates. The panel options are documented in detail in `docs/landfall/panels.rst`.

### The Modeller (`/modeller`)

This is a visual data modeller in the browser, at `templates/modelling/`. You define models, attributes and relations, and it generates:

- **SQLAlchemy `model.py`** (`to_python`)
- **SQL DDL** (`to_sql`)
- **`ui.js` panel configuration** (`to_ui_js`)
- a JSON save format and a live preview.

So the full path is: design the schema in the browser, generate the code, and run the app.

### Worked example: basketball fixtures

The docs (`custom_panel.rst`, `model_py.rst`, `control_py.rst`, `fixture_data.rst`) walk through a real case: a London and South East youth basketball league. It covers Seasons, Leagues, Clubs, Teams, Venues, Referees and Fixtures, with a round-robin fixture generator, a custom panel, a computed league table, and optional memcache caching through InnoDB's memcached plugin.

### Overriding the defaults: what the docs cover

Landfall's promise is that everything is derived from the model, and anything derived can be replaced. The docs cover this in two places:

- `panels.rst`: a reference for every `ui.js` panel setting.
- `custom_panel.rst`: the fixtures tutorial, with its finished code in `js_and_html.rst`, `control_py.rst` and `model_py.rst`.

Read against the code, there are eleven places to override a default. They run from light configuration to replacing whole pieces. The docs cover about half of them well.

| # | Override point | How it works | Docs |
|---|---|---|---|
| 1 | **Default panel** | `{label, model}` gives a `TableFormPanel` (a table plus a view/edit form), entirely derived from `describe_model()` | ✅ `panels.rst` |
| 2 | **Panel settings** | `columns`, `phonecolumns`, `fields`, `<field>_field`, `collections`, `<coll>_columns/_table_limit/_summary/_edit_inline`, `criteria`, `summary`, `table_limit`, `table_order_by/_asc`, `files`, `visible_to`, `editable_by` | ✅ `panels.rst`, but with errors (below) |
| 3 | **Per-column or per-field template** | `tmpl`, `tmpl_edit`, `tmpl_inline` name a Knockout template. `type` (`html`, `url`, `email`, `image`, and `Mask` for bit-masks, added Apr 2013) picks one of Landfall's built-in templates | ✅ documented under `columns`. `Mask` is only described in a commit message |
| 4 | **Per-panel templates** | `view` and `edit` set the form templates; `template` sets the panel's whole template | ✅ documented, but the examples are copy-paste errors (below) |
| 5 | **Custom panel class** | `js:'MyPanel'`: a class that subclasses `Panel`, registered in `Appl.prototype.settings.panels` and included through `{% block custom_panels %}`. It reuses Landfall's parts: `TableControl` or `QueryControl` set up by `appl.custom_config(ui, 'table'\|'form'\|'collection'\|'query', model)`; the Knockout templates `table-body-template`, `table-criteria-template`, `table-pagination-template` and `custom-scalar-template`; server calls through `appl.request_response`; and live updates by subscribing to `appl._broadcast_` (e.g. `saved_Fixture`) | ✅ this is the whole tutorial, and it's good |
| 6 | **Server-side queries** | `queries` or `models:[{model:'NEW', columns:[…]}]` describe the columns of a result that doesn't come from a table (the league table, `deal_irr`). The data comes from a method you add to your `PanelControl` subclass | ✅ in both files |
| 7 | **Formatting each value** | `ui.prototype.render(model, property, value, context)` in `ui.js`. Only the default/text table cells and the default/email form fields call it | ⚠️ appears in every example `ui.js`, never explained |
| 8 | **Replacing a type's template app-wide** | Landfall builds its template lookup from every `<script data-micro="<mode>-<type>">` on the page, in page order, and later ones win. The modes are `viewcell`, `editcell`, `inlinecell`, `viewfield` and `editfield`. So a `data-micro="viewcell-numeric"` script placed in `custom_panels` replaces **every** numeric cell. A new key (e.g. `viewcell-rating`) creates a new type, and a column with `type:'Rating'` will use it | ❌ undocumented. This is the most powerful hook in the system |
| 9 | **Swapping the controls in a default panel** | `table_control:'MyTable'` and `form_control:'MyForm'` name classes in `settings.controls`; `TableFormPanel` creates whatever they name. A second built-in panel, `MasterDetailPanel`, also exists | ❌ undocumented |
| 10 | **Page layout** | `index.html` extends `landfall_panels.html`. The docs show only `head_css` and `custom_panels`. The template also offers `head`, `menu`, `menu_logo`, `doc_menu`, `doc_menu_custom`, `header`, `status`, `content`, `scripts`, `templates` and `about_dialog` | ⚠️ 2 of 13 blocks documented |
| 11 | **Model and server hooks** | `_surrogate_property_()` (the label used in lookups; the tutorial uses it with hybrid properties); `_validate_()` returns a list of errors, which `genoa_save` raises as a `ValidationException` that shows up in the form; `Column(doc='Image'\|'Email'\|'HTML'\|'json')` changes the type `describe_model` reports, and so which template is used; override `_genoa_cache_update_` and `_init_db_` in `PanelControl` | ⚠️ only `_surrogate_property_` and control methods are shown, by example |

Other panel settings exist in the code but not the docs: `tabs`, `table_filter_field`, `hide_columns`, `hide_empty_view_fields`, `hide_read_only_edit_fields`, `<coll>_modal_columns` and `<coll>_collection` (overrides for a nested collection's own settings).

**Where the code and the docs disagree:**

- **Precedence runs the other way.** `StaticOverideHandler` (in Genoa) looks in **Landfall's** `www` first and only falls back to the app's. An app can add static files, but it can't replace one of Landfall's with a file of the same name, despite the class name.
- **`type` only affects table columns.** For table columns, a `type` set in `ui.js` changes which template is used. For form `fields`, the template is chosen from the model's own type before the `ui.js` settings are applied, so `type:'html'` on a field does nothing unless you also give `tmpl`/`tmpl_edit`. The docs say fields work "the same as columns".
- **`visible_to` has a different default.** The docs say `['admin','users']`; `ui_generic.js` sets `['admin']`.
- **An example uses the wrong key.** `panels.rst` shows `edit_inline_contacts:true`, but the code reads `contacts_edit_inline`, as the heading above that example correctly says.
- **Two examples show the wrong key.** The `template` example shows `js:'my-custom-tmpl'`, and the `edit` example shows `view:'deal-tmpl'`.
- **Leftovers and bugs:**
  - `panels.rst` still has a merge-conflict leftover (`=======`) with the `files` section duplicated after it.
  - The `<collection>_fields` heading reads `<field_name>_field`.
  - `template` is missing from the contents list at the top.
  - `table_order_asc:'false'` is a string, so it is truthy and doesn't reverse the order.
- **The tutorial's intermediate code has bugs.** The finished code in `js_and_html.rst` fixes them:
  - `this.selected.subscribe` should be `this.table.selected`.
  - The first `create_league` uses `that` before defining it.
  - `clear_league()` is called twice.

**Bottom line:** yes, the docs describe overriding the defaults with custom components, and the custom-panel tutorial is a proper worked example. But the most general hooks are missing: app-wide type templates (#8), swapping controls (#9), the page blocks (#10) and validation (#11). What's documented is configuration and custom panels; what's missing is the ways to *extend* Landfall itself.

---

## Tech stack (2013)

- **Server**: Python 2, Tornado ≥2.4, sockjs-tornado, SQLAlchemy 0.7.9, PyDispatcher, and optionally pyzmq, memcache and LDAP.
- **Databases**: SQLite for development, MySQL/InnoDB in production.
- **Client**: Knockout.js (plus the validation plugin), jQuery 1.8, jQuery UI 1.9, Bootstrap 2, FontAwesome, CodeMirror 2.35, d3 v3, Flot 0.7, SockJS 0.3.4.
- **Docs**: Sphinx, with builds committed to the repos.
- **Tooling**: Eclipse/PyDev project files; setuptools/easy_install from a private package index.

---

## What was ahead of its time

- **Websocket-first RPC with server push, in 2012.** Pushing change signals to every client is the pattern Meteor (2012), Firebase, and later GraphQL subscriptions and LiveView made mainstream.
- **Self-describing services that generate their client.** `describe_service` → `genoa.js` is essentially a hand-rolled OpenAPI/tRPC-style typed client, delivered on each page load.
- **Schema metadata driving the UI.** `describe_model` plus type micro-templates is the idea behind Django Admin, React-Admin, Retool and Hasura-style consoles, here in real time.
- **Audit, optimistic locking and "as at" versioning built in.** These are finance-grade data integrity features most CRUD frameworks still leave to the developer.
- **Low-code modeller that generates real code.** It produces readable `model.py` and `ui.js` files rather than an opaque runtime model, so you can move past the generator.

## What has dated or is fragile

- **Python 2 only.** It uses `except X, ex`, `print` statements, `iteritems`, `cmp` sorting, and APIs from SQLAlchemy 0.7 and Tornado 2.x that no longer exist.
- **Parts of the introspection rely on string parsing.** For example `str(attr.property.local_side[0]).split(".")` (commented "sorry!"), and two blocks commented "This is nasty".
- **Security:**
  - Passwords are hashed with salted SHA-1.
  - Seed users are `admin`/`admin`, `user`/`user` and a guest.
  - The cookie secret is hard-coded in the scaffold.
  - `genoa_list` accepts any model name and criteria from the client, protected only by the permission layer.
  - Committed credentials are covered in the next section.
- **Several overlapping distribution layers** (topsail, moonsail, zsail) that look like experiments, never settled on one.
- **Minimal docs for Genoa itself** (`overview.rst` is a single line); most of the documentation effort went into Landfall's panels.
- **Vendored libraries and built docs are committed** to the repos, which accounts for most of Landfall's ~194k lines.

## Housekeeping to check

- `Genoa/src/genoa/access/access_handler.py` contains **hard-coded SMTP credentials for a personal Gmail account**.
- `Landfall/scripts/install.sh` contains **credentials for the `navohpartners.com` package index**.

Both are also in the git history. If the NavohPartners GitHub repos are still public, or those passwords are still in use anywhere, rotate the passwords and consider making the repos private.

The folders also contain compiled `.pyc` files and `.DS_Store` files.

---

## Things to discuss

1. **Context.** What was Navoh Partners, who were the intended customers, and did Landfall ship any production apps (the basketball league, or others)?
2. **Lineage.** How much of Genoa's design (audit trail, broadcast-on-commit, "as at" versioning) came from the Peloton work, and which parts were new?
3. **The distribution layers.** Which of topsail, moonsail or zsail actually ran in production, and why were there three?
4. **What happened next?** Did these ideas continue into later projects?
5. **Revival value.** If you rebuilt this today (for example with Python 3, FastAPI or Starlette websockets, SQLAlchemy 2, and a modern reactive front end), which ideas would be worth keeping? The candidates are the self-describing service and model, surrogates, audit with broadcast-on-commit, and the code-generating modeller.

---

## Thirteen years on: Genoa & Landfall compared with eta

`Workshop/eta` (github.com/blueshed/eta) is a TypeScript/Bun kernel from 14–24 Sep 2026: 113 commits, and version 0.46.0 plus two unreleased commits. It is the end of the line traced in `Workshop/docs/documents-history.md`: dzql → seiro → simple/easy → railroad → delta → hjeli → epsilon → apples & pears → zeta → eta.

That history starts in Sep 2025. Genoa and Landfall are its prehistory: the same problem, tackled in 2011–13 with the tools of the time.

### The problem hasn't changed

Keep what each person sees true to what the database holds, live, for several people at once. Genoa's `Application.broadcast` has a comment that says it plainly:

```python
#ToDo don't broadcast to all clients - use subscriptions
```

That TODO is the "view maintenance problem" that dzql named in 2025 and left unfinished (`_affected_documents`). eta finally answers it in `src/reading.ts`: **a connection sees what its page read.** While the server renders a page, each document's `read()` records itself. After a write, only the connections whose last render read that document are told about it.

### Ideas that carried through

| Idea | Genoa / Landfall (2013) | eta (2026) |
|---|---|---|
| One persistent socket, server has the final say | Tornado websocket or SockJS; `Application.request` | `Bun.serve` websocket; one generic dispatcher in `server.ts` |
| Tell people only after the commit | `_broadcast_on_success_` queues signals until the transaction closes | `patch()` runs as one transaction; then `notify()` echoes the ops and re-renders whoever read the document |
| Every write is remembered | `Audit` rows: before-data, changed fields, user, time; plus `ValidFromValidTo` "as at" versioning | The `ledger` stores each write's ops and their inverse, per session and version |
| Permissions on the server, reflected in the UI | `@requires_permissions`, published in the service description | `permit(ws, op, docId)` per path, with `cannot` stories as the refusals |
| One live status for everyone | `Status` object broadcast as `_services_status_` | `inspect` over the wire, `window.eta.inspect()`, and the CLI `watch` command |
| Ship a whole working app | `landfall_config` scaffold; the basketball fixtures demo | `examples/<name>/` (chat, wedding, ticker), each a complete app |

### Deliberate reversals

Much of eta reads like a line-by-line answer to what Genoa and Landfall did:

- **Calls by function name → a document and a path.** Genoa's whole wire is a method name plus arguments, and it generates JS stubs for every public method. eta's CLAUDE.md says: *"A write names a document and a JSON Pointer path, never a function name."* zeta put it more sharply: *"Nothing that reaches the browser names a function, so there is no call the declaration did not already allow."*
- **Audit trail → undo.** Genoa's `Audit` rows already held the before-values but were only used for history. eta records the inverse at the moment of writing, so undo and redo come for free. A single SQL query over the ledger works out what to undo or redo next.
- **Browser renders the model → server renders HTML.** Landfall sent `describe_model()` to the browser, where Knockout, per-type templates and ~5k lines of panel JS (plus jQuery, Bootstrap, d3 and more) drew everything. eta: *"The server is the only renderer"*. The client is 2.6 KB and only patches the HTML already on the page (a "morph"). It has no framework and no copy of the domain data.
- **Model first → stories first.** Landfall's modeller starts from entities and produces one CRUD panel per table. hjeli calls this "entity altitude" and warns that it is the default an LLM drifts towards. eta starts from stories (*"who does what, and who then sees it"*) and builds only what a story needs. The two approaches are also opposite on code generation. Landfall's modeller generated `model.py`, SQL and `ui.js`. eta's `stories.md` says *"Not a modelling tool… Not generated code"*, and Claude writes the code by hand from the stories.
- **Three distribution layers → zero infrastructure.** Genoa had topsail, moonsail and zsail. eta is one process and one SQLite file, with no queue, cache or build step.
- **A team → you and Claude.** Genoa and Landfall had three contributors and a handful of unit tests. eta has one author, with Claude as what `stories.md` calls "the compiler". It has 341 tests, 100% coverage enforced as a gate, and a story harness that runs each story over real sockets, including its undo and redo.

### Custom components: Landfall's templates and panels, eta's applets

The idea has survived: the framework draws the default, and you register a named component to replace it where the default isn't enough. eta's `picture-field` applet (`examples/wedding/applets/picture-field.ts`) is almost the same component as Landfall's `editfield-image` template: choose a file, shrink it, upload it, and store the key.

The mechanism is the same too. Landfall builds a lookup from `data-micro` tags, and eta's `registerApplet(name, applet)` fills a plain name → object map (`src/applets.ts`). In both, the last one registered wins. What has changed is everything around that registry:

| | Landfall (2013) | eta (2026) |
|---|---|---|
| **Where a component is used** | Picked automatically by the model's type (`get_template` → `<mode>-<type>`). Override it once and every numeric cell changes | Chosen explicitly: the example's view writes `<div data-applet="name" data-props=…>`. The kernel ships no applets and never names one |
| **Contract** | A Knockout template bound to observables (two-way binding, state kept in the browser); a custom panel is a `Panel` subclass | `mount(el, {props, send})`, `update(el, props)`, `patch(el, ops)`. Props in, writes out |
| **How it writes** | A custom panel calls any server method by name (`request_response("", "add_league_fixtures", …)`), which bypasses `genoa_save`, so there is no audit trail and no undo | `send(doc, ops)`: the same `{doc, ops}` patch as any other write, so it is permitted, recorded in the ledger, and undoable |
| **How it stays live** | Subscribes to `_broadcast_`, spots `saved_Fixture`, and **reloads** the whole result over another round trip | `data-doc` names a document, and the applet receives that document's ops directly in `patch()`. A price tick is 111 B and no HTML follows |
| **Re-render safety** | Knockout re-renders the templates | The morph never goes inside `[data-applet]`, so the applet's own state survives |
| **Stance** | Custom components are *the* way to extend, so the more the better | *"Only for a piece of the page whose client-side state a re-render would destroy… plain `data-write` HTML is the default"* (the eta-app skill) |
| **Docs** | The custom-panel tutorial; the type-template registry is undocumented | The contract is in `reference.md` § Applets and the skill, with a rule to keep drawing (pure, tested) separate from mounting (DOM) |

**The one thing eta doesn't have:** a type-driven default to override. Landfall could say "every `Image` column uses this component" once, because its UI was generated from the model. eta has no generated UI (by design: stories, not entity CRUD), so the nearest equivalent is a view helper each page calls, as `views/board.ts` does to place `picture-field`. If eta ever derives panels from documents (question 3 below), Landfall's `<mode>-<type>` lookup is the precedent for how applets would plug into them.

### What Genoa had that eta doesn't (yet)

- **Time travel.** `ValidFromValidTo` answered "what did this look like on 3 March?", including many-to-many relations. eta's ledger holds the history, but nothing reads a document "as at" a date. delta had doc names like `venue-at:42:2026-06-16`.
- **Spreading work across processes.** Genoa's topsail and moonsail spread work over multiple processes. eta is one process by design.
- **Generic browsing of any table.** Landfall's `genoa_list` gave you filtering, paging and totals over any table, with no code per table. eta deliberately doesn't (bento, stories).

### State checked today (24 Sep 2026)

- `bun test`: 341 pass, 0 fail, 100% coverage.
- `bun run stories`: chat 10/10, wedding 46/46, ticker 16/16.
- The working tree is clean. The last commit is `e5d4271` "A page is sent in parts" (24 Sep, 11:38).
- **The README contradicts itself on cost.** "Why eta" says *"a chat message is 425 bytes… a price tick 104"*, but its own Cost section now shows 804 B per chat message (with the new "parts" rendering) and 111 B per tick.

### Questions this raises

1. Should Genoa and Landfall go into `documents-history.md` as the 2011–13 prehistory? Several open questions there were live in 2013: the broadcast TODO, audit as history, and permissions in the service description.
2. Does eta want Genoa's "as at" reads? The ledger already has what it needs.
3. The 17 Sep review graded eta YAGNI **D**. Landfall was the opposite bet: everything generic, from day one. Is there a middle ground, such as a derived CRUD panel that stories are allowed to use?
4. Does `chat-delta` (eta's page with delta documents underneath) mean eta becomes the layer that ties the lineage together?
