import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditorStatusStore } from './editorStatusStore';

describe('editorStatusStore', () => {
  beforeEach(() => {
    useEditorStatusStore.setState({ status: 'idle' });
  });

  afterEach(() => {
    useEditorStatusStore.setState({ status: 'idle' });
  });

  it('starts idle', () => {
    expect(useEditorStatusStore.getState().status).toBe('idle');
  });

  it('setSaving transitions to saving', () => {
    useEditorStatusStore.getState().setSaving();
    expect(useEditorStatusStore.getState().status).toBe('saving');
  });

  it('setSaved transitions to saved', () => {
    useEditorStatusStore.getState().setSaved();
    expect(useEditorStatusStore.getState().status).toBe('saved');
  });

  it('setError transitions to error', () => {
    useEditorStatusStore.getState().setError();
    expect(useEditorStatusStore.getState().status).toBe('error');
  });

  it('reset transitions back to idle from any state', () => {
    useEditorStatusStore.getState().setError();
    useEditorStatusStore.getState().reset();
    expect(useEditorStatusStore.getState().status).toBe('idle');
  });
});
