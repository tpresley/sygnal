---
title: UI Composed by a Model
description: Let users describe the page they want and have a model build it from components your app prepared — catalogs, the compose behavior, and cards in a chat
---

Some screens are better arranged by the person using them than by the person who built them. A dashboard. A workspace. A "show me what matters this morning" page. You can't design every combination in advance, and a settings panel full of checkboxes isn't much fun either.

With `sygnal/ai`, the user just says it: *"urgent tickets first, then the pending orders, and a revenue chart for the quarter."* A model builds the page from **parts your app prepared**, and it appears, wired up and working.

## The model chooses, the app renders

This is the part that makes it practical rather than a demo. Generating UI is risky when a model writes markup: you get labels you didn't write, buttons that do nothing, numbers it made up. Sygnal's approach is stricter and, honestly, more fun to build with.

You declare a **catalog**: real Sygnal components, each with a short description (which is all the model ever sees of it) and the params it may set from lists you define. The model only **chooses**: which parts, in which order, in which container, with which params. Every label, number and button on the composed page is your component's own, wired into app state exactly the way you wired it. A ticket list composed by a model is the same ticket list you'd have placed by hand.

The user can keep going, too. "Remove the chart." "Make the orders a table." Follow-up edits change the existing page instead of starting over.

## Two kinds of model, one catalog

The same catalog works with either backend:

- a **decision model** answers multiple-choice questions about the catalog ("is the revenue chart asked for? which part comes first?") with probabilities, and code turns the answers into the layout. Fast and cheap;
- a **chat LLM** fills a schema of the catalog in one structured-output request, streamed in as a live preview while it arrives.

Switching between them is one option. The app code, the rendering and the tests stay the same.

## Cards in a chat

The same idea works inside a conversation. Some answers are easier to click than to type: one of a few options, a plan from the app's list, a short form, "does this look right?" With `chat({ ask })`, an assistant can **ask with a card**: it says in one sentence what it needs, the app composes a card from its own catalog, and the user's click goes back to the model as the answer.

It's a small thing that changes how a chat assistant feels. Instead of a wall of text asking you to type "Team plan", it puts the three plans in front of you.

## Where to go next

- [Composing UI with a Model](/guide/ai-compose/): the catalog, the `compose` behavior, both backends, follow-up edits, composing from an agent, and testing with `composeWith`.
- [Cards in a Chat](/guide/ai-cards/): `chat({ ask })`, result parts, the card lifecycle and client tools.
- [API: Composed UI and chat cards](/reference/api/#composed-ui-and-chat-cards-630): `defineCatalog`, `compose`, `<Composed>`, `askCard`.
