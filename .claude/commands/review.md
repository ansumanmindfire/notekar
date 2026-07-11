Review implementation for: $ARGUMENTS

Read-only mode — do NOT modify any files.

Steps:
1. Run: `python -m code_review_graph build`
2. Run MCP Tool: `detect_changes` to get risk-scored analysis of the changes.
3. Read: openspec/archive/$ARGUMENTS/
4. Read: docs/FRS.md (original requirements)
5. Compare implementation against spec scenarios, NoteApp constraints, and the generated code graph.
6. Output:
   ✅ Implemented: [scenario]
   ❌ Missing: [scenario]
   ⚠️ Drifted: [scenario — spec says X, code does Y]
   🔒 Security: [concern]
   📋 FRS gap: [requirement not addressed]
   📊 Graph Insights: [architectural violations found in the graph]
7. No style feedback — compliance only

Format: /review AB-1002-auth
