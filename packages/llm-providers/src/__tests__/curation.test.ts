/**
 * Curation primitives (TICKET_1265_3_1 F5 + F1 helper).
 */
import { describe, it, expect } from 'vitest';
import { denoiseSortModels, markRecommended } from '../curation';

describe('denoiseSortModels (F5)', () => {
  it('sinks dated-snapshot ids below plain ids, nothing removed', () => {
    const input = [
      { id: 'gpt-4o-2024-08-06', name: 'a' },
      { id: 'gpt-5.2', name: 'b' },
      { id: 'gpt-4-0613', name: 'c' },
      { id: 'gpt-5-mini', name: 'd' },
    ];
    const out = denoiseSortModels(input);
    expect(out).toHaveLength(input.length); // no removal (P3)
    // Plain ids first (descending), then the two dated snapshots.
    expect(out.map(m => m.id)).toEqual([
      'gpt-5.2',
      'gpt-5-mini',
      'gpt-4o-2024-08-06',
      'gpt-4-0613',
    ]);
  });

  it('sinks modality-variant ids (realtime/audio/transcribe/tts/search)', () => {
    const input = [
      { id: 'gpt-4o-realtime-preview', name: 'a' },
      { id: 'gpt-5.2', name: 'b' },
      { id: 'gpt-4o-audio', name: 'c' },
      { id: 'whisper-search', name: 'd' },
    ];
    const out = denoiseSortModels(input).map(m => m.id);
    expect(out[0]).toBe('gpt-5.2'); // only plain id floats
    expect(out.slice(1)).toContain('gpt-4o-realtime-preview');
    expect(out.slice(1)).toContain('gpt-4o-audio');
    expect(out.slice(1)).toContain('whisper-search');
  });

  it('plain ids sort by id descending (newer versions first)', () => {
    const out = denoiseSortModels([
      { id: 'gpt-4', name: 'a' },
      { id: 'gpt-5.2', name: 'b' },
      { id: 'gpt-4.1', name: 'c' },
    ]).map(m => m.id);
    expect(out).toEqual(['gpt-5.2', 'gpt-4.1', 'gpt-4']);
  });

  it('does not mutate the input array', () => {
    const input = [{ id: 'b', name: 'b' }, { id: 'a', name: 'a' }];
    const snapshot = input.map(m => m.id);
    denoiseSortModels(input);
    expect(input.map(m => m.id)).toEqual(snapshot);
  });
});

describe('markRecommended (F1 helper)', () => {
  it('flags only curated ids; preserves order and non-curated entries', () => {
    const models = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ];
    const out = markRecommended(models, new Set(['a', 'c']));
    expect(out.map(m => m.id)).toEqual(['a', 'b', 'c']); // order preserved (P3)
    expect(out.find(m => m.id === 'a')!.recommended).toBe(true);
    expect(out.find(m => m.id === 'b')!.recommended).toBeUndefined();
    expect(out.find(m => m.id === 'c')!.recommended).toBe(true);
  });

  it('empty curated set marks nothing', () => {
    const out = markRecommended([{ id: 'a', name: 'A' }], new Set());
    expect(out[0].recommended).toBeUndefined();
  });

  it('returns a new array (no mutation)', () => {
    const models = [{ id: 'a', name: 'A' }];
    const out = markRecommended(models, new Set(['a']));
    expect(out).not.toBe(models);
    expect((models[0] as { recommended?: boolean }).recommended).toBeUndefined();
  });
});
