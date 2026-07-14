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
  SHARE_MODAL: {
    heading: 'Share Note',
    emptyState: 'No active share links. Create one below to share this note.',
    createLinkLabel: 'Link active for (days):',
    createLinkButton: 'Create link',
  },
  REVOKE_SHARE_CONFIRM: {
    heading: 'Revoke share link?',
    body: 'Anyone with this link will immediately lose access to the note. This action cannot be undone.',
    confirm: 'Revoke',
    cancel: 'Cancel',
  },
  SHARE_LINK_COPIED: 'Link copied to clipboard',
  PUBLIC_SHARE_INVALID: {
    heading: 'Link no longer valid',
    subtext: 'This share link has expired, been revoked, or the note no longer exists.',
  },
  VERSION_HISTORY: {
    heading: 'Version History',
    emptyState: 'No past versions yet. Versions are saved automatically each time you edit this note.',
    currentLabel: 'Current',
    restoreButton: 'Restore this version',
  },
  RESTORE_VERSION_CONFIRM: {
    heading: 'Restore this version?',
    body: 'The note’s title and content will revert to this version. A snapshot of the current content is saved first, so nothing is lost.',
    confirm: 'Restore',
    cancel: 'Cancel',
  },
} as const;
