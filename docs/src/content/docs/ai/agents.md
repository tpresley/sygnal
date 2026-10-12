---
title: Agents in Your App
description: Let a model operate your app through the actions you declare — the agent static, an in-app assistant, a one-line command bar, and the safety rules behind them
---

Here's an idea that sounds futuristic and turns out to be surprisingly down to earth: **a language model can use your app the way a person does**, by running its actions. "Add milk to the list." "Mark the Globex order as paid." "Clear everything I've finished." No screen scraping, no simulated clicks: the model calls the same actions your buttons trigger.

Sygnal is a natural fit for this, because a component already lists its actions in its model. All that's missing is a declaration of which ones a model may use.

## One static: `agent`

The `agent` static says three things about a component:

- **which actions** a model may run, each with a description and an input schema;
- **what the model sees** of the component's state: a projection you write, never the raw state;
- **when** each tool makes sense, so a tool that can't do anything isn't offered.

That's the whole contract. An action that isn't listed is not a tool, for any kind of agent. Items in a Collection share one tool per action, with a parameter that names the item, and read-only **queries** let a model ask questions ("which orders are overdue?") without changing anything.

## The same declaration, everywhere

What makes this exciting is how far one declaration travels. Write it once, and it serves:

- an **in-app assistant**: the `chat` behavior gives a component a chat model that operates the component it lives in, with streaming replies and approvals;
- a **command bar**: one line of text, one action;
- the **browser's own agent**, through [WebMCP](/ai/agentic-web/#the-browsers-own-agent);
- an **MCP host** like Claude or ChatGPT, through [MCP Apps](/ai/agentic-web/#your-app-inside-a-conversation);
- a **coding agent** in development, through the dev server's MCP endpoint;
- your **tests**, which can list the tools and call them like a model would.

## One line, one action

The command bar is a favorite. For "do one thing in this app", a full conversation is more than you need. `commandBar` asks a [decision model](/ai/decisions/) which of your agent actions a sentence means, and which item it targets. The answer comes with a confidence, and the action runs only when the model is sure enough. In the research behind this feature, a local decision model picked the right action and target for 8 of 8 commands, in about half a second each, on a laptop.

## Safe by construction

Letting a model act inside an app deserves care, and Sygnal's rules keep it within bounds:

- a tool call runs the same reducer as a click, with the user's authority and nothing more;
- inputs are validated against the schema before anything runs;
- actions marked `consequential` (deletes, payments, sends) wait for the user to approve;
- text users typed is marked as untrusted, and is kept out of tool descriptions and instructions.

No framework solves prompt injection. These rules make sure the worst a fooled model can do is one confirmed action you chose to offer.

## Where to go next

- [Agents](/guide/agent/): the `agent` static, what agents see, the call rules, queries, the in-app assistant, the command bar, security and testing.
- [Cards in a Chat](/guide/ai-cards/): an assistant that asks with a card instead of a question.
- [API: `sygnal/ai`](/reference/api/#sygnalai): `chat`, `commandBar` and `agentTools`.
