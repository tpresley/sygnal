Add undo and redo to this poster editor.

- Add two buttons at the end of `.toolbar`: `button.undo` reading "Undo" and `button.redo` reading "Redo". Undo is disabled when there is nothing to undo, Redo when there is nothing to redo.
- Every change to the poster is a step that Undo takes back: a click on Smaller or Larger, checking or unchecking Bold, and editing the Headline field. A click that changes nothing (Larger at the largest size, Smaller at the smallest) is not a step.
- Typing is grouped: a Headline edit made less than 1 second after the previous Headline edit belongs to the same step, so typing a sentence without stopping is one step. Any other change ends the group, and so do Undo and Redo: the next Headline edit then starts a new step.
- Undo restores the poster as it was before the latest step, one step per click, back to how the page opened. Redo re-applies the undone steps in order. A new change after an Undo discards the steps that could have been redone.
- The Headline field, the Bold checkbox and the preview always show the current poster, also right after Undo and Redo.
- Keyboard shortcuts work anywhere on the page, also while the Headline field has focus: Ctrl+Z or ⌘Z undoes; Ctrl+Shift+Z, ⌘⇧Z or Ctrl+Y redoes. Prevent the browser's default action for these shortcuts (so the browser doesn't also undo text in the field). Other keys keep working as usual.
