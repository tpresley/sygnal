---
title: Built for Coding Agents
description: How Sygnal helps the agents that write your app — llms.txt, the Claude Code plugin and skill, sygnal-check, MCP servers and the running app's state
---

The other half of AI and the web is who writes the code. More and more of it is drafted by coding agents (Claude Code, Cursor, Codex and others), and a framework can make their job much easier or much harder.

Sygnal was shaped with them in mind. It supplies current context, explicit component structure, and checks that help an agent verify its work.

**“But AI already knows React. Why learn Sygnal?”** That's a fair starting point. [Why Sygnal?](/ai/why-sygnal/) considers the familiarity advantage, what tools and runtime feedback can add, and when staying with an established stack makes more sense. This page explains how Sygnal supports that workflow.

## One way to write it

Agents copy what they see. A framework with five ways to do everything gives them five patterns to mix up. Sygnal's docs, examples and references use one **canonical form** for each concept, and strict mode flags the alternatives that still work. Code an agent copies from the docs passes the checker.

[`llms.txt`](/llms.txt) collects those forms into one plain-text reference written for language models: the mental model, the anatomy of a component, one example per concept, the wiring rules and how to test a change. It ships in the npm package too, so an agent can read it offline. Projects created with `create-sygnal-app` already point their agent at it.

## Mistakes that speak up

The bugs agents make most are silent ones: a selector typo, an action nobody handles, an event nobody listens for. In Sygnal those become **coded diagnostics** with a fix, in the dev server, in tests, and from `sygnal-check`, the static checker. An agent runs the checker after each change, reads the message, and fixes it, the same loop a careful developer would follow.

## Seeing the running app

Reading source only goes so far. Sygnal gives agents the app itself:

- **`inspect()`** returns the app graph: components, actions, state and how they connect;
- the **MCP server** offers the checker, the graph and the error explanations as tools;
- the **dev server MCP endpoint** connects an agent to the open page: its state, its actions, its diagnostics and its `agent` tools. An agent can try a fix and see what the app actually did.

For Claude Code, the Sygnal plugin bundles all of this: the `sygnal-dev` skill with the workflow, and the checker's language server so findings appear after every edit.

## Measured, not assumed

These tools are checked against an [eval harness](https://github.com/tpresley/sygnal/tree/main/evals/agent-ergonomics) that gives agents paired tasks in Sygnal and React, with hidden tests. It tracks correctness, time, and edit iterations so tooling changes can be evaluated against actual tasks. Results depend on the model, task, and context; the [evidence and its limits](/ai/why-sygnal/#what-evidence-is-there) are part of the tradeoff, too.

## Where to go next

- [Building with AI Agents](/integration/agents/): `llms.txt`, the skill and plugin, `sygnal-check`, the MCP servers, `inspect()`, the agent loop and how it's measured.
- [Editor Setup](/integration/editors/): the language server in VS Code and Claude Code.
- [Diagnostics](/guide/diagnostics/) and [Strict Mode](/guide/strict-mode/): the coded messages and the canonical forms.
- [Error Reference](/reference/errors/): every diagnostic code, with its fix.
