Minimal versions of the review-eval cases behind three behaviour-report fixes (dev-plans/research/read-side-eval,
tasks 80, 85 and 86; written for these tests, not copied from the eval). Each directory is an overlay on the
one before it: `base`, then `refactor` (requests, a guard and a `map` moved into helpers, `canSend` rewritten
as early returns: the same behaviour), and on top of `refactor` one of:

- `slip`: `canSend` with a De Morgan slip (lets a reply through on a closed ticket)
- `beacon`: the view sends a beacon through a helper (SYG265)
- `new-request`: `closeRequest` posts to another address
- `guard-helper`: `canSend` asks for a longer draft (other atoms: the direction can't be worked out)

test/behaviour-report.vtest.js reads them.
