This is our team-expenses app (dashboard, expense list and detail, new-expense form, settings). Add budgets per category.

- **Settings**: four number fields, one per category, named `budget-Travel`, `budget-Meals`, `budget-Office` and `budget-Software`, labelled "Travel budget", "Meals budget", "Office budget" and "Software budget". Empty means the category has no budget (that's how they start). Budgets are saved and restored on reload together with the other settings.
- A category's spending is what the dashboard's category table already counts for it: the total of its expenses that weren't rejected.
- **Dashboard**: the category table (`table.category-totals`) gets a third column, headed "Budget". Each row's cell in it has the class `budget` and reads "$730.50 of $500.00" (the category's total, then its budget) when the category has a budget, or "No budget" when it doesn't. A row whose total is more than its budget gets the class `over-budget`.
- Below the table, a `p.over-budget-summary` reads "Over budget: Travel, Meals" (the categories over their budget, in table order), or "All categories within budget." when budgets are set and none is exceeded. With no budget set at all, there is no such paragraph.
- **New expense**: while the chosen category has a budget and its spending plus the entered amount (a number greater than 0) would be more than that budget, the form shows `p.budget-warning` reading "This will put Travel over its budget." (with the category's name). It follows the amount and the category as they change. It is only a warning: the expense can still be added.
- Budget amounts are shown in the chosen currency like every other amount ("€730.50 of €500.00").

Everything that works today must keep working, and the project's tests (`npm test`) must still pass.
