/**
 * The one property spelling this service shares with qits-platform-deployments:
 *
 * ```
 * qits.platform.deployments.extras.<application>.<key>
 * ```
 *
 * **It is written down here because the resolved read is served in it.** That route answers complete
 * property NAMES rather than bare keys, so a consumer can layer the map as a configuration source
 * verbatim — no prefix to re-assemble and no second place for the deployer's namespace to live. A
 * screen has the opposite need: it draws the key an operator typed, beside the same key from another
 * env, and a column of forty identical prefixes is a column that hides the thing being compared. So
 * the prefix is stripped for display, in one place, against the application it was built for.
 *
 * **Splitting is unambiguous because an application name holds no dot.** After the prefix the first
 * dot ends the application segment and everything after it is the key, which is what lets
 * `env.QITS_X` and `mounts[0]` share one grammar without a second delimiter. This module does not
 * rely on that rule in general — it is only ever asked about the one application whose page is on
 * screen, so it matches that name exactly and hands back anything else untouched.
 */

/** The deployer's own namespace, with the trailing dot. */
export const EXTRAS_PREFIX = 'qits.platform.deployments.extras.';

/** The full property name for one entry, as a consumer layers it. */
export function propertyName(application: string, key: string): string {
  return `${EXTRAS_PREFIX}${application}.${key}`;
}

/**
 * The bare key inside one property name, or the name untouched when it is not this application's.
 *
 * Returning the name rather than null is deliberate: a resolved map is drawn row by row, and a row
 * this function could not read is still a row the deployer will receive. Dropping it would be a
 * screen quietly narrower than the deployment it claims to describe.
 */
export function bareKey(application: string, property: string): string {
  const prefix = `${EXTRAS_PREFIX}${application}.`;
  return property.startsWith(prefix) ? property.slice(prefix.length) : property;
}
