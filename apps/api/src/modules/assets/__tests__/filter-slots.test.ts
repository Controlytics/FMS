/**
 * settleMembers — the one membership rule behind a replacement row and a PM
 * visit (operator rule 2026-10-26). Pure; the DB side (join times, replacement
 * links) is covered by the replacement and PM e2e suites.
 */
import { describe, it, expect } from 'vitest';
import { settleMembers } from '../filter-slots.js';

const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
const slot = (id: string, joined: number, done: number | null) => ({ id, joinedAt: t(joined), doneAt: done == null ? null : t(done) });
const ids = (r: { members: { id: string }[] }) => r.members.map((m) => m.id).sort();

describe('settleMembers', () => {
  it('open and not done: every slot that has joined is a member', () => {
    const r = settleMembers([slot('a', 0, 5), slot('b', 1, null), slot('c', 6, null)], t(100));
    expect(ids(r)).toEqual(['a', 'b', 'c']);
    expect(r.completedAt).toBeNull();
  });

  it('complete at the earliest moment every slot joined by then is done; later slots are not members', () => {
    const r = settleMembers([slot('a', 0, 5), slot('b', 1, 7), slot('late', 8, null)], t(100));
    expect(ids(r)).toEqual(['a', 'b']);
    expect(r.completedAt).toEqual(t(7));
  });

  it('a slot that joined before the window closed counts; one that joined after it does not', () => {
    const r = settleMembers([slot('a', 0, null), slot('after', 20, null)], t(10));
    expect(ids(r)).toEqual(['a']);
    expect(r.completedAt).toBeNull();
  });

  it('a closed window still completes on a late done (a late PM cleaning)', () => {
    const r = settleMembers([slot('a', 0, 15), slot('after', 12, null)], t(10));
    expect(ids(r)).toEqual(['a']);
    expect(r.completedAt).toEqual(t(15));
  });

  it('a slot done before it joined (cleaned elsewhere, then moved in) completes the entry when it joins', () => {
    const r = settleMembers([slot('a', 0, 3), slot('b', 0, null), slot('moved', 6, 2)], t(100));
    expect(r.completedAt).toBeNull();
    const done = settleMembers([slot('a', 0, 3), slot('moved', 6, 2)], t(100));
    expect(done.completedAt).toEqual(t(3));
    expect(ids(done)).toEqual(['a']);
    const onlyMoved = settleMembers([slot('moved', 6, 2)], t(100));
    expect(onlyMoved.completedAt).toEqual(t(6));
  });

  it('no slots → no members and never complete', () => {
    expect(settleMembers([], t(10))).toEqual({ members: [], completedAt: null });
  });
});
