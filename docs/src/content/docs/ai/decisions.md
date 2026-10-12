---
title: Decision Models
description: Fast, typed, calibrated answers about your app's state — decide() with choice, yes/no and score questions, confidence, and escalation to a chat model
---

Not every AI feature needs a paragraph of generated text. Often the app has one simple question: *which team should this ticket go to? Is it urgent? How upset is this customer?* A chat model can answer, but it is slow, it writes prose you then have to parse, and it sounds equally confident whether it's right or guessing.

**Decision models** are built for exactly these questions, and they're one of the quieter but more exciting developments in applied AI. You send some state and a set of typed questions; the model sends back a probability for every possible answer. No text, no streaming. It takes a few hundred milliseconds, costs very little, and its confidence actually means something: 0.4 is unsure, and your app can act on that.

## Questions with types

In Sygnal, you describe the questions with three small builders:

- **`choice`** picks one option from a list you define, each with a description;
- **`noul`** gives the probability of yes, with criteria for what counts as true and false;
- **`score`** places something on a scale of levels you name, like calm, annoyed, angry.

The answers come back under the same names, typed from the questions. There's no prompt to engineer and no output to parse: a topic is one of your topics, a score is a number.

## Just an HTTP request

A decision is an ordinary request for the fetch driver, so there is no new machinery to learn. `decide()` builds the request; you can send it from an action, or run it as a [resource](/guide/resources/) that follows some state and re-asks whenever it changes. Put a resource on each item of a Collection and every row of a list gets classified as it appears.

It works with decision models from several providers, and with local ones through Ollama, so you can try it on your own machine without a key.

## Knowing when to ask for help

Calibrated confidence opens up a pattern that's hard to build with chat models alone: **escalation**. Let the fast decision model handle the clear cases, and send only the ones it's unsure about to a slower, more capable chat model with structured output. Most items are handled in milliseconds, and the hard ones still get a careful answer.

Decision models also power two other features in Sygnal: the [command bar](/ai/agents/#one-line-one-action), which turns a typed sentence into one of your app's actions, and [composed UI](/ai/composed-ui/), where a decision model can arrange a page.

## Where to go next

- [AI Decisions](/guide/ai-decisions/): questions, resources, confidence and escalation, testing with `answers()`, and the server route that keeps the key.
- [Recipe: Support Inbox](/recipes/ai-support-inbox/): every ticket triaged as it arrives, sorted by urgency, with the unsure ones escalated.
- [API: `sygnal/ai`](/reference/api/#sygnalai): `decide`, `choice`, `noul`, `score` and `answers`.
