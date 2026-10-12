---
title: Streaming Chat
description: Language models as a Sygnal driver — streaming replies as actions, transports for local, hosted and on-device models, structured output and tools
---

Most AI integrations start the same way: a component calls a provider SDK, awaits a promise, juggles a loading flag, and hopes nobody clicks twice. Sygnal takes a different path, and it's a satisfying one: **a language model is just another driver**.

A component asks for a reply the way it asks for an [HTTP](/guide/http/) request. A model entry sends the conversation to the `LLM` sink and names the actions that receive the answer: one for the text so far while it streams, one for the finished message, one for a failure. The component never calls `fetch` and never imports a provider. It reduces actions into state, and the view shows the words as they arrive.

## Any model, same component

What changes from model to model is the **transport**, which you pick once in `main.js`. The component code stays the same whether it talks to:

- **a model on your laptop** through Ollama, with no account, no key and no server code. This is the nicest way to start;
- **a hosted model** (OpenAI, Anthropic, OpenRouter and others) behind an [AI SDK](https://ai-sdk.dev) route on your own server, which keeps the key out of the page;
- **an agent server** built with TanStack AI, CopilotKit, LangGraph or Mastra, through AG-UI;
- **the model inside the browser**: Chrome can run a small model on the user's own device, and the `chromePrompt()` transport puts it behind the same driver. Nothing leaves the device.

That last one deserves a moment. A summary, a rewrite or a classification that runs entirely on the visitor's machine, with no server and no cost per request, is a genuinely new kind of web feature, and in Sygnal it is one line in `main.js`.

## More than text

Chat is where it starts, not where it ends:

- **Stop and latest.** A Stop button keeps the text that arrived so far, and a request marked `latest` cancels the one it replaces, so typing fast never leaves stale replies racing each other.
- **Structured output.** Give a request a schema and the reply arrives validated and typed. The model fills your form, picks your enum, returns your object.
- **Tools.** A model can ask the app to run a function, and the result goes back into the conversation.
- **The `chat` behavior.** For a full assistant (message history, streaming, the tool loop and approvals), one behavior gives a component all of it.

## Testing without a model

Because a reply is just actions, tests don't need a network. `renderComponent()` answers the `LLM` sink with scripted text or a scripted stream, and you check the state and the view as usual. The live examples in these docs work the same way: a small demo server plays the part of the model, in the exact wire format a real one streams.

## Where to go next

- [AI Chat](/guide/ai-chat/): the full guide, with live demos of streaming, Stop, structured output, tools and shipping it behind a server route.
- [Transports](/guide/ai-chat/#transports): which one speaks to which model.
- [Recipe: Structured Output into a Form](/recipes/ai-form-fill/): paste an email signature, watch the form fill itself.
- [Recipe: On-device Summaries](/recipes/ai-summarize/): Chrome's built-in model, with a graceful fallback.
- [API: `sygnal/ai`](/reference/api/#sygnalai): `makeChatDriver`, the transports and the message helpers.
