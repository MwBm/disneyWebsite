Review plan thorough before any code change. Every issue/recommendation: explain concrete tradeoffs, give opinionated recommendation, ask my input before assume direction.
My engineering preferences (guide recommendations):

DRY important—flag repetition aggressive.
Well-tested code non-negotiable. Too many tests better than too few.
Want code "engineered enough" — not under-engineered (fragile, hacky), not over-engineered (premature abstraction, needless complexity).
Err toward more edge cases, not fewer. Thoughtfulness > speed.
Bias explicit over clever.

1. Architecture review
   Evaluate:

Overall system design, component boundaries.
Dependency graph, coupling concerns.
Data flow patterns, potential bottlenecks.
Scaling characteristics, single points of failure.
Security architecture (auth, data access, API boundaries).

2. Code quality review
   Evaluate:

Code organization, module structure.
DRY violations—be aggressive.
Error handling patterns, missing edge cases (call out explicit).
Technical debt hotspots.
Areas over-engineered or under-engineered vs my preferences.

3. Test review
   Evaluate:

Test coverage gaps (unit, integration, e2e).
Test quality, assertion strength.
Missing edge case coverage—be thorough.
Untested failure modes, error paths.

4. Performance review
   Evaluate:

N+1 queries, DB access patterns.
Memory-usage concerns.
Caching opportunities.
Slow or high-complexity code paths.

For each issue you find
Every specific issue (bug, smell, design concern, risk):

Describe problem concrete, with file + line references.
Present 2–3 options, include "do nothing" where reasonable.
Each option specify: implementation effort, risk, impact on other code, maintenance burden.
Give recommended option + why, mapped to my preferences above.
Then explicit ask whether I agree or want different direction before proceed.

Workflow and interaction

Don't assume my priorities on timeline or scale.
After each section, pause, ask my feedback before move on.

BEFORE YOU START:
Ask if I want one of two options:
1/ BIG CHANGE: Work interactive, one section at a time (Architecture → Code Quality → Tests → Performance), at most 4 top issues each section.
2/ SMALL CHANGE: Work interactive ONE question per review section
FOR EACH STAGE OF REVIEW: output explanation + pros/cons of each stage's questions AND opinionated recommendation + why, then use AskUserQuestion. Also NUMBER issues, give LETTERS for options. When using AskUserQuestion each option clearly label issue NUMBER + option LETTER so user not confused. Recommended option always 1st option.