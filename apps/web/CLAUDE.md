# NoteApp Frontend Workspace (`apps/web`)

## Tech Stack
- **Framework**: React 19 + Vite + TypeScript (Strict)
- **Routing**: TanStack Router
- **State Management**: 
  - *Server State*: TanStack Query v5
  - *Client State*: Zustand
- **Styling**: Tailwind CSS v4 (Strictly **Light Mode** only)
- **UI Components**: shadcn/ui, lucide-react, sonner (for toasts)
- **Forms**: react-hook-form + Zod (using schemas from `packages/shared`)

## Global UX & Architecture Conventions
This workspace strictly follows the rules defined in `docs/UX.md`. Whenever building or refactoring components in this workspace, ensure adherence to the following:

### 1. State Management Boundaries
- **Server Data**: ALWAYS use TanStack Query for remote data (`useNotesList`, `useTags`, etc.). Include all filter tokens in query keys for strict server-side refetching.
- **Client State**: ALWAYS use Zustand for ephemeral state (auth tokens in memory, drawer toggles, drafts). 
- **NEVER** store API data collections in Zustand, and **NEVER** store access tokens in TanStack Query.

### 2. Authentication & Tokens
- **Access Tokens**: Stored strictly in JavaScript heap memory via `authStore`. NEVER use `localStorage`, `sessionStorage`, or IndexedDB for tokens.
- **Refresh Tokens**: Handled automatically by the browser via `HttpOnly` cookies. Frontend JS never reads or parses them.
- **Interceptors**: Axios/Fetch clients must silently catch 401s, attempt a single refresh (`/api/v1/auth/refresh`), and either retry the request or force a logout.

### 3. Visual Design & CSS
- **Light Mode Only**: The app uses a clean, light aesthetic. Use `bg-white` cards on `bg-slate-50` backgrounds, with dark slate text.
- **Centering**: Use Flexbox (`min-h-screen flex items-center justify-center`) for standalone forms (Login, Register, Forgot Password).
- **Loading States**: Never show jarring empty space. Use `Loader2` spinners in buttons (without changing button dimensions) and `Skeleton` screens for lists. Enforce a minimum display time of 200ms to prevent visual flickering.

### 4. Forms & Error Handling
- **Schemas**: Import Zod validation schemas strictly from `@shared/schemas`. Do not redefine them locally in the web app.
- **Error Toasts**: Use `sonner` (`<Toaster position="top-right" />`). Limit max toasts to 3. Map API error codes directly to user-friendly text in `errorMessages.ts` rather than displaying raw SQL or backend errors.
- **Validation**: Trigger validation `onBlur` rather than on every keystroke to prevent premature red borders. 

### 5. Destructive Actions
- Any irreversible action (Revoke Share, Permanent Delete, Restore Version) MUST trigger a confirmation modal.
- Use a red primary action button (`variant="destructive"`) and ensure the "Cancel" button is focused by default (`autoFocus`) to prevent accidental Enter-key confirmation.

## Documentation Reference
When in doubt, refer to the source of truth documents located in the repository root:
- `docs/UX.md` (Frontend Architecture)
- `docs/FRS.md` (Business Requirements)
- `docs/SDS.md` (Technical Design)
