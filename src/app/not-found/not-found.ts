import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConfigurationLinks } from '../ui/links';

/**
 * A URL under `/configuration/` that this app does not recognise.
 *
 * It renders a small page and stops there. It deliberately does **not** copy spa-home's behaviour of
 * handing the URL back to the gateway: that is the landing page's job, and it is correct only
 * because spa-home is mounted at the root, where an unknown first segment is another micro frontend.
 * Here the segment is already ours, so there is nobody to hand it to.
 *
 * `/configuration/api` and `/configuration/q` never reach this page — the service claims both ahead
 * of the SPA, through `quarkus.quinoa.ignored-path-prefixes`, so a mistyped machine path is a 404
 * from Quarkus rather than this component.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>
      This is the deployment configuration. It lists the applications it holds entries for, shows
      one application's entries in one environment and what has been written to them, what that
      application declares its own keys to be, what a deployment started now would receive, and how
      the tiers differ — and nothing else. It changes none of it.
    </p>
    <p><a [routerLink]="links.commands()">Back to the applications</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {
  protected readonly links = inject(ConfigurationLinks);
}
