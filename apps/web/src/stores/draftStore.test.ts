import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDraftStore } from './draftStore';

describe('draftStore', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} });
  });

  afterEach(() => {
    useDraftStore.setState({ drafts: {} });
  });

  it('setDraft stores a draft under its key', () => {
    useDraftStore.getState().setDraft('new', { title: 'Hello', body: {} });
    expect(useDraftStore.getState().drafts.new).toEqual({ title: 'Hello', body: {} });
  });

  it('clearDraft removes only the given key, leaving other keys untouched', () => {
    useDraftStore.getState().setDraft('new', { title: 'Draft A', body: {} });
    useDraftStore.getState().setDraft('note-1', { title: 'Draft B', body: {} });

    useDraftStore.getState().clearDraft('new');

    expect(useDraftStore.getState().drafts.new).toBeUndefined();
    expect(useDraftStore.getState().drafts['note-1']).toEqual({ title: 'Draft B', body: {} });
  });

  it('clearDraft on a key with no draft is a no-op', () => {
    useDraftStore.getState().clearDraft('missing');
    expect(useDraftStore.getState().drafts).toEqual({});
  });
});
