import type { CanMatchFn, Routes, UrlSegment } from '@angular/router';
import { QitsMainLayout, QITS_CATEGORIES, type QitsCategory } from '@qits/ui-components';
import { NotFound } from './not-found/not-found';

/**
 * Six doors, all of them inside the platform chrome.
 *
 * **`QitsMainLayout` is the root route component** — the platform's convention, stated in the
 * component's own docs. Mounted this way the bar and the navigation mount once and survive every
 * navigation beneath them; wrapping each page in a tag would rebuild the whole skeleton on every
 * hop. It is an eager import for that reason: it is not a page, it is the frame the pages arrive
 * in, and a frame that loaded in its own chunk would show a blank application while it did.
 *
 * **Nothing here renders outside the chrome.** qits-platform-spa-idp is the one repository on this
 * platform with pages that do, and the reason is peculiar to it: a sign-in page cannot show a
 * sidebar full of doors its visitor has not been admitted to yet. Every page here is an
 * administrator's, reached with a session already in hand, so all of them sit under the layout —
 * and so does `**`, because this application owns the whole of its own host and an unknown URL is an
 * ordinary 404 with the chrome around it.
 *
 * **Every page loads lazily**, the idp scaffold's shape. The screens share only the small `ui/`
 * furniture, so each URL costs about itself: an operator who opens a deep link to one application's
 * history downloads neither the applications listing nor the entries table.
 *
 * **The path shape repeats the API's, noun for noun.** `/applications/qits-docs/envs/dev` is the
 * page for what `GET /configuration/api/applications/qits-docs/envs/dev/entries` answers, and
 * `…/resolved` for what the deployer would receive from the same address. A bare id under the base
 * href would have read better once and then swallowed every future top-level route; every sibling
 * repeats its noun for that reason.
 *
 * **THE ENV IS IN THE ADDRESS, and each env-addressed page is mounted TWICE.** The service holds
 * every tier in one store now, so which tier is on screen is the second-most important fact about
 * these pages and belongs where a reader can bookmark it, send it, and see it. The env-less
 * spelling stays beside it and is not a redirect: it means "whichever tier this application has",
 * which is the honest address for a link written before anybody knew the answer — the page settles
 * it against the applications listing and puts the env it settled on in the picker. One component
 * serves both, which is what keeps the two spellings from drifting.
 *
 * **`declarations` takes an optional version segment rather than a query parameter**, because a
 * version there is a resource: it has a document, a hash and an intake, and it is the thing being
 * looked at. The resolved page spells its version `?version=` instead, and that is deliberate too —
 * there it is a LENS over one env's configuration, and it is the wire's own parameter name on the
 * route the page is a view of.
 *
 * The listing is at `''` rather than at `applications` with a redirect: it is the front door, there
 * is nothing else it could be, and one address for one screen keeps the back button honest.
 */
const OWN: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./applications/applications-page').then((m) => m.ApplicationsPage),
  },
  {
    path: 'applications/:application',
    pathMatch: 'full',
    loadComponent: () => import('./entries/entries-page').then((m) => m.EntriesPage),
  },
  {
    path: 'applications/:application/envs/:env',
    pathMatch: 'full',
    loadComponent: () => import('./entries/entries-page').then((m) => m.EntriesPage),
  },
  {
    path: 'applications/:application/history',
    pathMatch: 'full',
    loadComponent: () => import('./history/history-page').then((m) => m.HistoryPage),
  },
  {
    path: 'applications/:application/envs/:env/history',
    pathMatch: 'full',
    loadComponent: () => import('./history/history-page').then((m) => m.HistoryPage),
  },
  {
    path: 'applications/:application/envs/:env/resolved',
    pathMatch: 'full',
    loadComponent: () => import('./resolved/resolved-page').then((m) => m.ResolvedPage),
  },
  {
    path: 'applications/:application/declarations',
    pathMatch: 'full',
    loadComponent: () => import('./declarations/declarations-page').then((m) => m.DeclarationsPage),
  },
  {
    path: 'applications/:application/declarations/:version',
    pathMatch: 'full',
    loadComponent: () => import('./declarations/declarations-page').then((m) => m.DeclarationsPage),
  },
  {
    path: 'applications/:application/matrix',
    pathMatch: 'full',
    loadComponent: () => import('./matrix/matrix-page').then((m) => m.MatrixPage),
  },
];

/**
 * This application's own second segments, derived from its own routes so a door added to `OWN` can
 * never be shadowed by the group form. One today: `applications` — every page of this app is a page
 * about an application, and `envs`, `declarations` and `matrix` are all deeper than the segment this
 * set is about.
 */
const OWN_SEGMENTS: ReadonlySet<string> = new Set(
  OWN.map((route) => (route.path ?? '').split('/')[0]).filter((segment) => segment.length > 0),
);

/**
 * Whether the address is really `/<slug>/<group>/<repo>/…` and not a page of this app's own.
 *
 * The middle segment is the repository's **component** — `qits-configuration` — where the platform
 * gives it one, and its archetype category where it does not. Component names are an OPEN set that
 * only the platform knows, so nothing compiled in can prove one and the closed-set test this guard
 * used to make would 404 every component address. The test runs the other way round now: a second
 * segment is a group unless it spells a page of this application's own — which is the same rule the
 * route ORDER already states, said once more where the group form could otherwise take
 * `/qits/applications/<app>`.
 *
 * The chrome reads the same address the same way — `parseScope` proves a component once the
 * repository list answers — so a middle segment naming no component of the project leaves the pages
 * below unscoped rather than turned away here.
 */
export const isRepositoryAddress: CanMatchFn = (_route, segments: UrlSegment[]) => {
  const project = segments[0]?.path;
  const group = segments[1]?.path;
  if (!project || !group) return false;
  // A project is never a category and never a page of this app's own, which is the rule the chrome
  // states from the other side: qits-projects refuses a slug that spells either.
  if (OWN_SEGMENTS.has(project) || QITS_CATEGORIES.includes(project as QitsCategory)) return false;
  return !OWN_SEGMENTS.has(group);
};

/**
 * Each of the doors is addressable THREE TIMES — at its own path, under a project, and under the
 * repository whose configuration it shows — and every spelling resolves to the same component.
 *
 * The project form is what the chrome's project picker navigates to: `UrlScope.select(slug)` goes
 * to `/<slug>/`, and without this route that pick would land on the 404 page.
 *
 * Order is the whole grammar. OWN routes come first, so `/applications` is this app's own page and
 * never a project called `applications`; the repository form follows, guarded off this app's own
 * segments; the project form takes what is left; and `**` closes the list.
 *
 * The pages read `inject(QITS_SCOPE).scope()` rather than these three params. A page that read them
 * would work in one spelling and be blank in the others.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      ...OWN,
      { path: ':project/:group/:repository', canMatch: [isRepositoryAddress], children: OWN },
      { path: ':project', children: OWN },
      { path: '**', component: NotFound },
    ],
  },
];
