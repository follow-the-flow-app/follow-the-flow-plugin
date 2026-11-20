---
name: run-workflow-products
description: "Run a Follow The Flow workflow product for the user: prepare the run, show the person the preview and get their consent when the product requires confirmation, and only then start it. Use when the user asks Follow The Flow to do work through a workflow product — for example to record follow-up tasks and reminders, issue or send bills, or write off receivables against payments — or asks to cancel a run. The workflow itself always runs on the Follow The Flow server; this skill decides only when to ask the person."
---

# Run workflow products

Follow The Flow does its work through **workflow products** (WPs). Each WP is a whole business operation that runs on the Follow The Flow server: the server decides its steps, checks permissions, and keeps the record. Your job is to pick the WP, gather its input from the person, and decide when the person has to see what will happen before it happens.

## Find the workflow product

1. Call `listWorkflowProducts` to see the WPs the person can use now. It is for discovery only; the server still authorizes every operation. Each WP has an `id` (a UUID) and a `code` such as `wp03`: every tool's `workflowProduct` takes the `code`, never the `id`.
2. Call `getWorkflowProduct` for the one you mean, to learn what it does and what input it needs.
3. Ask the person for any input you do not have. Do not invent values such as amounts, recipients, dates or customers.

A situation may involve more than one WP. For example, "the engagement is done, get it billed and collected" may touch recording the follow-up work, issuing and sending the bill, and writing off the receivable once paid (WP-03, WP-04 and WP-05). Run each WP on its own, with its own prepare and start. Do not describe or reproduce the steps inside a WP, and do not chain the business APIs behind them yourself: the server owns that order.

## Prepare, confirm, start

1. **Prepare.** Call `prepareWorkflowRun` with `{ workflowProduct, input }`. It answers `prepareId`, `preview`, `requiresConfirmation` and `expiresAt`. Preparing changes nothing yet.
2. **Decide whether to ask.**
   - Only when `requiresConfirmation` is exactly `false` may you start without asking (for example WP-03, which only records internal tasks and reminders): skip steps 3 and 4 and go to step 5.
   - When it is `true`, missing, or anything else, you must ask first: do steps 3 and 4 before step 5. WP-04 (issuing and sending bills) and WP-05 (writing off receivables) are `true`: they send something outside the firm or move money.
3. **Show the preview** (only when you must ask). Show the person the whole `preview` the prepare answered, not a summary that drops lines: for WP-04 the bills, recipients and amounts; for WP-05 the matches and differences. Say in one sentence what starting will do. Then ask whether to go ahead.
4. **Wait for a clear yes** (only when you must ask). Start only after the person answers yes to this preview. Silence, an unclear answer, or a yes given before they saw this preview is not consent. A yes covers this `prepareId` only.
5. **Start.** Call `startWorkflowRun` with `{ workflowProduct, prepareId }`, the `prepareId` exactly as the prepare answered it. It answers the run; its `id` is the `runId` the other tools take, also exactly as answered.
6. **Follow it.** Use `getWorkflowRun` and tell the person the run's state. A run can wait a long time, for an approval or a date: if it is waiting or still running after a few checks, tell them its state, what it waits for when the run says, and its `runId`, and that it goes on by itself. If `getWorkflowRun` fails, say the state is unknown and give the `runId`. When it ends `failed` or `denied`, say so plainly with whatever reason the run gives, and that the steps it finished before stopping are kept: something may already have been sent or recorded, so do not run it again before checking what it did.

If the person changes the input after seeing the preview, prepare again and show the new preview.

### When start does not answer

The run may already have started even when start did not answer with it: the server can replace a successful answer with an error. So whenever start answers with neither a run nor one of the refusals below — it times out, the connection drops, it answers a server error (HTTP 500), or it answers 401 and you have signed in again — call `startWorkflowRun` again with **the same** `prepareId`. A first start answered 403 `insufficient_scope` is not one of these: that start did nothing, so do not retry it; go on as "When the connection lacks a permission" says. The same `prepareId` always answers the same run, so retrying cannot start a second one. Retry up to three times. If signing in again fails, stop retrying and go to the last paragraph of this section.

On such a retry, any refusal — `preview_stale`, `prepare_expired`, `not_found`, `forbidden`, `invalid_input`, `conflict`, `rule_violation`, `idempotency_mismatch` or any other — does not prove that no run started: the first start may still be in progress, or you may now be signed in as someone else. Treat it like no answer, keep the same `prepareId`, and do not follow the refusal table below: it would have you prepare again.

If you still have no answer, tell the person in plain words that the run may already have started and that you cannot confirm it yet. When they ask again later, call `startWorkflowRun` with the same `prepareId` first: it answers the run if one exists, even after `expiresAt`. If no run exists and the prepare is still valid, that same call starts it, so make sure they still want it before you call. That later call is still a retry: if it answers a refusal, the run is still unknown, as above. Do not prepare again for a retry: a new prepare followed by a start opens a new run. Prepare again only when the person wants another run on purpose, and after a start whose outcome is unknown, only once they know the first one may exist.

### When start is refused

This table is for a refusal that answers a first start or a prepare. A refusal that answers a retry after a start that did not answer is handled above, and a refusal that answers a cancel is handled under "Cancel a run", not here.

| Refusal                                                               | What to do                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_stale`                                                       | The data behind the preview changed. Answering a first start, it means no run was started: the server answers an existing run for a `prepareId` before it checks expiry or data. (Answering a retry after a start that did not answer, see above.) Prepare again with the same input; never retry the old `prepareId`. If confirmation is required, show the new preview and ask again: the earlier yes was for the old preview. |
| `prepare_expired`                                                     | The prepare is past its `expiresAt` (24 hours after it was made). Same as `preview_stale`.                                                                                                                                                                                                                                                                                                                                       |
| `invalid_input`, `conflict`, `rule_violation`, `idempotency_mismatch` | When the result has `structuredContent`, its `details` list each `field` (a JSON Pointer into the input) and the `reason` (`missing`, `unexpected`, `wrong_type` or `invalid`). Tell the person which field and why, fix the input with them, and prepare again. Without `structuredContent`, tell them the refusal and ask what to change.                                                                                      |
| `forbidden`                                                           | The person may not do this. Tell them; do not look for another way to do it.                                                                                                                                                                                                                                                                                                                                                     |
| `not_found`                                                           | The WP, the `prepareId` or the run does not exist for this person. Tell them.                                                                                                                                                                                                                                                                                                                                                    |

If `prepareWorkflowRun` itself is refused, handle the refusal as this table says.

## When the connection lacks a permission

When the person connects Follow The Flow, its consent page always grants reading (`workflow:read`: `listWorkflowProducts`, `getWorkflowProduct`, `getWorkflowRun`) and shows a box, ticked, for each other permission your client asked for, which they can clear:

| Box on the consent page                    | Permission        | What it allows                      | Tools that need it                                            |
| ------------------------------------------ | ----------------- | ----------------------------------- | ------------------------------------------------------------- |
| 「準備、啟動與取消工作流程 Run」           | `workflow:write`  | prepare, start and cancel runs      | `prepareWorkflowRun`, `startWorkflowRun`, `cancelWorkflowRun` |
| 「核准或退回核准單（例如開立並寄出帳單）」 | `approval:decide` | approve or return approval requests | the tool that approves or returns an approval request         |

A connection made by entering a code on another device (device sign-in) has no boxes: it gets every permission the client asked for.

A call the connection was not granted is refused before Follow The Flow looks at it, so that call did nothing: HTTP 403 with an `insufficient_scope` challenge whose `error_description` names the permission it needs, for example `workflow:write is required`. (Its `scope` lists every permission, not only the missing one.) If all you see is that the scope was insufficient, the tool you called tells you which permission it was: see the table.

- First check whether the connection was made before these permissions existed: then even reading is refused (a read tool answers this 403, or `error_description` names `workflow:read`; when only a write was refused, one call to `listWorkflowProducts` tells you). Such a connection has to reconnect once, by any way of signing in, device sign-in included; until then every tool but `getUserInfo` is refused this way. Tell the person that; the next bullet does not apply.
- Otherwise, tell the person that this connection was set up without permission to do that, so nothing was done. If they want it done, they reconnect Follow The Flow and keep that box ticked. If the box was not on the page, or they signed in on another device, the client did not ask for that permission: reconnecting the same way will not add it, so tell them that instead. If your client offers to sign in again with more permissions, that sign-in does ask for it. Do not look for another way to do it, and do not say Follow The Flow refused them: the connection did.
- Your client may offer to sign in again with more permissions. Whether to reconnect is the person's choice: tell them what the box allows and let them decide.
- After they reconnect, a run that was refused at prepare or at a first start starts over: prepare again and go on as "Prepare, confirm, start" says, deciding by what the new prepare answers. When its `requiresConfirmation` is exactly `false`, start without asking; otherwise show the new preview and get their yes again: a yes given before reconnecting does not carry over to the new prepare. An approval they asked for, ask them again before you send it.
- A first cancel refused this way did nothing, so the run goes on as before: tell the person that. Once they have reconnected, make sure they still want it cancelled, then go on as "Cancel a run" says, with the same `workflowProduct` and `runId`.
- On a retry after a start or cancel that did not answer, this 403 says only that the retry did nothing; the first call may still have gone through, so the "starts over" bullet above does not apply, and do not say nothing was done. Tell the person that. Once they have reconnected, a start goes on as "When start does not answer" says: make sure they still want it, since that call starts the run if none exists yet, then call `startWorkflowRun` again with the same `prepareId`, which answers the run if one exists, and do not prepare again. For a cancel, call `getWorkflowRun` first (reading still works): if it shows the run `cancelled`, the first cancel went through, so tell them and stop. Otherwise, once they have reconnected, make sure they still want it cancelled, then go on as "Cancel a run" says, with the same `workflowProduct` and `runId`.
- Any other refusal or a 401 is not this: handle it as the other sections say ("Cancel a run" for a cancel). A `forbidden` refusal is Follow The Flow refusing the person, and reconnecting does not change it.

Examples:

- `prepareWorkflowRun` answers 403 `insufficient_scope`. You call `listWorkflowProducts`, and it answers. You say: "This Follow The Flow connection was set up without permission to prepare and start runs, so nothing was prepared. To do it, reconnect Follow The Flow and keep 「準備、啟動與取消工作流程 Run」 ticked." You do not retry.
- `prepareWorkflowRun` answers 403 `insufficient_scope`, and `listWorkflowProducts` does too. You say: "This Follow The Flow connection was made before its current permissions existed, so it cannot do anything yet. Reconnect Follow The Flow once, any way you like, and reading works again; preparing runs also needs 「準備、啟動與取消工作流程 Run」 kept ticked." You do not retry.
- After reconnecting, the person asks again. You prepare again; the prepare answers `requiresConfirmation: true`, so you show the new preview and ask for their yes. Had it answered `false` (as WP-03 does), you would start without asking.
- `cancelWorkflowRun` answers 403 `insufficient_scope` on the first call. You say: "This connection was set up without permission to cancel runs, so the run was not cancelled and goes on. To cancel it, reconnect Follow The Flow and keep 「準備、啟動與取消工作流程 Run」 ticked." After they reconnect, you ask whether they still want that run cancelled; on their yes you call `cancelWorkflowRun` with the same `workflowProduct` and `runId`.

## Cancel a run

Call `cancelWorkflowRun` with `{ workflowProduct, runId }`. Then act on what it answers:

- **The run, with status `cancelled`.** Tell the person the run is cancelled. Cancelling a run that is already cancelled answers the same result again.
- **`cancel_not_allowed`.** The cancel did not happen, and that is final. A run can be cancelled only before any step that sends something outside the firm or moves money has begun; after that the answer is `cancel_not_allowed`. The same answer comes for a run that has already finished (`completed`, `failed` or `denied`). Tell the person it is too late to cancel: what was actually sent or paid stays, and undoing it is a separate business action they start themselves, such as voiding the invoice or undoing the reconciliation match. Nothing rolls back on its own. Check the run with `getWorkflowRun` to tell them where it stands; if that fails, say its state is unknown and give the `runId`.
- **No answer** (a timeout, a dropped connection, a server error, or 401 and you have signed in again). Call `cancelWorkflowRun` again with the same `runId`: cancelling twice answers the same. If it still does not answer, find out what happened (below).
- **401, and signing in again fails.** Tell the person that signing in failed, so the cancel may not have gone through and cannot be confirmed, and that they need to sign in before the run can be checked or cancelled. Give the `runId`.
- **403 `insufficient_scope`.** The connection was not granted the permission to cancel: go on as "When the connection lacks a permission" says, not as the next bullet.
- **Another refusal** (`forbidden`, `not_found` or any other). Tell the person the refusal, then find out what happened (below). Never prepare from a cancel: preparing is the first step of a new run, the opposite of what they asked.

**Find out what happened.** Call `getWorkflowRun`. If it shows the run `cancelled`, tell the person it is cancelled. If it shows the run finished (`completed`, `failed` or `denied`), the cancel did not happen: tell them as for `cancel_not_allowed` above. If it shows the run still running or waiting, tell them that state and that the cancel is not confirmed; they can ask to cancel again. If `getWorkflowRun` fails or is refused, say the cancel is not confirmed and the state is unknown, and give the `runId`. Say a run is cancelled only when `cancelWorkflowRun` or `getWorkflowRun` shows it `cancelled`.

## Why you still ask when the server checks

Asking the person is how they stay in control of what is sent and paid in their name. It is not a security check: the server authorizes every start again, refuses a prepare that has expired or whose data changed, and does not know whether you asked. That is not a reason to skip asking; it is the reason asking is your job.
