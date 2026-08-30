This topic records the active detection, waiting, and resume contracts for provider usage limits.

## Claims

### `rule: limit-resume-runtime`

A session extension detects a provider usage-limit stop from the settled assistant error and re-triggers the interrupted turn without operator presence. It derives the resume time only from observed limit facts: an exhausted limit window reported on a provider response, or a reset the failure text states outright. It never infers a reset from plan, window, or elapsed-time assumptions, and it consumes an observed reset when scheduling, so a later stop rests on its own evidence rather than on a window that may since have cleared. Among several exhausted windows the latest reset governs, and a window's remaining-seconds value is preferred over its absolute epoch so local clock skew cannot distort the wait. Every scheduled wait is floored, and a reset already in the past degrades rather than resuming immediately. When no reset time is observable the extension retries on a fixed recurring interval and discloses the degraded mode. Credit and billing exhaustion is classified apart from a resumable limit and receives no resume.

A pending resume is visible to the operator, reporting its target time when one is known, that no reset time is known when one is not, and its attempt count. It remains cancellable by any operator message and by its own command, and it is disarmed at session shutdown so no timer outlives the session. Automatic resume never fabricates user input in session history. The extension never changes the operator's transport configuration.
