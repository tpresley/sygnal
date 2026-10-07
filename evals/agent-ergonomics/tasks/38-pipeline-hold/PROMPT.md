This is a hiring pipeline board: candidates move from Applied through Interview and Offer to Hired (or get rejected), with stage tabs, a summary line, an add form and an activity log. Add a way to put candidates on hold:

- Every candidate who is still in progress (Applied, Interview or Offer) gets a "Hold" button on their card. Hired and rejected candidates don't get one.
- Holding a candidate:
  - adds the class `on-hold` to their card (`li.candidate`) and shows a badge `.hold-badge` with the text "On hold" on it;
  - disables their "Advance" and "Reject" buttons (they stay visible; "Remove" still works);
  - turns their "Hold" button into a "Resume" button. "Resume" undoes all of the above.
- Add a tab "On hold (N)" after the "Rejected" tab. It lists every held candidate, whatever their stage, in the usual board order, with the usual "No candidates in this stage." message when nobody is on hold. Held candidates still appear in their own stage's tab and in "All", and the count stays live like the other tabs' counts.
- The summary line under the heading becomes "N active · M hired · K on hold", for example "6 active · 1 hired · 0 on hold" (always shown, also when K is 0). Held candidates still count as active.
- The activity log records "Ana Ruiz put on hold" when a candidate is held and "Ana Ruiz resumed" when they are resumed.
- Removing a held candidate updates every count.

Everything that works today must keep working. Update the project's tests where the new tab or the new summary changes what they check, and add tests for holding; `npm test` must pass.
