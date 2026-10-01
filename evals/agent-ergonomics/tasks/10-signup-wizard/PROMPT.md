Turn this signup form into a two-step wizard. Keep `AccountStep` and `PlanStep` as separate components in their own files.

Above the current step, show "Step 1 of 2" or "Step 2 of 2".

**Step 1 (`AccountStep`)** has the email field (`input[name="email"]`), the password field (`input[name="password"]`) and a "Next" button.

- The email is valid when it looks like `name@domain.tld`: no spaces, exactly one "@", and a "." somewhere after the "@" with text on both sides of it. Otherwise show "Please enter a valid email address." next to the field.
- The password is valid when it has at least 8 characters. Otherwise show "Password must be at least 8 characters." next to the field.
- Don't show a field's message while the user is still filling the form in for the first time. A field's message may appear only once the user has left that field, or once they have clicked "Next". From then on it stays up to date as they type: it disappears as soon as the value is valid and comes back if it becomes invalid again.
- Clicking "Next" while any field is invalid stays on step 1 and shows the messages for every invalid field. When both fields are valid, "Next" goes to step 2.

**Step 2 (`PlanStep`)** has the plan radio buttons (`input[name="plan"]` with values `free`, `pro` and `team`; Free is selected at first), a "Back" button and a "Create account" button.

- "Back" returns to step 1 with the email and password still filled in. Going forward again keeps the plan that was chosen.
- "Create account" replaces the wizard with a summary like "Account created for ada@example.com on the Pro plan." (using the plan's label: Free, Pro or Team).
