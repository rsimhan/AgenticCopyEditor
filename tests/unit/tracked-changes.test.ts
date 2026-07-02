import { describe, it, expect } from 'vitest';
import { parseTrackedChanges, classifyEdits, isInScope } from '../../src/uat/tracked-changes.js';

describe('tracked-changes extraction', () => {
  it('pairs an adjacent deletion + insertion into a replace', () => {
    const xml =
      '<w:del><w:r><w:delText xml:space="preserve">25 %</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>25%</w:t></w:r></w:ins>';
    expect(parseTrackedChanges(xml)).toEqual([{ kind: 'replace', deleted: '25 %', inserted: '25%' }]);
  });

  it('reads standalone insertions and deletions', () => {
    const xml =
      '<w:ins><w:r><w:t>new</w:t></w:r></w:ins>' +
      '<w:del><w:r><w:delText>old</w:delText></w:r></w:del>';
    expect(parseTrackedChanges(xml)).toEqual([
      { kind: 'insert', inserted: 'new' },
      { kind: 'delete', deleted: 'old' },
    ]);
  });

  it('decodes XML entities and concatenates multiple runs', () => {
    const xml = '<w:ins><w:r><w:t>P&lt;</w:t></w:r><w:r><w:t>.001</w:t></w:r></w:ins>';
    expect(parseTrackedChanges(xml)[0]).toEqual({ kind: 'insert', inserted: 'P<.001' });
  });

  it('classifies numeric/mechanical edits as in-scope and prose as out-of-scope', () => {
    expect(isInScope({ kind: 'replace', deleted: '25 %', inserted: '25%' })).toBe(true);
    expect(isInScope({ kind: 'delete', deleted: '™' })).toBe(true);
    expect(isInScope({ kind: 'replace', deleted: '1,076', inserted: '1076' })).toBe(true);
    expect(isInScope({ kind: 'replace', deleted: 'utilise', inserted: 'use' })).toBe(false);
  });

  it('partitions a mixed edit list', () => {
    const { inScope, outOfScope } = classifyEdits([
      { kind: 'replace', deleted: '18 %', inserted: '18%' },
      { kind: 'replace', deleted: 'colour', inserted: 'color' },
    ]);
    expect(inScope).toHaveLength(1);
    expect(outOfScope).toHaveLength(1);
  });
});
