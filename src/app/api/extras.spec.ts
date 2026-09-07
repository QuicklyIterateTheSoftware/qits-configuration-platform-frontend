import { EXTRAS_PREFIX, bareKey, propertyName } from './extras';

/**
 * The prefix, both ways round.
 *
 * The claim worth a test is the round trip: a key built into a property name and read back out is
 * the same string. Everything on the resolved page hangs off that, and the way it breaks is silent —
 * a prefix stripped one character short gives every row a leading dot, which reads as a rendering
 * quirk rather than as a screen that no longer names the deployer's keys.
 */
describe('extras property names', () => {
  it('builds the deployer’s own spelling', () => {
    expect(propertyName('qits-docs', 'env.QITS_REGISTRY')).toBe(
      'qits.platform.deployments.extras.qits-docs.env.QITS_REGISTRY',
    );
  });

  it('reads a key back out of the name it was built into', () => {
    const property = propertyName('qits-docs', 'mounts[0]');
    expect(bareKey('qits-docs', property)).toBe('mounts[0]');
  });

  it('keeps the dots inside a key, because only the application segment is stripped', () => {
    expect(bareKey('qits-docs', `${EXTRAS_PREFIX}qits-docs.env.QITS_A.B`)).toBe('env.QITS_A.B');
  });

  /**
   * A row this function cannot read is still a row the deployer will receive, so it comes back
   * whole. Dropping it would make the screen quietly narrower than the deployment it describes.
   */
  it('hands back a name belonging to another application untouched', () => {
    const other = `${EXTRAS_PREFIX}qits-ci.env.QITS_A`;
    expect(bareKey('qits-docs', other)).toBe(other);
  });

  it('hands back a name with no prefix at all untouched', () => {
    expect(bareKey('qits-docs', 'quarkus.http.port')).toBe('quarkus.http.port');
  });
});
