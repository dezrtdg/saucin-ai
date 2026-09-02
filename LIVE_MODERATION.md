# Saucin AI v1.4 — Live Moderation

Live Enforcement uses the same verified Discord-rule detection pipeline as Observe Mode, then applies the fixed Saucin RP escalation ladder.

## Standard ladder

| Repeat level | Automated action |
| --- | --- |
| 1st offense | Reminder |
| 2nd offense | Warning |
| 3rd offense | 10 minute Discord timeout + delete offending message |
| 4th+ offense | 1 hour Discord timeout + delete offending message + staff follow-up flag |

## How progression works

- **Observe Mode:** a case must be Confirmed by staff before it counts toward a future offense level.
- **Live Enforcement:** when the primary automated action succeeds, the case is automatically Confirmed and immediately becomes part of the repeat-offense history.
- A failed secondary step does not block progression when the primary action succeeded. For example, if a 10 minute timeout succeeds but message deletion fails, the case still advances and the deletion error is logged.
- If the primary action fails, the case remains Pending for staff and does not advance the ladder automatically.
- Staff can Dismiss an automatically confirmed live case at any time to correct the member's future escalation history.
- A 4th+ case is flagged for staff follow-up, but staff approval is **not** required before the automated 1 hour timeout/delete action is applied or before the case counts.

Only cases currently in **Confirmed** status count toward the next offense level. Dismissed cases do not count.

## Modes

- **Off** — no moderation detection or enforcement.
- **Observe only** — creates moderation cases but never performs player-facing actions.
- **Live enforcement** — creates the same moderation cases and queues the fixed action for immediate execution. Successful primary actions auto-confirm the case.

Switching away from Live mode cancels actions that are still pending and have not started.

## Discord permissions

Live mode will not enable until the bot's Discord guild permissions include:

- Send Messages
- Manage Messages
- Moderate Members

Discord role hierarchy still applies. The Saucin AI role must be above a member's highest role for Discord to allow a timeout. The worker checks `moderatable` again for every timeout and records a failure instead of bypassing Discord safeguards.

Administrator is not required or recommended.

## Delayed-action safety

A live action must begin within 5 minutes of the detected message. If the bot is offline, permissions are removed, or another problem delays execution beyond that window, the case is marked **skipped** instead of applying a late punishment.

If the worker is interrupted after claiming a case, it does **not** automatically retry the punishment. The case is marked failed for staff review rather than risking a duplicate timeout/message action.

## Action audit

Every action stores durable execution results on the moderation case and adds a timeline event. Results include:

- moderation notice sent/not sent
- message deleted/already missing/not deleted
- timeout applied/not applied and duration
- execution errors
- staff-follow-up flag
- whether Live Enforcement automatically confirmed the case

When a Staff Audit Channel is configured, Live mode posts action results there automatically. Observe-only audit posts are disabled while Live mode is active to prevent duplicate/misleading audit messages.

## Staff correction remains available

Live Enforcement is designed to progress automatically. Staff review is an override/correction path rather than a required approval step. If staff determines an automated detection was wrong, dismissing the case removes it from future repeat-offense calculations.

There are no automatic bans or kicks in v1.4.
