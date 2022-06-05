# Sygnal

An intuitive framework for building fast and small components or applications based on Cycle.js


## Cycle.js

Cycle.js is a functional reactive coding framework that asks 'what if the user was a function?'

It is worth reading the summary on the [Cycle.js homepage](https://cycle.js.org/ "Cycle.js Homepage"), but essentially Cycle.js allows you to write simple, concise, extensible, and testable code using a functional reactive style, and helps ensure that all side-effects are isolated away from your component code.

## Sygnal

Sygnal makes building Cycle.js apps and components much easier by handling all of the most complex stream plumbing, and provides a minimally opinionated structure to component code while maintaining full forwards and backwards compatibility with all Cycle.js components whether built with or without Sygnal.


## Why?

Cycle.js is a powerful and criminally underappreciated framework that despite its many advantages (like fully isolated side-effects, functional reactive style, pure-by-nature components, extremely small number of dependencies, tiny bundle size, and fast performance) can be challenging to build complex applications with due to the high learning curve to understanding functional reactive style programming with observables, and the often complex stream plumbing that is required to layer and connect components together.

Sygnal provides a structured way to create Cycle.js components that accomplishes several key goals:
- Minimize boilerplate
- Provide a simplified way to handle common application tasks
- Handle all stream plumbing between components
- Support arbitrarily complex applications with deep component hierarchies
- Reuse the best patterns from popular frameworks like React and Vue while avoiding the pitfalls
- Support pure Javascript, Typescript, and JSX (including fragments)
- Provide application state out of the box, and make it easy to use
- Use reasonable defaults while providing access to low-level Cycle.js functionality wherever possible
- Provide automatic debugging information
- Work with modern bundlers like Vite, and provide easy application bootstrapping


## Features

Sygnal provides the following features for quickly building powerful components to build either fully Sygnal based applications, or to be used in combination with existing Cycle.js components.

### The component() Function

Sygnal's component() function is the only thing needed to create a stand-alone component.  It takes any of a number of optional parameters, and returns a Cycle.js compatible component (See the [Cycle.js documentation](https://cycle.js.org/getting-started.html "Cycle.js Documentation") for a full description, but essentially this means component() returns a function that accepts Cycle.js 'sources' and returns Cycle.js 'sinks').

The 3 most common/useful parameters to component() are:
- **model**: an object that maps 'action' names to the commands or reducers that tell Cycle.js drivers **WHAT** to do
- **intent**: a function that receives Cycle.js sources and returns a map of 'action' names to observable streams telling the application **WHEN** that action should happen.
- **view**: a function receiving the current application state and returning virtual DOM elements (using either Preact style h() functions or by using JSX transpiling using snabbdom-pragma)

Essentially the **'model'** parameter determines **WHAT** should happnen, the **'intent'** parameter determines **WHEN** things happen, the **'view'** parameter determines **WHERE** everything is rendered in the browser, and the provided Cycle.js **'drivers'** determine **HOW** things happen.

Unlike most other popular frameworks, Sygnal (being built on Cycle.js) does not expect or rely on any events or functions being specified in the HTML view.  Instead, **ALL** events that the application should respond to (whether a user action, a remote network call, a timer, or any other external event) are detected in the **'intent'** function... the **'view'** is **ONLY** for presentation.

This strict separation of component logic makes reasoning about how to build the component easier, and makes refactoring and enhancing components a breeze.


### The collection() Function

Sygnal's collection() function is a wrapper for Cycle.js's makeCollection() function (See the [documentation here](https://cycle.js.org/api/state.html#cycle-state-source-usage-how-to-handle-a-dynamic-list-of-nested-components "@cycle/state makeComponent documentation")) that provides an extremely simplified API for creating dynamic lists of components from an array, and automatically grows, shrinks and updates with changes to the state. The collection() function is designed to work 'as is' for the vast majority of use cases, and provides configuration options for more advanced use cases.  And in the rare case that collection() is not powerful enough, Sygnal components can seamlessly work with the results of Cycle.js's makeCollection() instead.


### The switchable() Function

Sygnal's switchable() function provides an easy way to create a new component that 'switches' between multiple other components (for switching content based on tab or menu navigation for example).

The 'active' component (the component which is made visible) can be set by either providing an observable that emits component names, or by a function that takes the current application state and returns the component name.


### The run() Function

Sygnal's run() function is a wrapper for Cycle.js's run() function with the following additions/defaults:
- Automatically adds application level state (add a 'source' and 'sink' with the name 'STATE')
- Adds a DOM driver (providing user events and accepting new virtual DOM)
- Adds an EVENTS driver to allow easy messaging between components or the entire application
- Adds a LOG driver that simply console.log's any data passed to it
- Looks for and mounts to an HTML element with an id of root (#root)

*NOTE: Sygnal currently only supports xstream as its observable library despite Cycle.js supporting Most and RxJS as well.  Support for these alternative observable libraries will be added in the near future.*


### The processForm() Function

A very common task in web pages and browser applications is to work with form inputs.  Unfortunately, the logic and stream plumbing required to do this routine task can be challenging to developers new to observables (and is frustrating even for most veterans).  Sygnal's processForm() helper function takes any HTML form element, and automatically extracts the values from all input fields contained within it.  By default processForm() listens to both 'input' and 'submit' events, but can be configured to listen to any combination of standard or custom events on the form itself or its inputs.



## Prerequisites

For plain Javascript usage, Sygnal has no prerequisites as all dependencies are pre-bundled.

To bootstrap a minimal Sygnal application using Vite and that supports JSX:

```bash
npx degit tpresley/sygnal-template my-awesome-app
cd my-awesome-app
npm install
npm run dev
```

To build an optimized production ready version of your app:

```bash
npm run build
```

The results will be in the 'dist' folder, and you can serve it locally by running:

```bash
npm preview
```

Alternatively, you can use any other bundler of your choice (Webpack, Babel, Rollup, etc.).  To use JSX in your components while using alternative bundlers, you will need to configure your bundler to use Sygnal's JSX pragma. This is slightly different for each bundler, but looks generally like:

```javascript
// this example is for Vite or esbuild, but most bundlers have options similar to this for handling JSX transpiling
{
  ...,
  esbuild: {
    // add the import for Sygnal's JSX and Fragment handler to the top of each .jsx and .tsx page automatically
    jsxInject: `import { jsx, Fragment } from 'sygnal/jsx'`
    // tell the transpiler to use Sygnal's 'jsx' funtion to render JSX elements
    jsxFactory: `jsx`,
    // tell the transpiler to use Sygnal's 'Fragment' funtion to render JSX fragments (<>...</>)
    jsxFragment: 'Fragment',
  },
}
```


## Initialization

If you used the Vite based sygnal-template above, then the initialization code was already added to a script block in index.html for you.  Otherwise, you can initialize a Sygnal app by adding the following to your project entry point (usually index.js):

```javascript
import { run } from 'sygnal'
// replace the following line with your app's root component
import App from './app'

run(App) // <-- automatically binds to a #root HTML element (make sure you have an element with id="root" or the app won't start)
```

Now you're all set to create components! If you used the Vite based sygnal-template above then you can start a Vite dev server that watches for file changes with:

```bash
npm run dev
```


## Basic Examples

### Hello World

The most basic (and not very useful) component

```javascript
// app.jsx
import { component } from 'sygnal'

export default component({
  view: () => <h1>Hello World!</h1>
})
```


### Using state (basic)

All Sygnal components get state out of the box.  Sub or child components will get state passed from their parent component, but the root component will need an initial state to get things rolling.

This can be provided using the 'initialState' parameter of component().

```javascript
// app.jsx
import { component } from 'sygnal'

export default component({
  initialState: { who: 'World!' },
  view: ({ state }) => <h1>Hello { state.who }</h1>
  // if you prefer not to use JSX, the above is equivalent to:
  //
  //   view: ({ state }) => h('h2', `Hello ${ state.who }`)
  //
  // but you will need to add "import { h } from 'sygnal'" to the top of your file
})
```

As shown here, the current state of the application (equal to the value of 'initialState' for now) will be passed to the view() function, and can be used in any valid Javascript/JSX syntax that results in virtual DOM.


### DOM Events

To make components capable of responding to users interacting with the DOM, you will need to add the 'model' and 'intent' parameters.

The 'model' parameter is an object that maps 'action' names to what should be done when that action happens.

The 'intent' parameter is a function that takes Cycle.js 'sources' and returns an object mapping 'action' names to streams/observables which fire/emit when that action should occur.

This sounds more complicated than it is... basically the 'model' answers **WHAT** can/should happen, and the 'intent' answers **WHEN** those things will happen.

To illustrate, here's a basic counter that increments when the user clicks anywhere in the page:

```javascript
// app.jsx
import { component } from 'sygnal'

export default component({
  // initialize the count to 0
  initialState: { count: 0 },
  model: {
    // when the 'INCREMENT' action happens, run this 'reducer' function
    // which takes the current state and returns the updated state,
    // in this case incrementing the count by 1
    INCREMENT: (state) => {
      return { count: state.count + 1 }
    }
  },
  // the 'sources' passed to intent() is an object containing an entry for each Cycle.js 'driver'
  // Sygnal automatically adds STATE, DOM, EVENTS, and LOG drivers and their resulting sources and sinks
  // the DOM source allows you to select DOM elements by any valid CSS selector, and listen for any DOM events
  // because we map document click events to the 'INCREMENT' action, it will cause the 'INCREMENT' action in 'model' to fire
  // whenever the document is clicked
  intent: (sources) => {
    return {
      INCREMENT: sources.DOM.select('document').events('click')
    }
  },
  // every time the state is changed, the view will automatically be efficiently rerendered (only DOM elements that have changed will be impacted)
  view: ({ state }) => <h1>Current Count: { state.count }</h1>
})
```

*NOTE: action names (like INCREMENT in the above example) can be any valid Javascript object key name*


### DOM Events (part 2)

Now let's improve our Hello World app with 2-way binding on an input field

```javascript
// app.jsx
import { component } from 'sygnal'

export default component({
  // initial name
  initialState: { name: 'World!' },
  model: {
    // update the name in the state whenever the 'CHANGE_NAME' action is triggered
    // this time we use the 2nd parameter of the reducer function which gets the value passed
    // by the stream that triggered the action
    CHANGE_NAME: (state, data) => {
      return { name: data }
    }
  },
  // it's usually more convenient to use destructuring to 'get' the individual sources you need, like DOM in this case
  intent: ({ DOM }) => {
    return {
      // select the input DOM element using it's class name
      // then map changes to the value ('input' event) to extract the value
      // that value will then be passed to the 2nd parameter of reducers in 'model'
      CHANGE_NAME: DOM.select('.name').events('input').map(e => e.target.value)
    }
  },
  view: ({ state }) => {
    return (
      <div>
        <h1>Hello { state.name }</h1>
        {/* set the 'value' of the input to the current state */}
        <input className="name" value={ state.name } />
      </div>
    )
  }
})
```

*NOTE: The expression DOM.select('.name').events('input') results in an observable that 'fires' or 'emits' whenever the DOM 'input' event occurs*


### Multiple Actions

Now let's improve the counter app with increment and decrement buttons as well as an input field to set the count to any value

```javascript
// app.jsx
import { component } from 'sygnal'

// import the xtream observable library so we can do some stream operations
import xs from 'xstream'

export default component({
  initialState: { count: 0 },
  model: {
    // add the value passed from the stream that triggered the action to the current count
    // this will either be 1 or -1, so will increment or decrement the count accordingly
    INCREMENT: (state, data) => ({ count: state.count + data }),
    SET_COUNT: (state, data) => ({ count: parseInt(data || 0) })
  },
  intent: ({ DOM }) => {
    // rather than pass streams directly to the actions, it is sometimes helpful
    // to collect them in variables first
    // it is convention (but not required) to name variables containing streams with a trailing '$'
    // the 'mapTo' function causes the stream to emit the specified value whenever the stream fires
    // so the increment$ stream will emit a '1' and the decrement$ stream a '-1' whenever their
    // respective buttons are pressed, and as usual those values will be passed to the 2nd parameter
    // of the reducer functions in the 'model'
    const increment$ = DOM.select('.increment').events('click').mapTo(1)
    const decrement$ = DOM.select('.decrement').events('click').mapTo(-1)
    const setCount$  = DOM.select('.number').events('input').map(e => e.target.value)

    return {
      // the 'merge' function merges the events from all streams passed to it
      // this causes the 'INCREMENT' action to fire when either the increment$ or decrement$
      // streams fire, and will pass the value that the stream emeits (1 or -1 in this case)
      INCREMENT: xs.merge(increment$, decrement$),
      SET_COUNT: setCount$
    }
  },
  view: ({ state }) => {
    return (
      <div>
        <h1>Current Count: { state.count }</h1>
        <input type="button" className="increment" value="+" />
        <input type="button" className="decrement" value="-" />
        <input className="number" value={ state.count } />
      </div>
    )
  }
})
```



## More Documentation To Come...

Sygnal is the result of several years of building Cycle.js apps, and our attempts to make that process more enjoyable.  It has been used for moderate scale production applications, and we are making it available to the world in the hopes it is useful, and brings more attention to the wonderful work of the Cycle.js team.

Until better documentation is available, here are some well-commented projects using most of Sygnal's features:
- Sygnal ToDoMVC ( [GitHub](https://github.com/tpresley/sygnal-todomvc) | [Live Demo](https://tpresley.github.io/sygnal-todomvc/) ) - The [ToDoMVC](https://todomvc.com/) framework comparison app implemented in Sygnal
- Sygnal 2048 ( [GitHub](https://github.com/tpresley/sygnal-2048) | [Live Demo](https://tpresley.github.io/sygnal-2048/) ) - The [2048 Game](https://github.com/gabrielecirulli/2048 "Original 2048 GitHub repo") implemeted in Sygnal
- Sygnal Calculator ( [GitHub](https://github.com/tpresley/sygnal-calculator) | [Live Demo](https://tpresley.github.io/sygnal-calculator/) ) - A simple calculator implemeted in Sygnal
