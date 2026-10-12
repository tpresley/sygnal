The conference page in `src/` has a chat assistant that talks to our AI route (`POST /api/chat`, set up in `src/main.js`). When it needs the user to choose a session, it asks in text and the user has to type the answer. Let it ask with buttons instead.

- The assistant asks through a client-side tool call: `ask_user` with the input `{ "need": "<what it needs from the user, in one sentence>" }`, and waits for the tool's result. The server already tells the model to use it; the app must offer that tool to the model with every request and answer it.
- When it asks for a session, show a card in the conversation, where the assistant's message is, with one button per session of the program (the session's title). The buttons come from the app's own program, never from text the model writes.
- Clicking a session answers the call: the result, which names the session's id, goes back to the model right away, without the user typing anything, and the conversation continues with the model's reply. After that the card can't be answered again.
- The page's "Your session" line shows the session the user picked.
- Everything the assistant could do before (sending messages, showing the replies) still works.
