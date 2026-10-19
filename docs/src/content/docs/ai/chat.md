---
title: Streaming Chat
description: Language models as a Sygnal driver — streaming replies as actions, transports for local, hosted and on-device models, structured output and tools
---

A conversation needs a message history, a draft while a reply streams, a way to stop, and a way to recover from a failure. The [`chat` behavior](/guide/ai-chat/#the-same-chat-with-the-chat-behavior) owns that lifecycle. You provide the markup and register a chat driver once.

See the [highlighted counter-to-chat example](/ai/overview/#from-counter-to-chat) for the complete addition, including the UI and model connection. Its existing reducers keep working; the conversation lives in its own behavior state.

## One behavior, or individual requests

Use `chat()` when you want a conversation with streaming, history, Stop, and Retry. Use the driver directly for a single request, such as summarizing an article or extracting fields into a form. Both send through the `LLM` sink and receive replies as actions. A component doesn't call a provider SDK itself.

This is where Sygnal saves application code: the behavior coordinates the conversation, and the driver handles transport and reply routing. You can use AI libraries with other frameworks, too; the benefit here is that these pieces share Sygnal's existing state, action, and testing patterns.

## Any model, same component

What changes from model to model is the **transport**, which you pick once in `main.js`. The component code stays the same whether it talks to:

- **a model on your laptop** through Ollama, with no account, no key and no server code. This is a way to start locally;
- **a hosted model** (OpenAI, Anthropic, OpenRouter and others) behind an [AI SDK](https://ai-sdk.dev) route on your own server, which keeps the key out of the page;
- **an agent server** built with TanStack AI, CopilotKit, LangGraph or Mastra, through AG-UI;
- **the model inside the browser**: Chrome can run a small model on the user's own device, and the `chromePrompt()` transport puts it behind the same driver. Nothing leaves the device.

The on-device option is useful for summaries or rewrites that should stay on the visitor's machine. Check browser and device availability and provide a [fallback](/recipes/ai-summarize/); changing the transport leaves your component's conversation logic intact.

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
