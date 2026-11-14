---
name: run-workflow-products
description: "Run a Follow The Flow workflow product for the user: prepare the run, show the person the preview and get their consent when the product requires confirmation, and only then start it. Use when the user asks Follow The Flow to do work through a workflow product — for example to record follow-up tasks and reminders, issue or send bills, or write off receivables against payments — or asks to cancel a run. The workflow itself always runs on the Follow The Flow server; this skill decides only when to ask the person."
---

# Run workflow products

Follow The Flow does its work through **workflow products** (WPs). Each WP is a whole business operation that runs on the Follow The Flow server: the server decides its steps, checks permissions, and keeps the record. Your job is to pick the WP, gather its input from the person, and decide when the person has to see what will happen before it happens.

## Find the workflow product

1. Call `listWorkflowProducts` to see the WPs the person can use now. It is for discovery only; the server still authorizes every operation.
2. Call `getWorkflowProduct` for the one you mean, to learn what it does and what input it needs.
3. Ask the person for any input you do not have. Do not invent values such as amounts, recipients, dates or customers.

A situation may involve more than one WP. For example, "the engagement is done, get it billed and collected" may touch recording the follow-up work, issuing and sending the bill, and writing off the receivable once paid (WP-03, WP-04 and WP-05). Run each WP on its own, with its own prepare and start. Do not describe or reproduce the steps inside a WP, and do not chain the business APIs behind them yourself: the server owns that order.

## Prepare, confirm, start

1. **Prepare.** Call `prepareWorkflowRun` with `{ workflowProduct, input }`. It answers `prepareId`, `preview`, `requiresConfirmation` and `expiresAt`. Preparing changes nothing yet.
2. **Decide whether to ask.**
   - Only when `requiresConfirmation` is exactly `false` may you start without asking (for example WP-03, which only records internal tasks and reminders).
   - When it is `true`, missing, or anything else, you must ask first. WP-04 (issuing and sending bills) and WP-05 (writing off receivables) are `true`: they send something outside the firm or move money.
3. **Show the preview.** Show the person the whole `preview` the prepare answered, not a summary that drops lines: for WP-04 the bills, recipients and amounts; for WP-05 the matches and differences. Say in one sentence what starting will do. Then ask whether to go ahead.
4. **Wait for a clear yes.** Start only after the person answers yes to this preview. Silence, an unclear answer, or a yes given before they saw this preview is not consent. A yes covers this `prepareId` only.
5. **Start.** Call `startWorkflowRun` with `{ workflowProduct, prepareId }`. It answers the run. Use `getWorkflowRun` to follow it.

If the person changes the input after seeing the preview, prepare again and show the new preview.

### When start does not answer

If the start call times out or the connection drops, call `startWorkflowRun` again with **the same** `prepareId`. The same `prepareId` always answers the same run, so retrying cannot start a second one. Do not prepare again for a retry: a new prepare followed by a start opens a new run. Prepare again only when the person wants another run on purpose.

### When start is refused

| Refusal                                                               | What to do                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_stale`                                                       | The data behind the preview changed. Prepare again with the same input; never retry the old `prepareId`. If confirmation is required, show the new preview and ask again: the earlier yes was for the old preview.                                               |
| `prepare_expired`                                                     | The prepare is past its `expiresAt` (24 hours after it was made). Same as `preview_stale`.                                                                                                                                                                       |
| `invalid_input`, `conflict`, `rule_violation`, `idempotency_mismatch` | When the result has `structuredContent`, its `details` list each `field` (a JSON Pointer into the input) and the `reason` (`missing`, `unexpected`, `wrong_type` or `invalid`). Tell the person which field and why, fix the input with them, and prepare again. |
| `forbidden`                                                           | The person may not do this. Tell them; do not look for another way to do it.                                                                                                                                                                                     |
| `not_found`                                                           | The WP, the `prepareId` or the run does not exist for this person. Tell them.                                                                                                                                                                                    |

If `prepareWorkflowRun` itself is refused, handle the refusal as this table says.

## Cancel a run

Call `cancelWorkflowRun` with `{ workflowProduct, runId }`. A run can be cancelled only before any step that sends something outside the firm or moves money has begun; after that the answer is `cancel_not_allowed`, so tell the person it is too late to cancel. Cancelling a run that is already cancelled answers the same result again.

## Why you still ask when the server checks

Asking the person is how they stay in control of what is sent and paid in their name. It is not a security check: the server authorizes every start again, refuses a prepare that has expired or whose data changed, and does not know whether you asked. That is not a reason to skip asking; it is the reason asking is your job.
