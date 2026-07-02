import { describe, it, expect } from 'vitest';
import { parseTrackedChanges, classifyEdits, isInScope } from '../../src/uat/tracked-changes.js';

describe('tracked-changes extraction', () => {
  it('pairs an adjacent deletion + insertion into a replace', () => {
    const xml =
      '<w:del><w:r><w:delText xml:space="preserve">25 %</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>25%</w:t></w:r></w:ins>';
    expect(parseTrackedChanges(xml)).toEqual([
      { kind: 'replace', deleted: '25 %', inserted: '25%' },
    ]);
  });

  it('merges contiguous fragmented changes; an unchanged run splits edits', () => {
    // "14:00" → "2:00 PM" fragmented into adjacent runs (no unchanged text between) → one replace.
    const contiguous =
      '<w:del><w:r><w:delText>14</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>2</w:t></w:r></w:ins>' +
      '<w:del><w:r><w:delText>:00</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>:00 PM</w:t></w:r></w:ins>';
    expect(parseTrackedChanges(contiguous)).toEqual([
      { kind: 'replace', deleted: '14:00', inserted: '2:00 PM' },
    ]);

    // An unchanged run between two edits keeps them separate.
    const split =
      '<w:del><w:r><w:delText>a</w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>A</w:t></w:r></w:ins>' +
      '<w:r><w:t> and </w:t></w:r>' +
      '<w:del><w:r><w:delText>b</w:delText></w:r></w:del>';
    expect(parseTrackedChanges(split)).toEqual([
      { kind: 'replace', deleted: 'a', inserted: 'A' },
      { kind: 'delete', deleted: 'b' },
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
