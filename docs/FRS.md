# Functional Requirements Specification

## Note Taking Application

**Version:** 1.0 | **Status:** Drafted | **Date:** July 2026
**Project:** Note Taking App

This document defines the functional and non-functional business requirements for the Note Taking Application. It focuses strictly on *what* the system must do and the user-facing behavior. Technical design decisions, architecture, and API specifications are detailed in the `SDS.md` document.

---

## 1. Scope

### 1.1 In Scope
* Infrastructure and developer tooling setup (linting, formatting, git hooks, commit conventions, local database provisioning)
* Auth (register/login/logout/forgot-password via OTP)
* Notes CRUD with soft delete, restore, and trash view
* pagination/sort/tag-filter
* Tags with note counts
* full-text Search with highlighting
* public Sharing links with expiry/revoke/view-count
* Version History with restore and auto-purge
* plus the full frontend for all of the above and one E2E journey

### 1.2 Out of Scope
* Real-time collaborative editing
* file/image attachments
* mobile app
* OAuth/social login
* note folders/nesting
* actual email sending (console log only)
* Continuous Integration (CI) pipeline — quality gates for this project are enforced locally via Husky pre-commit hooks and the manual `/review` / `/pr` slash commands only; no remote CI system is part of this project's scope

---

## 2. Infrastructure & Developer Tooling (FR-INFRA)

### FR-INFRA-1: Monorepo & Language Setup [AB-1001]
**Business Rules:**
- The codebase is a single pnpm workspace containing `apps/api`, `apps/web`, and `packages/shared`.
- Every package runs TypeScript in strict mode; use of `any` is prohibited.
- `packages/shared` is the single source of truth for Zod schemas, shared TypeScript types, and constants — never duplicated in `apps/api` or `apps/web`.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Fresh clone, `pnpm install` run | All three packages install without error |
| A developer imports a type/schema needed in both frontend and backend | It is imported from `packages/shared`, not redefined locally |

### FR-INFRA-2: Local Database Provisioning (Docker) [AB-1001]
**Business Rules:**
- A local PostgreSQL 16 instance is provisioned via Docker Compose — no developer installs Postgres natively.
- Two logical databases are provisioned: one for development (`notes_dev`) and one for automated integration tests (`notes_test`), each with its own connection string.
- The Postgres image version is pinned to an exact patch release (never `:latest` or an unpinned major/minor tag).
- The database container exposes a health check so dependent commands (migrations, dev server, tests) do not race against a not-yet-ready database.
- Database data persists across container restarts but can be fully reset on demand.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Fresh clone, developer runs the documented DB startup command | Postgres container starts, becomes healthy, and is reachable at the configured connection string |
| Developer runs the documented reset command | All data is wiped and the database is recreated from scratch, migrations reapplied |
| Developer runs the test suite | Integration tests connect to the separate test database, never the dev database |

### FR-INFRA-3: Automated Testing Setup [AB-1001]
**Business Rules:**
- Vitest is configured at the workspace root with overrides for `apps/api` and `apps/web`.
- Playwright is configured under `apps/web/e2e` with at least one baseline smoke test passing out of the box.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Fresh clone, `pnpm test` run | Test runner executes across all packages without configuration errors |
| Fresh clone, Playwright smoke test run | Smoke test passes against a running dev server |

### FR-INFRA-4: Git Hooks & Commit Standards [AB-1001]
**Business Rules:**
- A pre-commit hook runs type-checking, linting (zero warnings allowed), and the test suite before any commit is allowed to complete.
- Commit messages must follow the conventional commit format; `feat`/`fix` commits must reference a ticket (`AB#xxxx`).

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Developer attempts to commit with a lint error present | Commit is blocked |
| Developer attempts to commit a `feat` message with no ticket reference | Commit is blocked |
| Developer commits a valid `chore`/`docs` message with no ticket reference | Commit succeeds |

### FR-INFRA-5: Linting & Formatting [AB-1001]
**Business Rules:**
- ESLint and Prettier are configured once at the workspace root and shared by every package — no per-package config drift.
- Zero lint warnings are permitted anywhere in the codebase.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| `pnpm lint` run from root | Runs against every package; any warning fails the command |

### FR-INFRA-6: Secrets & Environment Configuration [AB-1001]
**Business Rules:**
- An `.env.example` file is committed listing every required variable with a placeholder value.
- The real `.env` file is never committed (excluded via `.gitignore`).
- The application fails fast at startup if a required environment variable is missing.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Fresh clone, `.env` copied from `.env.example` and filled in | Application starts successfully |
| A required variable is missing at startup | Application exits immediately with a clear error, rather than failing later at first use |

### FR-INFRA-7: Dependency Version Pinning [AB-1001]
**Business Rules:**
- All dependency versions in every `package.json` are pinned to an exact version — no `^`, `~`, or `@latest`.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| `package.json` in any package is inspected | Every dependency has an exact, non-range version string |

### FR-INFRA-8: Root Documentation [AB-1001]
**Business Rules:**
- A root `README.md` documents the full setup sequence: install dependencies, start the local database, configure environment variables, run migrations, start the dev server, run tests.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| A new developer follows the README from a fresh clone with no other guidance | They reach a working local dev environment |

### FR-INFRA-9: Spec-Driven Workflow Scaffolding [AB-1001]
**Business Rules:**
- OpenSpec is initialized at the repo root with `changes/` and `archive/` folders for ticket-level proposals.
- `.claude/agents/` contains a read-only `reviewer` agent (spec/FRS compliance checking only, no write access) and a `tester` agent restricted to test file paths.
- `.claude/commands/` contains the project's slash commands (`/start`, `/spec`, `/plan`, `/tasks`, `/implement`, `/review`, `/pr`).
- `.claude/settings.json` configures the Context7 MCP server so library API usage can be verified against live documentation during implementation, per the assignment's mandatory tooling rule. Any credentials/tokens required are read from environment variables and never committed.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| `/start` is run in a fresh clone | Confirms it has loaded project context and is ready for a ticket |
| The `reviewer` agent is invoked | Cannot write or edit any file; only reads and reports |
| A library API is used during implementation | Its usage is checked against Context7 rather than relying on possibly-outdated training knowledge |

---

## 3. User Authentication & Authorization (FR-AUTH)

### FR-AUTH-1: User Registration [AB-1002]
**Business Rules:**
- Users can register using a valid email address and password.
- Passwords must be at least 8 characters and no more than 72 characters, containing at least one uppercase letter, one lowercase letter, and one number. (The 72-character cap matches bcrypt's own input limit — passwords beyond this length are rejected outright rather than silently truncated.)
- The system must reject registrations with email addresses that are already in use (case-insensitive).
- Registration attempts must be rate-limited.
- Passwords must be securely hashed; plaintext passwords are never stored.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Valid email and password provided | Account is created and user is logged in |
| Email is already registered | Registration is rejected with a clear error message |
| Password does not meet complexity rules | Registration is rejected |
| Password exceeds 72 characters | Registration is rejected with a validation error |
| User exceeds registration rate limit | Request is blocked |

### FR-AUTH-2: User Login [AB-1002]
**Business Rules:**
- Users log in with their email and password.
- Successful login establishes an active session on the current device.
- Login failures (wrong password or unknown email) must present identical generic error messages to prevent account enumeration.
- Login attempts must be rate-limited.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Correct email and password | User is authenticated and a session is started |
| Incorrect password or unknown email | Generic error message displayed; login rejected |
| User exceeds login rate limit | Request is blocked |

### FR-AUTH-3: Session Management [AB-1002]
**Business Rules:**
- Sessions remain active continuously while the user is active.
- Suspicious session activity (e.g., a hijacked session token being reused) must instantly invalidate all sessions for that device.
- Session-refresh and logout actions must be rate-limited.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Continuous active use | Session remains valid without forcing manual re-login |
| Stolen token reuse detected | Current session is completely revoked |
| A single client exceeds the refresh/logout rate limit | Request is blocked |

### FR-AUTH-4: Logout [AB-1002]
**Business Rules:**
- Users can log out, which ends the session on their current device.
- Logging out from one device does not log the user out from other active devices.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User logs out | Session on the current device is terminated |
| User logs out on Device A | Session on Device B remains active |

### FR-AUTH-5: Forgot Password (OTP Generation) [AB-1003]
**Business Rules:**
- Users can request a password reset code (OTP) via their email.
- The system generates a 6-digit code valid for 15 minutes.
- To prevent account enumeration, the system returns an identical success message whether the email exists or not.
- OTP requests are rate-limited.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Request submitted for registered email | System generates OTP; generic success message shown |
| Request submitted for unknown email | No OTP generated; identical generic success message shown |

### FR-AUTH-6: Password Reset (OTP Verification) [AB-1003]
**Business Rules:**
- Users must submit the 6-digit OTP and a new password.
- The user has a maximum of 5 attempts to enter the correct OTP.
- Upon successful reset, all active sessions across all devices are terminated, forcing the user to log in with the new password.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Correct OTP and valid new password | Password updated; all active sessions terminated |
| Incorrect OTP (under 5 attempts) | Error displayed; attempts remaining decreased |
| Incorrect OTP (5th attempt) | OTP invalidated; user must request a new one |
| Expired OTP | Reset rejected |

---

## 4. Note Management (FR-NOTE)

### FR-NOTE-1: Create Note [AB-1004]
**Business Rules:**
- Users can create notes containing a title (1-200 characters) and rich-text body.
- Notes can be optionally associated with existing tags during creation.
- A user can only associate notes with their own tags.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Valid title and body provided | Note is created and saved to the user's account |
| Title exceeds 200 characters | Validation error displayed |
| User attempts to use another user's tag | Request rejected |

### FR-NOTE-2: Read Notes [AB-1004]
**Business Rules:**
- Users can view their own notes.
- Users cannot access notes belonging to others.
- Soft-deleted notes cannot be viewed through standard read operations.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User requests their own active note | Note content is returned |
| User requests another user's note | Note not found error |
| User requests their own soft-deleted note | Note not found error |

### FR-NOTE-3: Update Note [AB-1004]
**Business Rules:**
- Users can update the title and body of their notes.
- Every time a note is updated, a snapshot of its previous state is saved to the version history.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User updates note content | Note is updated; a new historical version is captured |

### FR-NOTE-4: Soft Delete Note [AB-1004]
**Business Rules:**
- Deleting a note moves it to a "soft deleted" state for a 30-day recovery window.
- The system must not permanently delete the note during this window.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User deletes a note | Note is hidden from primary lists but retained in the system |

### FR-NOTE-5: Note Pagination and Sorting [AB-1005]
**Business Rules:**
- The notes list must be paginated to support large volumes of notes.
- Users can sort their notes by creation date or last updated date, in ascending or descending order (default: newest first).

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User views the note list | Notes are displayed in pages; default sort is newest first |
| User changes sort order | List updates to reflect the chosen sort criteria |

### FR-NOTE-6: Filter Notes by Tags [AB-1005]
**Business Rules:**
- Users can filter their notes list by selecting one or more tags.
- When multiple tags are selected, the note must contain *all* selected tags (AND semantics).

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User selects Tag A and Tag B | Only notes containing both Tag A and Tag B are shown |

### FR-NOTE-7: View Trash (Soft-Deleted Notes) [AB-1004]
**Business Rules:**
- Users can view a list of their own soft-deleted notes (Trash) at any point within the 30-day recovery window.
- The Trash list is paginated using the same mechanism as the active notes list.
- Notes in Trash are read-only until restored.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User opens Trash | Their soft-deleted notes are listed, newest-deleted first |
| User views a Trash item's content | Content is displayed but cannot be edited |

### FR-NOTE-8: Restore Soft-Deleted Note [AB-1004]
**Business Rules:**
- Users can restore a note from Trash back to active status at any point within the 30-day recovery window.
- Restoring a note clears its deleted state and returns it to the normal notes list immediately.
- Once the 30-day recovery window elapses, the note is automatically and permanently purged by a scheduled background process — it can no longer be restored.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User restores a note from Trash within the recovery window | Note reappears in the active notes list; no longer shown in Trash |
| User attempts to restore a note after the recovery window has elapsed and the note has been purged | Restore fails; note no longer exists |

---

## 5. Tags (FR-TAG)

### FR-TAG-1: Tag Creation & Constraints [AB-1006]
**Business Rules:**
- Tags consist of a name (1-50 characters) and a color chosen from a fixed set of preset color options — not a free-form color picker.
- Tag names must be unique per user, ignoring case (e.g., "Work" and "work" are the same).
- Tags are strictly scoped to the user; there is no global shared tag list.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User creates a new tag | Tag is created with the chosen color |
| User creates tag with existing name (different case) | Rejected as duplicate |

### FR-TAG-2: Tag Deletion [AB-1006]
**Business Rules:**
- Users can delete a tag at any time.
- Deleting a tag removes it from all associated notes, but the notes themselves are not deleted.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User deletes a tag attached to notes | Tag is deleted; notes remain intact but no longer have the tag |

### FR-TAG-3: Tag List & Note Counts [AB-1006]
**Business Rules:**
- The system provides a paginated list of the user's tags.
- Each tag in the list must indicate how many active (non-deleted) notes currently use it.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User views tag list | Tags are displayed alongside accurate note counts |

### FR-TAG-4: Tag Update [AB-1006]
**Business Rules:**
- Users can edit the name and/or color of their own existing tags.
- The same uniqueness (case-insensitive, per-user) and length rules from FR-TAG-1 apply to the updated name.
- A user cannot edit a tag belonging to another user.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User updates their own tag's name and/or color | Tag is updated; change reflected on all notes using it |
| User attempts to rename a tag to a name that collides with another of their own tags (case-insensitive) | Rejected as duplicate |
| User attempts to update a tag belonging to another user | Request rejected |

---

## 6. Search (FR-SEARCH)

### FR-SEARCH-1: Full-Text Search [AB-1007]
**Business Rules:**
- Users can search for keywords across both the titles and bodies of their active notes.
- Search results are paginated.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User searches for a keyword | Notes containing the keyword in title or body are returned |

### FR-SEARCH-2: Search Highlights [AB-1007]
**Business Rules:**
- Search results must include brief excerpts showing where the keyword matched.
- The matching keywords within the excerpts must be visually highlighted.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User views search results | Matching terms are emphasized within text snippets |

---

## 7. Sharing (FR-SHARE)

### FR-SHARE-1: Generate Share Link [AB-1008]
**Business Rules:**
- Users can generate public, read-only links to their notes.
- Users can optionally set an expiration timeframe (1 to 30 days). If omitted, the link expires in 7 days.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User shares note without expiration | Link generated, valid for 7 days |
| User sets expiration to 14 days | Link generated, valid for 14 days |
| User attempts to set expiration > 30 days | Request rejected |

### FR-SHARE-2: Revoke Share Link [AB-1008]
**Business Rules:**
- Users can manually revoke a share link at any time, immediately disabling public access.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User revokes active link | Link immediately becomes invalid for external viewers |

### FR-SHARE-3: Public Link Access & View Counts [AB-1008]
**Business Rules:**
- Anyone with a valid link can view the note's title and content without logging in.
- The system must track the number of times a public link has been viewed.
- If the parent note is soft-deleted, the public link must immediately cease to function.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| External user visits valid link | Note content is displayed; view count increments |
| External user visits expired/revoked link | Error displayed; no access granted |
| External user visits link for soft-deleted note| Error displayed; no access granted |

### FR-SHARE-4: List Share Links for a Note [AB-1008]
**Business Rules:**
- The note owner can view all share links ever created for a given note, including revoked ones, so they can review or manage sharing history.
- Only the note's owner can view this list.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Owner requests share links for their note | All links (active and revoked) are returned, newest first |
| Non-owner requests share links for a note they don't own | Request rejected |

---

## 8. Version History (FR-VER)

### FR-VER-1: View History [AB-1009]
**Business Rules:**
- Users can view a list of historical versions for any note.
- Users can preview the full content of any historical version.
- Version history must remain accessible even if the note is currently in the 30-day soft-delete window.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User opens version history | List of previous saves is displayed |
| User selects a past version | Historical content is displayed |

### FR-VER-2: Restore Version [AB-1009]
**Business Rules:**
- Users can restore a note to a previous version.
- Restoring is non-destructive: it creates a new version containing the restored content, preserving the timeline without overwriting past work.
- Restoring a version affects only the note's title and body. Tag associations are current-state metadata and are **not** modified by version restore — a note's tags remain exactly whatever they currently are, regardless of which version is restored. (Confirmed: restoring a note does not bring back the tags that were associated with it at the time that version was saved.)

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User restores a version | Note content reverts; a new version is added to the history |
| User restores a version of a note that currently has different tags than it did at save time | Note's title/body revert; the note's current tags are unchanged |

### FR-VER-3: Auto-Purge History [AB-1009]
**Business Rules:**
- To conserve storage, the system must automatically delete version snapshots that are older than 90 days.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Note version reaches 91 days old | Snapshot is permanently deleted from the system |

---

## 9. Frontend User Experience (FR-UI)

### FR-UI-1: General Navigation & UX [AB-1010–AB-1015]
**Business Rules:**
- Users must see clear visual feedback (loading spinners, disabled buttons) during background operations.
- The application must prevent the loss of unsaved work during network failures.
- All user-generated rich text must be strictly sanitized before display to prevent security vulnerabilities.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Network request is in flight | Submit buttons indicate loading state |
| Malicious script embedded in note | Script is neutralized upon rendering |

### FR-UI-2: Editor & Autosave [AB-1012]
**Business Rules:**
- The editor supports rich text formatting.
- Notes must auto-save after a short period of inactivity (e.g., 2 seconds after typing stops).
- If an autosave fails, the application must retry automatically. If it fails again, the user must be notified, and a local draft preserved.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User stops typing | System auto-saves changes successfully |
| Network drops during auto-save | System retries, alerts user, and preserves draft locally |

### FR-UI-3: Tagging UX [AB-1012]
**Business Rules:**
- Users can create new tags directly from the note editor by typing a name that doesn't exist.
- New tags created on the fly are assigned a random color automatically.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User types new tag name in editor | Tag is created, assigned a color, and attached to the note |

### FR-UI-4: Version Comparison UX [AB-1015]
**Business Rules:**
- When previewing a historical version, the UI must display a split view comparing the current state against the historical state.
- Restoring a version must require explicit user confirmation to prevent accidents.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User previews a version | Split view shows current vs. past text |
| User clicks restore | Confirmation modal appears before action is taken |

### FR-UI-5: Trash & Restore UX [AB-1011]
**Business Rules:**
- Users can access a dedicated Trash view listing their soft-deleted notes — this is a real, functioning view, not a placeholder.
- From Trash, a user can open a note in read-only preview or restore it to active status.
- Restoring a note from Trash requires explicit user confirmation.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| User navigates to Trash | Soft-deleted notes are listed |
| User clicks Restore on a Trash item | Confirmation modal appears; on confirm, note returns to the active notes list |

---

## 10. End-to-End User Journey (FR-E2E)

### FR-E2E-1: Core Workflow Validation [AB-1016]
**Business Rules:**
- The system must successfully support a complete, uninterrupted core user journey.

**Acceptance Criteria:**
| Scenario | Expected Outcome |
|---|---|
| Register → Login → Create Note → Autosave → Tag Note → Share Note → Revoke Share → Restore Version → Delete Note → Restore from Trash → Logout | All steps complete successfully without errors |

---

## 11. Non-Functional Requirements

### Quality & Performance Targets
- **Test Coverage:** The system must maintain at least 80% automated test coverage.
- **Code Quality:** Zero linting warnings are permitted.
- **Typing:** Strict type safety is enforced; implicit or explicit bypasses (`any`) are prohibited.
- **Local Database:** PostgreSQL is provisioned locally via Docker Compose for every developer — no native Postgres installation is required or assumed.
- **Continuous Integration:** Explicitly out of scope for this project. Quality gates are enforced locally only, via Husky pre-commit hooks and the manual `/review`/`/pr` workflow.

### Consolidated Rate Limits
To protect system stability, the following actions are metered:
| Action | Limit Scope |
|---|---|
| User Registration | Per IP Address |
| User Login | Per IP Address |
| Token Refresh | Per IP Address |
| Logout | Per IP Address |
| Forgot Password Requests | Per Email Address |
| Public Share Link Views | Per IP Address, per Token |

---

## 12. Requirement Traceability Matrix

| Namespace | Feature | Ticket(s) |
|---|---|---|
| FR-INFRA | Monorepo, tooling, Docker DB, testing setup, workflow scaffolding | AB-1001 |
| FR-AUTH | Registration, Login, Session, OTP | AB-1002, AB-1003 |
| FR-NOTE | Notes CRUD, Soft Delete, Trash, Restore, List, Sort, Filter | AB-1004, AB-1005 |
| FR-TAG | Tags CRUD, Note Counts | AB-1006 |
| FR-SEARCH | Full-text Search, Highlights | AB-1007 |
| FR-SHARE | Public Sharing, Expiry, Revoke, Views | AB-1008 |
| FR-VER | Version History, Restore, Purge | AB-1009 |
| FR-UI | Frontend UX, Editor, Autosave, Trash | AB-1010–AB-1015 |
| FR-E2E | End-to-End Journey | AB-1016 |

---

## 13. Ticket Dependency Map

Each ticket's prerequisites. A ticket **MUST NOT** begin until its dependencies are met.

| Ticket | Depends On | Description |
|---|---|---|
| AB-1001 | — | Technical Foundation & Tooling Setup (incl. Docker-provisioned local Postgres) |
| AB-1002 | AB-1001 | Core User & Auth Models |
| AB-1003 | AB-1002 | Forgot Password Flow |
| AB-1004 | AB-1001, 1002 | Core Note Models (incl. Trash & Restore) |
| AB-1005 | AB-1004 | Notes List & Filtering |
| AB-1006 | AB-1004 | Tags Architecture |
| AB-1007 | AB-1004 | Search Architecture |
| AB-1008 | AB-1004 | Sharing Architecture |
| AB-1009 | AB-1004 | Version History Architecture |
| AB-1010 | AB-1002, 1003 | Auth Frontend |
| AB-1011 | AB-1005, 1010 | Notes List Frontend (incl. Trash UI) |
| AB-1012 | AB-1004, 1006, 1010| Note Editor Frontend |
| AB-1013 | AB-1007, 1010 | Search Frontend |
| AB-1014 | AB-1008, 1010 | Sharing Frontend |
| AB-1015 | AB-1009, 1010 | Version History Frontend |
| AB-1016 | AB-1010–1015 | End-to-End Testing |