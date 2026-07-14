export const UI_COPY = {
  EMPTY_NOTES_LIST: {
    heading: 'No notes yet',
    subtext: "It's quiet in here. Start writing to fill up your workspace.",
    cta: 'Create your first note',
  },
  EMPTY_NOTES_FILTERED: {
    heading: 'No notes match the selected tags',
    subtext: 'Try selecting different tags, or clear the filter to see all your notes.',
    cta: 'Clear filters',
  },
  EMPTY_TRASH_BIN: {
    heading: 'Spotless bin!',
    subtext: 'Nothing to see here! The trash bin is completely empty.',
  },
  EMPTY_SEARCH_RESULTS: {
    heading: 'No notes match your search',
    subtext: 'Try a different keyword or check for typos.',
  },
  SEARCH_IDLE_PROMPT: {
    heading: 'Search your notes',
    subtext: 'Find notes by title or content.',
  },
  RESTORE_CONFIRM: {
    heading: 'Restore note?',
    body: 'This note will be moved back to your active notes.',
    confirm: 'Restore',
    cancel: 'Cancel',
  },
  AUTOSAVE_SAVING: 'Syncing changes...',
  AUTOSAVE_SAVED: 'All changes saved',
  AUTOSAVE_ERROR: 'Sync failed — Retrying...',
  DELETE_NOTE_CONFIRM: {
    heading: 'Delete note?',
    body: 'This note will be moved to Trash. You can restore it within 30 days.',
    confirm: 'Delete',
    cancel: 'Cancel',
  },
  TAG_CREATE_LABEL: (name: string) => `Create "${name}"`,
} as const;
