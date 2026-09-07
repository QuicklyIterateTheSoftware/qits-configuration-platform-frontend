import type { ConfigurationEntry, DeclaredKey } from '../api/dto';
import {
  declaredDetail,
  isSystemOnly,
  sourceLabel,
  sourceOf,
  sourceTone,
  type ValueSource,
} from './source';

/**
 * The derivation the resolved wire cannot do for us, tested against the SERVICE's own precedence.
 *
 * These five cases are the whole contract, and the first one is why this file exists: a
 * `serviceAddress` with a stored row beside it must resolve as the rendered address, because that is
 * what the service does with it. A client that read the row instead would draw an operator's badge
 * on a value no container will ever see, and the row it drew it from is the one the entries read
 * already reports orphaned.
 */
describe('value sources', () => {
  const entry = (over: Partial<ConfigurationEntry> = {}): ConfigurationEntry => ({
    env: 'dev',
    application: 'qits-docs',
    key: 'env.QITS_REGISTRY',
    value: 'registry:8080',
    entryClass: 'plain',
    orphaned: false,
    revision: 41,
    updatedAt: '2026-08-17T09:12:00Z',
    updatedBy: 'wohlben',
    ...over,
  });

  const declaredKey = (over: Partial<DeclaredKey> = {}): DeclaredKey => ({
    key: 'env.QITS_REGISTRY',
    type: 'string',
    defaultValue: null,
    service: null,
    port: null,
    packageType: null,
    packageName: null,
    ...over,
  });

  it('renders a serviceAddress even when a row is stored on it', () => {
    const declared = declaredKey({ type: 'serviceAddress', service: 'qits-events', port: 8080 });
    expect(sourceOf(entry({ orphaned: true }), declared)).toBe('rendered');
    expect(sourceOf(undefined, declared)).toBe('rendered');
  });

  it('reads a stored row as an operator’s or as the bootstrap’s, by its own word', () => {
    expect(sourceOf(entry({ entryClass: 'plain' }), undefined)).toBe('operator');
    expect(sourceOf(entry({ entryClass: 'imported' }), undefined)).toBe('imported');
  });

  it('lets a stored row beat a declared default, which is the service’s own precedence', () => {
    const declared = declaredKey({ defaultValue: 'registry.localhost:5000' });
    expect(sourceOf(entry(), declared)).toBe('operator');
  });

  it('falls to the declared default when nobody has stored anything', () => {
    expect(sourceOf(undefined, declaredKey({ defaultValue: 'registry.localhost:5000' }))).toBe(
      'default',
    );
  });

  /** The empty string is a default somebody chose, not the absence of one. */
  it('treats an empty-string default as a default', () => {
    expect(sourceOf(undefined, declaredKey({ defaultValue: '' }))).toBe('default');
  });

  /**
   * Not a fifth kind of source: it says the resolved map holds a key that neither read accounts for,
   * which cannot happen within one instant of the store — so the two reads did not come from one.
   */
  it('says so when neither an entry nor a default accounts for a key', () => {
    expect(sourceOf(undefined, undefined)).toBe('unexplained');
    expect(sourceOf(undefined, declaredKey({ type: 'packageVersion' }))).toBe('unexplained');
  });

  it('gives every source a word and a tone, with the alarm reserved for the unexplained', () => {
    const sources: readonly ValueSource[] = [
      'operator',
      'imported',
      'rendered',
      'default',
      'unexplained',
    ];
    for (const source of sources) {
      expect(sourceLabel(source).length).toBeGreaterThan(0);
    }
    expect(sourceTone('unexplained')).toBe('danger');
    expect(sourceTone('default')).toBe('neutral');
    expect(sourceTone('operator')).toBe('success');
  });

  it('names the service and port a rendered address is built from', () => {
    expect(
      declaredDetail(declaredKey({ type: 'serviceAddress', service: 'qits-events', port: 8080 })),
    ).toBe('qits-events:8080');
  });

  it('names the package a version comes from', () => {
    expect(
      declaredDetail(
        declaredKey({ type: 'packageVersion', packageType: 'npm', packageName: '@qits/ui' }),
      ),
    ).toBe('npm @qits/ui');
  });

  it('says nothing extra about the three ordinary types', () => {
    expect(declaredDetail(declaredKey({ type: 'string' }))).toBe('');
    expect(declaredDetail(declaredKey({ type: 'boolean' }))).toBe('');
    expect(declaredDetail(declaredKey({ type: 'number' }))).toBe('');
  });

  /** One type the platform fills in and a person may not set — and it is the only one. */
  it('marks only serviceAddress as system-only', () => {
    expect(isSystemOnly('serviceAddress')).toBe(true);
    expect(isSystemOnly('packageVersion')).toBe(false);
    expect(isSystemOnly('string')).toBe(false);
    expect(isSystemOnly(undefined)).toBe(false);
  });
});
