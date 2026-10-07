This is a hiring pipeline board: candidates move from Applied through Interview and Offer to Hired (or get rejected), with stage tabs, a summary line, an add form and an activity log. Change the stage flow in two ways:

1. **A new "Screen" stage between Applied and Interview.** "Advance" on an Applied candidate now moves them to Screen (the card's stage shows "Screen", and the activity log records "Ana Ruiz moved to Screen"); "Advance" on a Screen candidate moves them to Interview. Add a tab "Screen (N)" between the "Applied" and "Interview" tabs, with a live count and the usual "No candidates in this stage." message when empty. Screen candidates count as active in the summary line, and they can be rejected like Applied, Interview and Offer candidates.

2. **Rejection is no longer final.** A rejected candidate's card shows a "Reconsider" button (other cards don't). It puts the candidate back in the stage they were rejected from, where they can be advanced and rejected again, and the activity log records "Dee Park reconsidered (back to Interview)" (with that stage's name). Candidates who are already rejected in the starting data were rejected at Applied, so Reconsider sends them back to Applied.

Everything else must keep working as it does today. Update the project's tests where this changes the behavior they check, and add tests for the new behavior; `npm test` must pass.
