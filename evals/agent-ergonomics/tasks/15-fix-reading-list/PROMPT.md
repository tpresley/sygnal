Two bugs were reported in this reading list app. Please find and fix both.

1. Ticking a book's "Finished" box or clicking its "Remove" button doesn't work properly: the right book should be marked finished (or unfinished again, when unticked) or removed, the summary line ("N to read · N finished") should update, and no other book should change.
2. The list is saved in the browser (`localStorage`) so it survives a reload, but changes made in quick succession are not all saved. For example, after adding two books one right after the other and reloading the page, the second book is missing. Every change must be saved within a second of the last change, and after a reload the list must show exactly what it showed before.

The list stays sorted by title, and adding books must keep working as it does now.
