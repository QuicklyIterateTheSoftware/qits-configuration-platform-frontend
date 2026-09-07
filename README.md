# qits-configuration-platform-frontend

The deployment configuration's frontend: what each application on this platform will be deployed
with, and the screen an operator reads it on. Served by qits-configuration itself at the **root of
its own host** (`configuration.<env>.<domain>`) through Quinoa. Six screens, all of them inside the
platform chrome.

- **`/`** — every application this service holds entries for, with the environments it is configured
  in and what each of them holds.
- **`/applications/<app>/envs/<env>`** — one application's entries in one environment, as they are
  stored now. Also at `/applications/<app>`, which means "whichever tier this application has" and
  settles on one rather than redirecting.
- **`/applications/<app>/envs/<env>/history`** — every write to that application in that
  environment, newest first, deletions included. Also env-less, on the same rule.
- **`/applications/<app>/envs/<env>/resolved`** — the merged map a deployment started now would
  receive, with where each value came from. `?version=` picks which declaration it is resolved
  against.
- **`/applications/<app>/declarations`** and `…/declarations/<version>` — what the application says
  its own configuration keys are, one document per version, with the governing one marked and the
  raw document beside the parsed keys.
- **`/applications/<app>/matrix`** — one application's keys across every environment at once, with
  the tiers that differ marked.

**THE ENV IS IN THE ADDRESS.** The service holds every tier in one store now, so which tier is on
screen is the second-most important fact about these pages, and it belongs where a reader can
bookmark it, send it and see it. The service's env-less routes still answer — against the env its
inherited rows were backfilled with — and this app calls none of them: a reader who cannot see which
tier a row belongs to is a reader who will read prod's answer as dev's.

**Each is addressable under a scope too.** The platform's URL grammar puts the same page under
`/<projectSlug>/<category>/<repoName>/…`, and the scoped form resolves to the same component:
`app.routes.ts` mounts one list of children under both, guarded on the category. With a repository
in scope the listing is a doorway rather than a destination — it replaces the address with
`applications/<repoName>` once the listing proves that application exists, and says plainly that the
repository has none when it does not.

**A ROW ON THE ENTRIES PAGE IS AN OVERRIDE, NOT THE CONFIGURATION.** An application declares its own
keys in `.config/qits/configuration.yml`, and what it declares — a type, and for the ordinary types a
default — is what it ships with. This store holds the _deviations_ from that: keys somebody set, and
keys the declaration has no default for. So deleting a row does not delete the key, it returns it to
its default; a key with a default and no row is invisible on the entries page and present in every
deployment; and the entries table is deliberately not the whole picture. The resolved page is.

**An orphaned row is not an error.** The entries read computes `orphaned` against the governing
declaration and it means one of two things — the declaration names no such key, or it names it a
`serviceAddress` whose stored value the platform ignores in favour of the address it renders. Both
say the same thing to a person: _this row is not reaching the container_. Nothing tidies them away,
because one of them is a key somebody staged for a version that has not shipped yet.

**THIS APPLICATION READS AND NEVER WRITES.** The entries are system state: the platform's own
processes set them through the API — a deployment, a bootstrap import, a service that learns its own
address — and each of those writes is part of a larger operation with more to do afterwards. A hand
edit in a browser lands in the middle of that with none of the rest of it, so no screen here offers
one, and the API class holds no PUT and no DELETE to reach for. The entries page says so in a
sentence, because a table with no buttons otherwise reads as a table whose buttons failed to load.

**What this replaces is a file nobody could see.** Deployment environment used to be a hand-edited
properties file on the deployer's config volume, snapshotted at boot: an edit was inert until the
deployer was forced to reload, and a live `service update --env-add` fix was reverted by the next
deploy. qits-configuration owns those entries now, versions every write, and serves them at the
spelling the deployer already reads. These pages are the first time that state has had a face.

**Every value is drawn whole.** A cell here holds a mount specification, an alias list, a URL with a
query string — occasionally something very long — and an operator reads it to answer "what will this
deployment run with". So nothing truncates: the value column wraps. A screen that clipped at some
width would say something false about a deployment while looking entirely normal.

**A write reaches a container on its next deployment, and the pages say so.** The deployer pulls an
application's entries once per deployment and records the revision it deployed with; nothing here
pushes. Someone who assumed otherwise would go looking for a bug in the deployer.

**A failed read is drawn where the table would be.** The heading, the breadcrumb and the note stay,
and the error carries the service's own message with its status in front of it, plus a retry.

**This application handles no token.** Every call is a same-origin path under `/configuration/api`,
and the edge's session is what authenticates it — the SPA neither holds a credential nor knows one
exists. That is also why no request here sets a `credentials` option: same-origin sends the cookie
by default, and the only value worth setting would be the default.

**THE DEPLOYER'S RESOLVED READ IS A SCREEN NOW, and that overturns what this file used to say.** It
recorded that `…/resolved` did not belong in a browser because it is the flat, fully prefixed
property map the deployer layers verbatim. With declarations in the store that map became the only
place a person can see a declared default, a rendered address and an operator's own override
standing beside each other — which is the question every argument about a misbehaving deployment
turns on. So it is read here, and because the wire carries no per-key metadata, **where each value
came from is derived on the client**, in `ui/source.ts`, against the entries and the declaration.
That derivation restates the service's own precedence and nothing else: a `serviceAddress` is
rendered and not overridable, then a stored entry, then a declared default.

**What the resolved page must never claim is which version an env's deployments actually ran with.**
That is recorded at cutover and this service does not hold it, so the version picker labels the
governing declaration **newest** and never _deployed_. The page answers "what would a deployment
started now receive"; the matrix page carries the same caveat for the same reason.

**`POST …/import` is still deliberately absent, and so is every write.** The import is the
bootstrap's bulk seeding; the declaration POST and DELETE are the pipeline's, machine-guarded,
because the only thing that can honestly assert what a version declared is the build that produced
it. None of them is in this app's API class to be reached for.

## How it is served

qits-configuration-platform-service carries this repository as a git submodule at
`service/src/main/webui` — Quinoa's ui-dir — and builds it during `mvn package`, serving the bundle
at the root of its host. The root is spelled here as `baseHref` in `angular.json` and there as
`quarkus.quinoa.ui-root-path`, both `/`; the two move together, and a disagreement serves a page
whose every asset 404s. This repository ships no container image of its own.

`/configuration` is the MACHINE segment now — the API and the framework root — and both spellings of
it answer 404 rather than this page. That is what `quarkus.quinoa.ignored-path-prefixes` is for, and
it retires the old trailing-slash wart along with it.

## Development server

```bash
ng serve
```

Then open `http://localhost:4200/`. `proxy.conf.json` forwards `/configuration/api`,
`/configuration/q`, `/projects/api` and `/main-navigation` to the edge on `localhost:8080`, because
`ng serve` puts nothing in front. In a deployment every call is a same-origin path on this service's
own host, which the edge path-routes to whichever service owns the prefix.

## Running the checks

```bash
npm run lint && npm test && npm run build
```

The same three, in the same order, are what `.config/qits/ci-event-release-request.yml` runs — once
per release request, on the folded `release/<id>` branch, with its verdict gating the release.
Nothing builds on a push any more.
Note what that pipeline installs from: the npm proxy behind it is qits-platform-mirror, and the
`@qits` scope comes from qits-artifacts — so a run here cannot be green while either service is
down. Their deploys are taken alone, with the CI queue empty.

Installing on a developer machine needs a credential, and it is not in this repository. Every read
through the edge authenticates, so both registries answer 401 without one; `.npmrc` here carries the
routing only, and the `_auth` line comes from your own `~/.npmrc`, minted for your commissioned
workstation client. CI takes both the addresses and the credential from the step environment.

## Building

```bash
ng build
```

The bundle lands in `dist/qits-spa-configuration/browser`, which is the path
`quarkus.quinoa.build-dir` names on the service side. One lazy chunk per page comes out beside the
initial one — that is the routing, visible in the output. A page mounted at two addresses is one
chunk, not two: the route table names the same `loadComponent` twice, which is what keeps the
env-less and env-addressed spellings from drifting into two screens.

## Running unit tests

```bash
ng test
```

Vitest on jsdom — no browser, which is what lets CI run them.
