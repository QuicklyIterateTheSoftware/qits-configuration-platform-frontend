import { provideZonelessChangeDetection } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';
import { NotFound } from './not-found/not-found';

/**
 * Each door is addressable three times — its own path, the same path under a project, and the same
 * path under the repository whose configuration it shows — and all three must land on the SAME
 * component. A second component for a scoped form is the failure this guards against: it would
 * compile, render, and drift.
 *
 * <p>Two of the doors are addressable a fourth way, WITHOUT an env, and that pair has the same
 * claim on it: `/applications/x` and `/applications/x/envs/dev` are one component, because the
 * env-less spelling means "whichever tier this application has" and the page settles it. Two
 * components there would be two answers to that question.
 *
 * <p>Components are never created here. Without a `RouterOutlet` the router resolves the state and
 * stops, so this reads what each URL resolves to without booting the chrome or any of its reads.
 * Every page is lazy, so what is compared is the resolved class rather than an import: two
 * addresses resolving to the same object is the claim, and its identity is enough to make it.
 */
describe('app routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter(routes), provideLocationMocks()],
    });
  });

  async function resolve(url: string): Promise<unknown> {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    let node = router.routerState.snapshot.root;
    while (node.firstChild) node = node.firstChild;
    return node.component;
  }

  it('serves the listing unscoped and under a repository', async () => {
    const own = await resolve('/');
    expect(own).toBeTruthy();
    expect(await resolve('/qits/services/qits-docs')).toBe(own);
  });

  it('serves one application entries page in both spellings', async () => {
    const own = await resolve('/applications/qits-docs');
    expect(own).toBeTruthy();
    expect(await resolve('/qits/services/qits-docs/applications/qits-docs')).toBe(own);
  });

  it('serves the history page in both spellings', async () => {
    const own = await resolve('/applications/qits-docs/history');
    expect(own).toBeTruthy();
    expect(await resolve('/qits/daemons/qits-docs/applications/qits-docs/history')).toBe(own);
  });

  /**
   * The env-addressed spelling and the env-less one are ONE component. The env-less form is not a
   * redirect and must not become one: it means "whichever tier this application has", the page
   * settles it against the listing, and a second component would be a second answer.
   */
  it('serves the entries and history pages with and without an env, on one component each', async () => {
    expect(await resolve('/applications/qits-docs/envs/dev')).toBe(
      await resolve('/applications/qits-docs'),
    );
    expect(await resolve('/applications/qits-docs/envs/dev/history')).toBe(
      await resolve('/applications/qits-docs/history'),
    );
  });

  it('serves the resolved page, scoped and unscoped', async () => {
    const own = await resolve('/applications/qits-docs/envs/dev/resolved');
    expect(own).toBeTruthy();
    expect(own).not.toBe(NotFound);
    expect(await resolve('/qits/services/qits-docs/applications/qits-docs/envs/dev/resolved')).toBe(
      own,
    );
  });

  /**
   * The version is a SEGMENT here rather than a query parameter, because a declaration version is a
   * resource: it has a document, a hash and an intake. Both spellings are the same page, with and
   * without one.
   */
  it('serves the declarations page with and without a version segment', async () => {
    const own = await resolve('/applications/qits-docs/declarations');
    expect(own).toBeTruthy();
    expect(own).not.toBe(NotFound);
    expect(await resolve('/applications/qits-docs/declarations/2026.907.1')).toBe(own);
    expect(await resolve('/qits/applications/qits-docs/declarations')).toBe(own);
  });

  it('serves the cross-env matrix, scoped and unscoped', async () => {
    const own = await resolve('/applications/qits-docs/matrix');
    expect(own).toBeTruthy();
    expect(own).not.toBe(NotFound);
    expect(await resolve('/qits/services/qits-docs/applications/qits-docs/matrix')).toBe(own);
  });

  /** Every door is its own component; a route table that collapsed two would resolve them equal. */
  it('keeps the six doors distinct from one another', async () => {
    // Resolved one at a time: `resolve` navigates a shared Router and then reads its snapshot, so a
    // concurrent batch would be six navigations racing for one piece of state.
    const doors: unknown[] = [];
    for (const url of [
      '/',
      '/applications/qits-docs',
      '/applications/qits-docs/history',
      '/applications/qits-docs/envs/dev/resolved',
      '/applications/qits-docs/declarations',
      '/applications/qits-docs/matrix',
    ]) {
      doors.push(await resolve(url));
    }
    expect(new Set(doors).size).toBe(doors.length);
  });

  it('serves the original three doors under a project', async () => {
    // `/qits` is where the chrome's project picker sends this app when a reader picks `qits`.
    expect(await resolve('/qits')).toBe(await resolve('/'));
    expect(await resolve('/qits/applications/qits-docs')).toBe(
      await resolve('/applications/qits-docs'),
    );
    expect(await resolve('/qits/applications/qits-docs/history')).toBe(
      await resolve('/applications/qits-docs/history'),
    );
  });

  /**
   * The literal wins, which is why OWN routes come first. `applications` is a plausible project
   * slug, and the ordering is what keeps it this app's own page rather than a scope — against the
   * project form as much as against the repository one.
   */
  it('reads a literal first segment as this app own page, not as a project', async () => {
    const own = await resolve('/applications/qits-docs');
    expect(own).not.toBe(NotFound);
    expect(await resolve('/applications/qits-docs/history')).not.toBe(own);
  });

  /**
   * The middle segment is the repository's component now, and the archetype form it had before
   * keeps working — the platform serves links in both spellings, and both land on the same page.
   */
  it('serves the doors under a repository addressed by its component', async () => {
    expect(await resolve('/qits/qits-configuration/qits-configuration-service')).toBe(
      await resolve('/'),
    );
    expect(
      await resolve(
        '/qits/qits-configuration/qits-configuration-service/applications/qits-docs/history',
      ),
    ).toBe(await resolve('/applications/qits-docs/history'));
  });

  /**
   * A component is an open set, so this app's own pages are what the guard excludes — otherwise
   * `applications` would read as a component and the entries page under a project would be lost.
   */
  it('keeps its own pages under a project out of the group form', async () => {
    expect(await resolve('/qits/applications/qits-docs')).toBe(
      await resolve('/applications/qits-docs'),
    );
  });

  /** Nothing compiled in can prove a component, so a path this deep is read as a scope and settles
   * on the listing; a mistyped address of this app's own is still a 404. */
  it('reads an unknown middle segment as a group, and 404s what is not an address', async () => {
    expect(await resolve('/qits/nonsense/qits-docs')).toBe(await resolve('/'));
    expect(await resolve('/no/such/page/here')).toBe(NotFound);
  });
});
