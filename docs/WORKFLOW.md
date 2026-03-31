\# Enhanced Workflow Orchestration & Task Management

\#\# \#\# Workflow Orchestration

\#\#\# 1\. Adaptive Planning & Context Guardrails  
\* \*\*The 3-Step Trigger\*\*: Enter \*\*Plan Mode\*\* for any task involving 3+ steps or architectural decisions.  
\* \*\*Context Pruning\*\*: Explicitly list irrelevant files/modules before starting to prevent "context drift."  
\* \*\*The Pivot Rule\*\*: If a plan requires \>2 "on-the-fly" adjustments, \*\*STOP\*\*. Immediately re-map the dependency graph and re-plan.  
\* \*\*Verification Specs\*\*: Write detailed specifications upfront that include the "how" of verification, not just the "what" of building.

\#\#\# 2\. High-Fidelity Subagent Strategy  
\* \*\*The Peer Reviewer Pattern\*\*: Assign one subagent to \*implement\* and a second, independent subagent to \*critique\* the implementation.  
\* \*\*Parallel Exploration\*\*: For complex "how-to" questions, launch subagents with different constraints (e.g., Performance-focused vs. Minimalist) to compare outcomes.  
\* \*\*State Isolation\*\*: Subagents must report results in structured format (JSON/Markdown) to keep the main context window clean and actionable.  
\* \*\*Task-Specific Execution\*\*: Strict adherence to "One task per subagent."

\#\#\# 3\. Automated Self-Improvement Loop  
\* \*\*Pattern Extraction\*\*: After any correction, update \`tasks/lessons.md\`. Don't just record the mistake; record the \*\*Anti-Pattern\*\* (why) and the \*\*Heuristic\*\* (prevention).  
\* \*\*Cross-Project Sync\*\*: Query \`lessons.md\` for relevant keywords (e.g., "auth," "async") at the start of every session.  
\* \*\*Failure Analysis\*\*: If a bug recurs, perform a "5 Whys" analysis in the log before implementing the fix.  
\* \*\*Rule Iteration\*\*: Ruthlessly iterate on rules until the specific mistake rate drops to zero.

\#\#\# 4\. Continuous Verification (Shift Left)  
\* \*\*Test-Driven Execution (TDE)\*\*: For bug reports, write the failing test case \*before\* the fix. A task is only "Done" when the test is green in a clean environment.  
\* \*\*Side-Effect Audit\*\*: For every change, list three potential downstream breakages (e.g., "Changing this API response might break the frontend type definitions").  
\* \*\*The Staff Engineer Bar\*\*: Ask: "Is this solution self-documenting, or will it require a comment to explain why it's not a bug?"  
\* \*\*Evidence of Correctness\*\*: Always provide logs, diffs, or \`stdout\` proving the change works as intended.

\#\#\# 5\. Pragmatic Elegance  
\* \*\*The Rule of Three\*\*: If copying code for the third time, abstract it. If it’s only the second, keep it simple.  
\* \*\*Technical Debt Logging\*\*: If a "hacky" fix is necessary due to external constraints, document the trade-off in the codebase or task log.  
\* \*\*Self-Challenge\*\*: Actively look for a more elegant solution before presenting the work. Skip over-engineering for simple, obvious fixes.

\---

\#\# \#\# Task Management (The Flight Checklist)

| Phase | Action | Requirement |  
| :--- | :--- | :--- |  
| \*\*Pre-Flight\*\* | \*\*Plan First\*\* | Write plan to \`tasks/todo.md\` with checkable items and risk assessment. |  
| \*\*In-Flight\*\* | \*\*Atomic Updates\*\* | Mark items complete and provide high-level summaries at each step. |  
| \*\*Verification\*\* | \*\*Verify Plan\*\* | Check in with the user before starting heavy implementation. |  
| \*\*Post-Flight\*\* | \*\*Document Results\*\*| Add a review section to \`tasks/todo.md\` and demonstrate correctness. |  
| \*\*Debrief\*\* | \*\*Capture Lessons\*\* | Update \`tasks/lessons.md\` with the specific heuristic learned. |

\---

\#\# \#\# Core Principles

\* \*\*Simplicity First\*\*: Make every change as simple as possible. Impact minimal code.  
\* \*\*No Ghost Fixes\*\*: Never fix a bug without identifying the root cause. If you can't explain why it broke, you haven't fixed it.  
\* \*\*Readability is a Feature\*\*: Code is read 10x more than it is written. Optimize for the next developer.  
\* \*\*Zero Context Switching\*\*: When given a bug, resolve it autonomously using logs and failing tests. Do not ask for hand-holding.  
\* \*\*Total Ownership\*\*: You own the side effects. A fix that breaks a downstream dependency is a failure, not a completion.  
