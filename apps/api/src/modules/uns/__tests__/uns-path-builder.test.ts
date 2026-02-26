import { describe, it, expect } from 'vitest';
import { sanitizeName, buildUnsPathFromSegments, matchWildcard } from '../uns-path-builder.js';

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------
describe('sanitizeName', () => {
  it('converts a simple name to lowercase', () => {
    expect(sanitizeName('Temperature')).toBe('temperature');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeName('My Sensor')).toBe('my-sensor');
  });

  it('removes special characters', () => {
    expect(sanitizeName('Sensor@#1!')).toBe('sensor1');
  });

  it('collapses multiple spaces into a single hyphen', () => {
    expect(sanitizeName('Hello   World')).toBe('hello-world');
  });

  it('trims leading and trailing spaces', () => {
    expect(sanitizeName('  padded  ')).toBe('padded');
  });

  it('removes unicode characters', () => {
    expect(sanitizeName('Ünit-1')).toBe('nit-1');
  });

  it('passes through an already-clean name unchanged', () => {
    expect(sanitizeName('clean-name-123')).toBe('clean-name-123');
  });
});

// ---------------------------------------------------------------------------
// buildUnsPathFromSegments
// ---------------------------------------------------------------------------
describe('buildUnsPathFromSegments', () => {
  it('builds a path with no ancestors', () => {
    const result = buildUnsPathFromSegments([], 'My Entity', 'Equipment');
    expect(result).toBe('digilog/v1/my-entity');
  });

  it('builds a path with one ancestor', () => {
    const ancestors = [{ name: 'Plant Floor', category: 'Area' }];
    const result = buildUnsPathFromSegments(ancestors, 'Pump 1', 'Equipment');
    expect(result).toBe('digilog/v1/plant-floor/pump-1');
  });

  it('builds a path with multiple ancestors', () => {
    const ancestors = [
      { name: 'Site A', category: 'Site' },
      { name: 'Building 2', category: 'Area' },
      { name: 'Line 3', category: 'Line' },
    ];
    const result = buildUnsPathFromSegments(ancestors, 'Reactor 7', 'Equipment');
    expect(result).toBe('digilog/v1/site-a/building-2/line-3/reactor-7');
  });

  it('sanitizes ancestor and entity names in the path', () => {
    const ancestors = [{ name: 'My Site!!', category: 'Site' }];
    const result = buildUnsPathFromSegments(ancestors, 'Sensor @2', 'Sensor');
    expect(result).toBe('digilog/v1/my-site/sensor-2');
  });
});

// ---------------------------------------------------------------------------
// matchWildcard
// ---------------------------------------------------------------------------
describe('matchWildcard', () => {
  it('returns true for an exact match', () => {
    expect(matchWildcard('digilog/v1/pump-1', 'digilog/v1/pump-1')).toBe(true);
  });

  it('matches a single level with the + wildcard', () => {
    expect(matchWildcard('digilog/v1/+/temperature', 'digilog/v1/pump-1/temperature')).toBe(true);
  });

  it('returns false when + wildcard level is missing from topic', () => {
    expect(matchWildcard('digilog/v1/+/temperature', 'digilog/v1')).toBe(false);
  });

  it('matches everything after a # wildcard', () => {
    expect(matchWildcard('digilog/v1/#', 'digilog/v1/site-a/building-2/pump-1')).toBe(true);
  });

  it('returns false for a non-matching topic', () => {
    expect(matchWildcard('digilog/v1/pump-1', 'digilog/v1/pump-2')).toBe(false);
  });

  it('returns false when the pattern is longer than the topic', () => {
    expect(matchWildcard('digilog/v1/pump-1/temperature', 'digilog/v1/pump-1')).toBe(false);
  });
});
