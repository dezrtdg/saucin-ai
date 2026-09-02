# Saucin AI v1.4 — Live Moderation

Live Enforcement uses the same verified Discord-rule detection pipeline as Observe Mode, then applies the fixed Saucin RP escalation ladder.

## Standard ladder

| Confirmed-repeat level | Automated action |
| --- | --- |
| 1st offense | Reminder |
| 2nd offense | Warning |
| 3rd offense | 10 minute Discord timeout + delete offending message |
| 4th+ offense | 1 hour Discord timeout + delete offending message + required staff review |

Only **staff-confirmed prior cases for the same rule** inside the configured repeat window count toward the next offense level. Pending and dismissed cases do not advance escalation.

## Modes

- **Off** — no moderation detection or enforcement.
- **Observe only** — creates moderation cases but never performs player-facing actions.
- **Live enforcement** — creates the same moderation cases and queues the fixed action for immediate execution.

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
- staff-review requirement

When a Staff Audit Channel is configured, Live mode posts action results there automatically. Observe-only audit posts are disabled while Live mode is active to prevent duplicate/misleading audit messages.

## Staff review remains authoritative for escalation

A live action does not automatically make the case "confirmed." Staff can still Confirm or Dismiss the detection in the dashboard. Only Confirmed cases affect future repeat-offense calculations.

There are no automatic bans or kicks in v1.4.
