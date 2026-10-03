Make the stopwatch in this workout timer work. The markup is in place; none of the buttons do anything yet.

- `.time` shows the running time as `MM:SS.t` (minutes, seconds, tenths; always two digits for minutes and seconds), truncated, not rounded: 61.29 s reads "01:01.2". It starts at "00:00.0".
- The running time counts only while the stopwatch runs, from Start or Resume to Pause. Measure it with the clock (`Date.now()` or `performance.now()`), so pausing and resuming never loses or gains time. While it runs, the display is never more than 100 ms behind the running time; once paused, it shows the running time exactly.
- `button.toggle` reads "Start" before the first start, "Pause" while running and "Resume" while paused, and does that.
- `button.lap` ("Lap") is enabled only while running. Each click appends an `<li>` to `ol.laps` reading "Lap N: MM:SS.t", where N counts from 1 and the time is that lap's own running time: since the previous lap, or since the start for the first one (time spent paused doesn't count).
- `button.reset` ("Reset") is enabled only while paused. It brings the stopwatch back to its initial state: "00:00.0", "Start", no laps.
- No timer may be left running while the stopwatch is not running: once it is paused, reset, or removed from the page, there is no pending interval, timeout or animation frame.
- Unchecking "Show stopwatch" (`input[name="show"]`) removes the stopwatch from the page; checking it again shows a fresh one at "00:00.0" with no laps.
