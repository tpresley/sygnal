Add a chart to this sales page, drawn with Chart.js (the `chart.js` package is installed). The region and range pickers and the table already work.

- Inside `.chart`, show a `<canvas>` with a Chart.js bar chart of what the table shows: the labels are the shown months ("Jul" … "Dec" for the last 6 months), and one dataset whose data are the table's units for the chosen region, as numbers.
- The canvas has `role="img"` and an `aria-label` that reads "Sales by month for North: Jul 140, Aug 120, Sep 98, Oct 110, Nov 150, Dec 170" (the region's name, or "all regions", then every shown month with its units, separated by ", ").
- When the region or the range changes, the chart updates in place: the same canvas element and the same Chart instance get the new labels and data (Chart.js's `update()`); the chart is not destroyed and made again.
- Clicking a bar selects its month: `.selected` reads "Selected: Sep, 98 units" (the month and its units). Changing the region or the range clears the selection (`.selected` is empty).
- Unchecking "Show chart" removes the chart: its canvas leaves the page and its Chart instance is destroyed. Checking it again draws a new chart of the current selection of region and range.

jsdom, which the tests run in, has no canvas and no layout. The acceptance tests give `HTMLCanvasElement.prototype.getContext('2d')` a fake context that draws nothing, and add a `ResizeObserver` that never reports; Chart.js runs on those. Since nothing has a position, the tests click a bar the way Chart.js reports a click: they call the chart's `options.onClick(event, elements, chart)` with the clicked bar in `elements` (`[{ datasetIndex: 0, index }]`), and find the chart with `Chart.getChart(canvas)`.
