import * as sales from './Sales.jsx'
import salesSrc from './Sales.jsx?raw'
import chartSrc from './SalesChart.js?raw'
import * as stopwatch from './Stopwatch.jsx'
import stopwatchSrc from './Stopwatch.jsx?raw'
import tickerSrc from './Ticker.js?raw'
import * as review from './Review.jsx'
import reviewSrc from './Review.jsx?raw'
import elementsSrc from './elements.js?raw'
import * as hearts from './Hearts.jsx'
import heartsSrc from './Hearts.jsx?raw'
import reactRatingSrc from './ReactRating.js?raw'
import * as toolbar from './Toolbar.jsx'
import toolbarSrc from './Toolbar.jsx?raw'

export const section = {
  id: 'integrations',
  title: 'Integrations',
  intro: 'Bring foreign code into a Sygnal view without giving up MVI: framework-agnostic libraries through defineWidget, web components as plain tags, Zag.js machines and React components through adapters. Each one is a JSX tag selected by class, read with .detail() and driven with ELEMENT commands.',
  demos: [
    {
      id: 'chart-widget',
      title: 'defineWidget: a Chart.js chart',
      description: 'The chart is drawn from state and updated in place when the values change; a click on a bar comes back as a bar-select event, and a declared command (highlight) is sent from the model with ELEMENT.',
      refs: 'W-1 · D189 · D190 · D196 · recipe: charts',
      files: { 'Sales.jsx': salesSrc, 'SalesChart.js': chartSrc },
      start: sales.start,
    },
    {
      id: 'widget-own-props',
      title: 'defineWidget: ownProps, error(e) and the control form',
      description: 'A widget that draws on its own timer. aria-label stays off the host (ownProps) and names the widget\'s own role="timer"; a failure inside its timer goes to error(e), and the owner\'s onError fallback takes the widget\'s place until new props retry it. Here the widget is used through controls(), the alternative form.',
      refs: 'W-1 · D213 · D201 · SYG661',
      files: { 'Stopwatch.jsx': stopwatchSrc, 'Ticker.js': tickerSrc },
      start: stopwatch.start,
    },
    {
      id: 'web-components',
      title: 'Web components as tags',
      description: 'Web Awesome\'s wa-input and wa-switch, plus two hand-written elements: a form-associated star-field outside the <form> (linked by its form attribute) and a chip-picker whose list is a property. processForm reads them all on submit.',
      refs: 'W-3 · D196 · D205 · D222 (form / list) · .detail()',
      files: { 'Review.jsx': reviewSrc, 'elements.js': elementsSrc },
      start: review.start,
    },
    {
      id: 'from-react',
      title: 'fromReact: a React component as a widget tag',
      description: 'A React component with its own hooks runs in a React root inside the host. Every render passes the newest props; its onChange callback becomes a rate event. aria-label is routed to the component, className to the host.',
      refs: 'W-2 · D203 · D215',
      files: { 'Hearts.jsx': heartsSrc, 'ReactRating.js': reactRatingSrc },
      start: hearts.start,
    },
    {
      id: 'from-zag',
      title: 'fromZag: any Zag.js machine',
      description: 'Zag\'s menu machine runs on the widget host and its parts are rendered with Sygnal JSX and Zag\'s prop getters (keyboard, typeahead and ARIA from Zag). onSelect becomes a pick event; open is a declared command.',
      refs: 'W-2 · D203 · D211',
      files: { 'Toolbar.jsx': toolbarSrc },
      start: toolbar.start,
    },
  ],
}
