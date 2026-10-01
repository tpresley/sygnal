`src/App.jsx` has two copies of the same star-rating widget, one for Food and one for Service. Please refactor:

- Move the star rating into its own reusable component in `src/StarRating.jsx` (default export) and use it for both Food and Service, so `App.jsx` no longer renders the star buttons itself.
- The widget shouldn't know about the app's state shape. The parent gives it the current value to display and is told when the user picks a new one; the parent decides what to do with it.
- The app must look and behave exactly as before: same markup, five ★ buttons per row with the selected ones marked `filled`, and the summary line at the top still updates when a star is clicked.
