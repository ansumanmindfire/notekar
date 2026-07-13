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
  RESTORE_CONFIRM: {
    heading: 'Restore note?',
    body: 'This note will be moved back to your active notes.',
    confirm: 'Restore',
    cancel: 'Cancel',
  },
} as const;
