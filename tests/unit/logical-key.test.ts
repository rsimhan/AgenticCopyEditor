import { describe, it, expect } from 'vitest';
import { deriveLogicalKey, guessLabelBefore } from '../../src/pipeline/logical-key.js';

describe('deriveLogicalKey', () => {
  it('slugifies and drops stopwords', () => {
    expect(deriveLogicalKey('Mortality')).toBe('mortality');
    expect(deriveLogicalKey('the mortality rate')).toBe('mortality');
    expect(deriveLogicalKey('primary outcome mortality')).toBe('primary_outcome_mortality');
  });

  it('keeps only the last three meaningful words', () => {
    expect(deriveLogicalKey('long descriptive primary outcome mortality')).toBe(
      'primary_outcome_mortality',
    );
  });

  it('returns undefined when nothing meaningful remains', () => {
    expect(deriveLogicalKey('the was of')).toBeUndefined();
    expect(deriveLogicalKey('')).toBeUndefined();
  });
});

describe('guessLabelBefore', () => {
  it('derives a key from the prose preceding a value', () => {
    expect(guessLabelBefore('Overall mortality was ')).toBe('overall_mortality');
  });
});
