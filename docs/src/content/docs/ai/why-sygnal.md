---
title: Why Sygnal if AI already knows React?
description: The tradeoff between a coding agent's familiarity with established frameworks and Sygnal's explicit patterns, current context, diagnostics, and native capabilities
---

An agent's familiarity with React, Vue, or another established framework is a real advantage. It can often start quickly, and you have a large ecosystem of examples, libraries, and developers to draw on. You shouldn't switch frameworks just because an agent can learn a new one.

The reason to consider Sygnal is what happens **after the first draft**: how much application code the feature needs, how easily you and the agent can trace its behavior, and how you verify a change. Familiarity helps an agent produce code. A framework can also help it check and maintain that code.

## Does Sygnal need to be in the model's training?

You don't need to assume that it is. A coding agent can read a project's instructions, consult a reference, inspect source, and run tools while it works. That gives it a way to learn the framework's current API rather than relying entirely on examples remembered from training.

Sygnal makes that path explicit:

- **Context:** `create-sygnal-app` includes agent instructions. [`llms.txt`](/llms.txt) supplies the component model, canonical forms, and testing patterns in one reference. The [`sygnal-dev` skill](/integration/agents/#the-sygnal-dev-skill) supplies a development workflow.
- **Structure:** views render state, intent turns events into actions, and model entries describe what each action changes or sends. An agent can follow those connections rather than infer behavior spread across callbacks.
- **Feedback:** [`sygnal-check`](/integration/agents/#sygnal-check) checks wiring and canonical forms. The [app graph](/guide/app-graph/) exposes components and their connections; the [dev MCP endpoint](/integration/agents/#dev-server-mcp-endpoint) exposes the running app's state and diagnostics.
- **Verification:** [`renderComponent()`](/integration/testing/) drives the component's real intent and reducers, with fake HTTP and model replies. It gives you a way to test the behavior the agent claims to have built.

There is still a learning cost. An agent has to read that context, may reach for a familiar pattern that doesn't fit, and may need a correction. Tools reduce the amount it has to guess; they don't make every generated change correct. An agent that cannot read project files or run checks gets less benefit from this approach.

## What might make the tradeoff worthwhile?

Consider the code your app needs to own. A conversation involves history, partial replies, cancellation, retry, and UI state. An assistant that acts inside an app also needs tools, input validation, state context, and confirmation. With Sygnal, these fit into the same behaviors, drivers, and action model as the rest of the app.

The [counter-to-chat example](/ai/overview/#from-counter-to-chat) shows the actual additions. The [agent declaration](/ai/agents/#from-a-button-to-a-tool) then exposes existing actions without writing a second implementation of them. Those are concrete reasons to evaluate Sygnal: shared machinery and less coordination code for your application to maintain.

Established frameworks have libraries for these features too. Compare Sygnal with the stack you would actually use, including those libraries. A shorter example alone doesn't establish that a framework is faster to develop with or a better fit for your team.

| Consider Sygnal when… | An established stack may fit better when… |
|---|---|
| You want explicit state and action boundaries that people and agents can inspect. | Your team already has conventions, tests, and tools that make its existing code easy to change. |
| Several features can share Sygnal's chat, agent, form, resource, or testing machinery. | A critical library, platform, or integration is a stronger fit for another ecosystem. |
| You're starting a project or evaluating an isolated feature. | Migration would cost more than the problem you're trying to solve. |
| Your agent can load the reference and use the checker and tests. | Your workflow depends on generating code with little project context or tool access. |

You can also use Sygnal without putting AI in your product. Its coding-agent tools work for ordinary forms, lists, dashboards, and other UI.

## What evidence is there?

The repository includes an [evaluation harness](https://github.com/tpresley/sygnal/tree/main/evals/agent-ergonomics) with paired Sygnal and React tasks, hidden acceptance tests, and records of time and edit iterations. We use it to find friction and test tooling changes.

The [early baseline](https://github.com/tpresley/sygnal/blob/main/evals/agent-ergonomics/results/BASELINE.md) is instructive: both frameworks passed every trial, and React was faster on the shared tasks. That run predates the tooling improvements and identified framework and testing defects as well as learning overhead. It doesn't isolate training familiarity as the cause, or tell you which framework wins on your application. Later runs also have specific models, task sets, and conditions; small experiments aren't a universal ranking.

## Try the tradeoff on a real change

Pick a representative task, give the agent Sygnal's reference and workflow, and ask for tests of the behavior you care about. Try the same task in your usual stack with its normal tools and libraries. Include a follow-up change, rather than stopping at a working first draft.

Look at correctness, time spent reading and fixing, dependencies, and how easily **you** can understand the result. That is a more useful decision than either “the model already knows it” or “the framework was built for AI” on its own.

To begin, [set up the agent workflow](/integration/agents/) or [build your first app](/getting-started/).
