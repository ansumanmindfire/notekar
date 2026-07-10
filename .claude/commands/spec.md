Ticket ID: $ARGUMENTS

You are creating a SPECIFICATION for an OpenSpec change.

The spec.md is derived from three sources:
  1. The user's responses about what they want
  2. docs/FRS.md (functional requirements)
  3. docs/SDS.md (system design conventions)

Steps:
1. Determine ticket type by ID ($ARGUMENTS):
   - AB-1001              → INFRA ticket (project setup)
   - AB-1002 to AB-1009   → BACKEND ticket
   - AB-1010 to AB-1015   → FRONTEND ticket
   - AB-1016              → E2E ticket
2. Read CLAUDE.md fully.
3. Read docs/FRS.md fully (always).
4. Conditional context loading:
   - INFRA ticket → no extra docs needed (FRS FR-INFRA-* section is sufficient)
   - BACKEND ticket → also read docs/SDS.md
   - FRONTEND ticket → read docs/SDS.md for API contract reference
   - E2E ticket → read docs/SDS.md
5. Ask clarifying questions if anything is ambiguous BEFORE writing. Do not guess.
6. Create folder openspec/changes/$ARGUMENTS/
7. Generate based on ticket type:

   INFRA ticket — generate ONE file:
     a. spec.md with sections:
        ## Overview
        ## Goals
        ## Non-Goals
        ## FRs Covered
        ## Tooling Decisions
        ## File Layout
        ## Configuration Files
        ## Scenarios
        ## Dependencies
        ## Open Questions

   BACKEND ticket — generate two files:
     a. spec.md with sections:
        ## Overview
        ## Goals
        ## Non-Goals
        ## FRs Covered            (List FR-* IDs. MUST verify soft-delete rules)
        ## API Contract          
        ## Data Model            (Check Prisma models. No CASCADE DELETE bypassing soft-delete)
        ## Ticket-Specific Decisions
        ## Scenarios
        ## Dependencies
        ## Open Questions
     b. delta-openapi.yaml

   FRONTEND ticket — generate ONE file:
     a. spec.md with sections:
        ## Overview
        ## Goals
        ## Non-Goals
        ## FRs Covered
        ## Pages / Components
        ## State Management      (Zustand stores, NO localStorage for tokens)
        ## API Integration       (apiClient.ts interception)
        ## Ticket-Specific UX Decisions (MUST verify DOMPurify for rich text)
        ## Scenarios
        ## Dependencies
        ## Open Questions

Ask [y/n] before writing each file.
After writing, STOP:
"Spec drafted. Review openspec/changes/$ARGUMENTS/spec.md. Mark front-matter status: APPROVED before /plan."
