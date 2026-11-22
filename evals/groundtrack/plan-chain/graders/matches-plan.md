---
type: llm
focus: { source: file, path: trace/avatars.flightpath.json }
---

The file is a groundtrack graph of ticket map #40, written from the plan in the prompt. In a ticket map, a call edge is "blocked by", and a node's success is what its ticket leaves. Check it against these facts, which hold by construction. A different node name for the same ticket counts.

1. The dependencies are exactly: #42 and #43 each need #41; #44 needs #42 and #43; #45 needs #44. No dependency is invented, and none is missing.
2. Each ticket's success names what it leaves: the bucket and config, a merged PR, the skipped-files report, the flag on, the freed disk.
3. An unreadable file in #43 is handled inside #43 (logged and skipped); it does not stop the plan.
4. A quota exceeded in #43 is an expected failure that stops the plan: it is in the error lists on its way out, and no handler is invented for it.
5. #44 refusing on a non-empty report is shown as a failure that sends the work back to #43, not as a crash.
6. #45's requirements include the seven days with the flag on, and the file marks the deletion as one that cannot be undone.
7. One run goes through the plan and one stops, and the stopping run shows where it stops and why.

PASS when every fact holds, or when at most one is missing and nothing in the file contradicts the plan. FAIL when the file invents a dependency or a handler, or misses two or more facts.
