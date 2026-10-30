# Assignment history and New Leads

Language is an active lead disposition with its own status card and filter.
An untouched lead assigned today stays in New Leads. A subsequent lead edit by
the assigned employee, admin or manager marks it touched. A transfer sent as
Fresh resets the touch marker; a transfer keeping the current status retains it.

The Assignment History page is restricted to admins and reads 50 events at a
time. New events record the action, previous owner, new owner, actor and time.
Older events cannot show details that were never recorded. Assignment events
follow the existing lead-deletion cleanup rules.

Migration `20261030120308_mark_assigned_lead_touch.sql` changes future trigger
behaviour and adds nullable history columns without rewriting existing leads.
Its isolated migration checks cover assignment, status change, fresh transfer,
receiving-agent edits and event attribution.
