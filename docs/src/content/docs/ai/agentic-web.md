---
title: The Agentic Web
description: Offer your app's tools to the browser's own agent through WebMCP, and run your app inside Claude, ChatGPT or VS Code as an MCP App
---

For most of the web's history, a page was something a person looked at. Increasingly it is also something an agent *uses*: the assistant built into the browser, an extension, a chat app that opens your site on someone's behalf. Today those agents mostly work by reading the accessibility tree and clicking around, which is slow and fragile.

Two new standards let a page do much better, and Sygnal supports both with the same [`agent` declaration](/ai/agents/) you already wrote.

## The browser's own agent

**WebMCP** is a draft web standard that lets a page offer **tools** to browser agents: named functions with a description and an input schema. Instead of guessing which button adds an item, the agent calls `todos_add` with the text. It's faster, far more reliable, and the page decides exactly what an agent may do.

In Sygnal it's one call in `main.js`. Every tool your components declare is registered, and the registrations follow the app as it changes: a component that leaves the page takes its tools with it, a tool whose `when` turns false is withdrawn, and a new Collection item shows up in the schema. Each call goes through the same rules as any other agent call, including confirmation for consequential actions. Forms can become tools too, so an agent can fill and submit a validated form in one step.

WebMCP is still experimental, in a Chrome origin trial, so Sygnal's support follows the draft and sits outside semver. Where a browser doesn't have it, the call does nothing, so it's safe to ship today and be ready the day it lands.

## Your app inside a conversation

**MCP Apps** go the other direction: instead of an agent visiting your page, your app appears inside the agent's conversation. When a model calls an MCP tool that comes with a view, hosts like Claude, ChatGPT, VS Code and Goose show that view right in the chat, in a sandboxed frame. A forecast with clickable days. A seat map. A chart the user can drill into.

In Sygnal, the bridge between the view and the host is a driver. The view is an ordinary component: it receives the tool's input and result as actions, can call the server's tools, and can tell the model what the user did. It can even declare its own `agent` tools for the host's model to use. The `mcp-app` starter in `create-sygnal-app` gives you a working server and view to begin from.

There's something genuinely fun about building a component once and watching it show up both on your website and in the middle of a conversation with an AI.

## Where to go next

- [WebMCP (experimental)](/guide/webmcp/): exposing the app's tools, trying it in Chrome, budgets, hints, confirmation and form tools.
- [MCP Apps](/guide/mcp-apps/): `makeMcpAppDriver`, the view's own tools, the starter and trying it in a host.
- [Agents](/guide/agent/): the `agent` static both of these are built on.
- [API: `sygnal/ai`](/reference/api/#sygnalai): `experimentalExposeWebMcp`, `formTool` and `makeMcpAppDriver`.
