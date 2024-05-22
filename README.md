# Sygnal

An intuitive framework for building fast, small and composable components or applications.

Sygnal is built on top of Cycle.js, and allows you to write functional reactive, Observable based, components with fully isolated side-effects without 
having to worry about the complex plumbing usually associated with functional reactive programming.

Components and applications written using Sygnal look similar to React functional components, and can be nested just as easily, but have many benefits including:
- 100% pure components with absolutely no side effects
- No need for component state management (it's handled automatically at the application level)
- Small bundle sizes
- Fast build times
- Fast rendering
- Close to zero boiler plate code

## Built on Cycle.js

Sygnal is built on top of Cycle.js which is a functional reactive coding framework that asks 'what if the user was a function?'

It is worth reading the summary on the [Cycle.js homepage](https://cycle.js.org/ "Cycle.js Homepage"), but essentially Cycle.js allows you to write simple, concise, extensible, and testable code using a functional reactive style, and helps ensure that all side-effects are isolated away from your component code.

Sygnal takes it a step further, and makes it easy to write arbitrarily complex applications that have all of the Cycle.js benefits, but with a much easier learning curve, and virtually no complex plumbing or boiler plate code.

## Goals of Sygnal

Sygnal provides a structured way to create components that accomplishes several key goals:
- Minimize boilerplate
- Provide a simplified way to handle common application tasks without a bloated API
- Handle all stream plumbing between components automatically
- Support arbitrarily complex applications with deep component hierarchies
- Reuse the best patterns from popular frameworks like React and Vue while avoiding the pitfalls
- Support pure Javascript, Typescript (in progress), and JSX
- Provide state out of the box, and make it easy to use
- Provide meaningful debugging information
- Work with modern bundlers like Vite, and provide easy application bootstrapping


## In a Nutshell...

Sygnal is easiest to understand by example, so let's walk through some now.


### Installation

To install Sygnal, just use your favorite package manager to grab the `sygnal` package

```bash
npm install sygnal
```

> NOTE:
> To use JSX like in the examples below, you'll need to use a bundler like Vite or Rollup, and configure it to use Sygnal's JSX functions. For Vite, add the following to your vite.config.js file:
> ```javascript
>  esbuild: {
>    jsxFactory: `jsx`,
>    jsxInject: `import { jsx } from 'sygnal/jsx'`
>  },
> ```
> You can use Sygnal without JSX, but will need to replace the HTML with vDom functions:
> `<div>Hello</div>` becomes `h('div', 'Hello')`
>
> Import `h()` from the sygnal package with `import { h } from 'sygnal'`

### React Style Functional Components

If you're coming from React, Sygnal components will feel familiar.  Just as with React Functional Components, Sygnal components begin with a function which defines the component's view (what HTML elements are rendered).

The simplest Sygnal component is just a function that returns JSX or vDom:

```javascript
// Hello World Component
function MyComponent() {
  return (
    <div>Hello World</div>
  )
}
```

### View Parameters

Also similar to React, the main function of a component will receive any props and children set on it.  But in Sygnal, you also get additional values for the state, context, and any Peer component vDom (we will cover the last two items a bit later).

> In a Sygnal application, props can still play an important role, but the state is where most of the magic happens.  In general you should think of props as how to configure a component, and use state for everything else.

To access any of these values, simply use destructuring in the function arguments:

```javascript
// getting the state, props, and children in a Sygnal component's main function
// (there are also 'context' and named items for Peer components, but we'll cover those later)
function MyComponent({ state, props, children }) {
  return (
    <div className={ props.className }>
      <h1>{ state.title }</h1>
      { children }
    </div>
  )
}

// ...and using it in another component
function RootComponent() {
  return (
    <div>
      <MyComponent className="some-class">
        <span>Here's a child</span>
        <span>Here's another child</span>
      </MyComponent>
    </div>
  )
}
```


### Root Component (Starting a Sygnal Application)

Just like with React and other popular frameworks, Sygnal applications start with a root level component which is passed to Sygnal's run() function:

To start an application using the components above, just import run() from Sygnal, and pass RootComponent to it:

```javascript
import {run} from 'sygnal'

// this will attach RootComponent to an HTML element with the id of "root"
run(RootComponent)

// to attach to a different element, use the mountPoint option:
run(RootComponent, {}, { mountPoint: '#css-selector' })
```


### State (The Basics)

Every Sygnal application is provided with state which is automatically passed to every component in the hierarchy.

We'll talk about how to change state, and control the state passed to sub components in a bit, but first we need to set the initial state on the root component.

The easiest way to set the initial state is to augment the main component function with an .initialState property:

```javascript
function RootComponent({ state }) {
  return (
    <div>Hello { state.name }!</div>
  )
}

// this will set the initial state with a 'name' property
// so the component above will render 'Hello World!'
RootComponent.initialState = {
  name: 'World'
}
```

> Notice that .initialState is added directly to the RootComponent function. In Sygnal, we use this form of function object augmentation to add all configuration to components


### Drivers

Sygnal components should always be pure, meaning they should never produce side effects or attempt to maintain their own state.  In practice, this means any time a component needs to 'do' anything, from changing the state, making a network call, or anything else, the component doesn't do it internally, but sends a signal to one or more drivers which take care of actually performing the action.

But in order for components to decide what to do, they need to know what's happening around them. Drivers take care of that as well.

Drivers in a Sygnal application act as both a 'source' and a 'sink'. They provide information to components through their 'source' objects, and get commands from components to do things in their 'sink'.

Some drivers only provide sources, and others only accept sinks, but most are both sources *and* sinks. And for most applications, the drivers you'll be using the most are the `STATE` and `DOM` drivers, both of which are included automatically in all Sygnal applications.

Here's a simple component that uses the DOM driver source, and STATE driver sink to display a count and increment it whenever the button is pressed:

```javascript
// View: How the component is displayed
function RootComponent({ state }) {
  return (
    <div>
      <span>{ state.count }</span>
      <button type="button" className="increment-button" />
    </div>
  )
}

RootComponent.initialState = {
  count: 0
}

// Intent: WHEN things should happen
RootComponent.intent = ({ DOM }) => {
  return {
    // this is an 'action', and is triggered whenever the button is clicked
    // DOM here is a driver 'source', and tells you what's happening in the browser DOM
    INCREMENT: DOM.select('.increment-button').events('click')
  }
}

// Model: WHAT things can/should happen, and what drivers to use to do it
RootComponent.model = {
  // this is the same 'action' as above, and runs whenever 
  // the action above is triggered
  INCREMENT: {
    // this is a STATE 'sink'
    // the function is a 'reducer' and takes the current state
    // and must return what the new state should be
    STATE: (state) => {
      return { count: state.count + 1 }
    }
  }
}
```

There are a couple of new features and concepts introduced here, so we'll go through them one at a time.


### Model View Intent (MVI) Architecture

Sygnal, being based on Cycle.js, uses the Model View Intent (MVI) philosophy. This approach breaks application logic into the three pieces it gets its name from, and those can be described as:
- **Model**: What the component can do. This piece doesn't actually perform any actions, but instead encodes instructions to send to an appropriate driver when a particular action is to be done.
- **Intent**: When the component should do something. This piece looks at incoming signals from driver 'sources', and determines when specific actions should be kicked off.
- **View**: Exaclty as it sounds, this is how the component should be displayed, and is handled by the main component function.

An easy way to think about this is the Model tells you **what** a component does, the Intent tells you **when** a component does something, and the View tells you **where** everything is displayed. Finally, outside of the component itself, drivers define **how** anything is done.


### The .intent Property

Looking at the example component above, the first new thing we've introduced is the .intent property on RootComponent. Like was said in the last section, this is where we use signals we get
from driver 'sources' to determine when to perform an 'action'.

In Sygnal, an 'action' is simply a name you give to anything you want the component to do. You can make your action names as descriptive as you like, and they can be any valid javascript property name.

The .intent property is always a function, and gets one argument containing all drivers available to the component. This function should return an object with 'action' names as properties, and an 'Observable' that fires when that action should run as the value (don't worry if you're not familiar or are uncomfortable with Observables, Sygnal minimizes the complexity, and we'll cover what you need to know below).

> By default all Sygnal applications get STATE, DOM, EVENTS, and LOG drivers. In addition there are props$, children$, context$, and CHILD pseudo-drivers that are useful in more advanced cases.

In the example component above, we get the DOM driver source using destructuring, and we return an action list object showing that the INCREMENT action should run whenever an HTML element
with a class name of '.increment-button' is clicked.

> The DOM driver's `.select()` method takes any valid CSS selector, and will find any HTML elements in the component's view that match it.
> The selector is 'isolated' to the current component, and will not match anything outside of the component itself, so there's no need to go crazy with your class names.
>
> Once you've used `DOM.select()`, you can then use `.events()` to pick an event to listen to. The result is an 'Observable' that fires (emitting a DOM event object) whenever the event happens.

You'll notice that we don't say anything here about what should actually happen when the INCREMENT action is triggered. All we care about in the intent function is **when** the action happens. 

This `.intent` function 
```javascript
RootComponent.intent = ({ DOM }) => {
  return {
    INCREMENT: DOM.select('.increment-button').events('click')
  }
}
```
can be read as: `Run the INCREMENT action whenever a DOM element with a class of .increment-button is clicked`

> A key difference you should pay attention to already is that in Sygnal you **never** define event handlers of any kind in the HTML. Any and all DOM events (or any other events for that matter) will always be defined in the .intent function using the DOM driver source.
> This is a defining feature of functional reactive programming where the view shouldn't need to know about anything except the current state, and shouldn't 'do' anything except display things to the user.


### The .model Property

Now that we've created an `INCREMENT` action and determined when it should run, next we need to tell our component what to do when that action happens. That's where the `.model` property comes in!

```javascript
RootComponent.model = {
  INCREMENT: {
    STATE: (state) => {
      return { count: state.count + 1 }
    }
  }
}
```

The `.model` property is just an object with entries for each `action`. There should be one `action` entry for every `action` defined in `.intent`.

Each `action` entry then gets set with an object listing each `driver` that will be used for that `action`, along with what should be sent to that driver to tell it what to do.

In this case we're updating the state, so we use the `STATE` driver, and send it a 'reducer' function to tell the `STATE` driver how to update the state. The reducer function gets the current state, and should return what the new state should be after the action is completed.

> It may seem unintuitive to use a 'reducer' function to set the state... why not just update it directly!?
>
> This is how we keep components 'pure'. By delegating even the simple task of updating the `count` state to the `STATE` driver, we guarantee that the component itself has absolutely no side effects, and can be recreated or rerendered at any time without causing unintended concequences in our application.
>
> React handles these situations through hooks like `useState()` or `useEffect()`, but Sygnal takes it even further by enforcing that ALL side effects happen in drivers, which significantly reduces the types of bugs you run into in writing components.

Updating state is such a common task in Sygnal applications that there's a shorthand way of doing it... if you provide a reducer function directly after the `action` name, Sygnal will assume you are sending it to the `STATE` driver. So you can rewrite our `.model` as:

```javascript
RootComponent.model = {
  // reducer functions passed to an action name will automatically be sent to the STATE driver
  INCREMENT: (state) => {
    return { count: state.count + 1 }
  }

  // you can make this even shorter using the shortened arrow function object return syntax like:
  // INCREMENT: (state) => ({ count: state.count + 1 })
}
```

> The overly clever among you may notice that we never return anything to the DOM driver sink. Sygnal assumes that anything returned by the main component function is going to DOM, and handles it automatically. You should never send anything to the DOM driver sink through an action. Just update the state, and use that in the main component function to change what's rendered.


### Observables

Sygnal (and Cycle.js) are functional reactive style frameworks, and are powered at the core by 'Observables'.

There are many descriptions and explanations of Oservables out there, but the simplest one is just that they are like Promises that can fire/resolve more than once.

For example, where with a Promise like: `somePromise.then(value => console.log(value))` the `.then()` will only ever run once. With an Observable like: `someObservable.map(value => console.log(value))` the `.map()` can run over and over again.

Observables are a deep topic, and bring a lot of powerful abilities to programming, but for the purposes of writing Sygnal components, because Sygnal (and Cycle.js) handle all of the complexities for you behind the scenes, just thinking of them as "Promises that fire many times" is good enough to get us going. 

> You'll also hear Observables referred to as 'streams', which is another good way to think of them, but for anyone whose worked with Node.js streams before, that term might cause PTSD. Observables are much easier to work with than traditional streams, and never have the same problems like back-pressure to deal with.

Tying it back into our example from above, in the `.intent` function we got the button click events using:

```javascript
DOM.select('.increment-button').events('click')
```

This will result in an Observable that fires every time the button is clicked. You might think, "That's great, but you don't look like you're doing anything when it fires!". Good observation! We don't do anything here because we pass this Observable back to Sygnal, and it will take care of watching our Observable, and doing things when needed. The only thing you'll ever need to get good at to build Sygnal components is 'finding' or 'composing' the Observables to pass to `actions`, and in most cases that's done with a simple call to one of the driver source objects like we did with DOM.

> If you follow the evolution of Javascript frameworks, then you've almost certainly heard about Observables, RxJS, or more recently Signals being incorporated more and more into popular frameworks. These concepts can be very confusing, and as powerful as they are, a common view is that using them can increase learning curves and make debugging harder. There is truth to that, but Sygnal does most of the heavy lifting for you, and adds easy to understand and actionable debug logs and error messages to keep the pain as small as possible.
>
> Sygnal uses an Observable library called [xstream](https://github.com/staltz/xstream "xstream GitHub page") which was written by the same team that created Cycle.js, and is specifically tailored to work well with components, and is extremely small and fast. We may add support for other Observable libraries like RxJS, most.js, or Bacon in the future, but unless you have a specific need for those other libraries, xtream is almost always the best choice anyways.


## More About State

### Monolithic State

Sygnal applications use a monolithic combined state for the entire application. Components do not get independent state. In React, this is similar to how Redux works, but to anyone who just cringed a bit, Sygnal makes this ridiculously easy.  There's no painful setup or boilerplate involved, the only added complication over storing state in your components is keeping track of the application state tree... which you should be doing anyways.

A huge benefit of using monolithic state is that things like adding 'undo' features, or re-initializing the application after a page reload become trivial to implement: just update the state to the previous value, and all components will fall in line correctly.


### Managing Subcomponent State

By default all components get the entire application state, but this is usually not what you want. First, it can cause you to 'mine' for the right state using statements like:

```javascript
// it would be a pain in the butt to have to do something like this everywhere...
const valueImLookingFor = state.items[index].otherProperty[index2].item.value
```
And second, it would be difficult to create reusable components if every component had to know the shape of your entire application state to work.

Sygnal solves this problem by letting you specify what part of the state tree to pass to each component. In the simplest case this is just a property on the state, and can be done by setting the 'state' property on the component to the state property name when you add it to the parent component's view:

```javascript
// assuming the application state looks like
// { someStateProperty: 'Hi There!' }
// you can limit MyComponent's state to someStateProperty (becomes the 'root' state for the component) like this
function RootComponent() {
  return (
    <div>
      <MyComponent state="someStateProperty" />
    </div>
  )
}
```

In this example, anytime you access the `state` within MyComponent, it will be whatever the value of `someStateProperty` is on the application state.  
And if you update the state in one of the component's `actions` in `.model`, it will update the value of `someStateProperty` as if it was the root state:

```javascript
// When SOME_ACTION is triggered inside MyComponent
// the value of someStateProperty will be updated in
// the RootComponent's state
MyComponent.model = {
  SOME_ACTION: (state) => 'See you later!'
}
```

> NOTE: If you specify a name that doesn't exist on the current state, it will just get added to the state if/when the component updates it's state.


### Managing Subcomponent State (Advanced)

In the majority of cases, either inheriting the parent component's state, or choosing a property on the current state to pass on will work great.
For more advanced cases, Sygnal provides two useful features to help:
- `.context`
- State Lenses


Adding a `.context` property to a component allows you to set values that should be passed to ALL subcomponents belonging to it, 
regardless of how deep they are in the hierarchy.  These values are exposed on the `context` view parameter, and in the `extras` of any `action` reducer (the 4th argument):

```javascript
// This will set a 'someContext' context value on all subcomponents 
// of RootComponent even if they are deeply nested
RootComponent.context = {
  someContext: (state) => state.someStateProperty + ' Nice to meet you!'
}

function MyComponent({ state, context }) {
  // this will return 'Hi There! Nice to meet you!' as long as MyComponent is
  // somewhere in the subcomponent tree of RootComponent
  return (
    <div>{ context.someContext }</div>
  )
}

MyComponent.model = {
  SOME_ACTION: {
    LOG: (state, data, next, extra) => {
      // the 4th argument of any reducer in an action contains: context, props, and children
      // since we're using the LOG driver sink's reducer, this will print 'Hi There! Nice to meet you!'
      // to the browser console whenever the SOME_ACTION action is triggered
      return extra.context.someContext
    }
  }
}
```


Another option you can provide to the `state` property of a component is a State Lense.
A State Lense is just a simple Javascript object with `get` and `set` functions to tell Sygnal how to get the state for the component and set the state back on the parent when this component updates it's own state:

```javascript
const sampleLense = {
  get: (state) => {
    // state here is the parent component's state
    // just return whatever you want the subcomponent's state to be
    return {
      someField: state.someField
      otherField: state.otherField
    }
  },
  set: (parentState, newSubcomponentState) => {
    // use the newSubcomponentState to calculate and return what the
    // new parentState should be after the subcomponent updates
    return {
      ...parentState,
      someField: newSubcomponentState.someField
      otherField: newSubcomponentState.otherField
    }
  }
}

// use the lense by setting the state property to it when you use a component
function RootComponent() {
  return (
    <MyComponent state={ sampleLense } />
  )
}
```

> NOTE: State Lenses give you maximum flexibility to handle how state flows from parent to child components, but are rarely actually needed,
> and can be difficult to debug. If you find yourself reaching to State Lenses often, there's probably an easier way to do what you want 
> using normal Sygnal features



### Realistic State Updates

The examples above are great for getting a basic understanding of state in Sygnal, but in the real world `actions` need more information than is
already in the state to do their job properly. So let's talk about how to feed that data to actions, and access it in reducers.

We've already dicussed Observables, and how they fire whenever their associated events happen, but one thing we glossed over is that those Observables
can also provide data when they fire (just like Promises).

For instance, in the button click example from above, the Observable created with `DOM.select('.increment-button').events('click')` will return a
DOM click event every time it fires. As it stands, because we haven't done anything to it, that DOM click event will be sent 'as is' to the second argument 
of any reducers triggered by `actions` we pass the Observable to.

So if we change the code to:

```javascript
function RootComponent() {
  return <button className="increment-button" data-greeting="Hello!" />
}

RootComponent.intent = ({ DOM }) => {
  return {
    INCREMENT: DOM.select('.increment-button').events('click')
  }
}

RootComponent.model = {
  INCREMENT: {
    LOG: (state, data) => {
      return data
    }
  }
}
```

The DOM click event will be logged to the browser console.

There are two very useful Observable methods we can use to change this default behavior. The first is `.mapTo()`, which exactly how it sounds,
maps the value returned from an Observable to the value you designate, so `DOM.select('.increment-button').events('click').mapTo('CLICK!')`
causes our component to log 'CLICK!' to the browser console instead of the DOM click event like before.

The other useful Observable method is `.map()`, which instead of just always returning the same value, allows us to 'mutate' the current value
before it gets sent on. Say we needed to get the `data-greeting` property from the button that was clicked. We can do that like:

```javascript
DOM.select('.increment-button').events('click').map(event => event.target.dataset['greeting'])
```

If we use this for the INCREMENT action in the component .intent, then 'Hello!' will get logged to the browser console whenever the button is clicked.


### Do Multiple Things For One Action

In some cases you'll need to do more than one thing when a single 'action' is triggered. Sygnal provides a couple of tools to help with that.

In the case that you want to do multiple separate things with different drivers, you can simply add extra entries for each driver in the action
object:

```javascript
// This will both update the count in the state,
// and print 'Updating count' to the browser console
// whenever SOME_ACTION is triggered
MyComponent.model = {
  SOME_ACTION: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    LOG: (state) => 'Updating count'
  }
}
```

In other cases, you might want to tigger other actions to happen based on certain conditions. For that, Sygnal provides a `next()` function as
the 3rd argument to all 'reducer' functions which can be used to manually trigger any other action in your component:

```javascript
// When SOME_ACTION is triggered...
// If 'logIt' on the state is true, then the next() function triggers
// the ANOTHER_ACTION action to be run with the 'data' set to 'Log Me!'
// since that action uses the LOG driver sink, and passes 'data',
// 'Log Me!' will be printed to the browser console
MyComponent.model = {
  SOME_ACTION: (state, data, next) => {
    if (state.logIt === true) next('ANOTHER_ACTION', 'Log Me!')
    return { ...state, itGotLogged: true }
  },
  ANOTHER_ACTION: {
    LOG: (state, data) => data
    // setting any driver sink entry to 'true' will cause anything in data
    // to be passed on directly, so the following is exactly the same
    // LOG: true
  }
}
```


## Common Tasks Made Easy

There are a few things that almost any application will have that can be challenging for people new to functional reactive programming to do.
To keep you from pulling your hair out, and even make these tasks look easy, Sygnal provides several features and helpers.

### Collections of Components

Pretty much any application will at some point will have lists, arrays, or some other place where many of the same component is shown,
and may even need to dynamically change the list size, filter what's shown, or sort items on some criteria.
For this, Sygnal provides a built-in `<collection>` element that takes a provided component and an array on your state
and handles everything else for you.

In this example, a new ListItemComponent will be created for each item in the `list` state property. It will be filtered to only show items
where showMe is true, and will be sorted by name.

Each instance created will have it's associated item as its state, and if it updates state, the item in the list will get updated properly as well.
An item can even delete itself by setting its own state to 'undefined', in which case it will be automatically removed from the array on state.

```javascript
function RootComponent({ state }) {
  return (
    <div>
      <collection of={ ListItemComponent } from="list" filter={ item => item.showMe === true } sort="name" />
    </div>
  )
}

RootComponent.initialState = {
  list: [
    { name: 'Bob', showMe: true },
    { name: 'Sarah', showMe: true },
    { name: 'David', showMe: true },
    { name: 'Joe', showMe: false }
  ]
}

function ListItemComponent({ state }) => {
  return <div>{ state.name }</div>
}
```
> NOTE: notice `collection` is lower case. This is to avoid problems with JSX conversion.


### Switchable Components

Another common use case is to show different content based on some criteria, like changing things when a different tab is clicked.
For this, Sygnal provides a built-in `<switchable>` element that takes an object mapping names to components, and the name of the 
component to show now.

In this example, clicking the buttons will switch back and forth between showing FirstComponent or SecondComponent by changing
the value of the `whichItemToShow` state.

```javascript
function RootComponent({ state }) {
  return (
    <div>
      <button className="show-item1">Item 1</button>
      <button className="show-item2">Item 2</button>
      <switchable of={ item1: FirstComponent, item2: SecondComponent } current={ state.whichItemToShow } />
    </div>
  )
}

RootComponent.intent = ({ DOM }) => {
  const item1$ = DOM.select('.show-item1').events('click').mapTo('item1')
  const item2$ = DOM.select('.show-item2').events('click').mapTo('item2')

  return {
    // xs.merge() is an Observable function that merges multiple Observables together
    // the result is a new Observable that fires whenever any of the original ones do
    // and forwards the data on. xs can be imported from sygnal.
    SET_ITEM: xs.merge(item1$, item2$)
  }
}

RootComponent.model = {
  SET_ITEM: (state, data) => ({ ...state, whichItemToShow: data })
}
```


### The processForm() Function

Another very common task in web pages and browser applications is to work with form inputs.  Unfortunately, the logic and stream plumbing required to do this routine task can be challenging to developers new to observables (and is frustrating even for most veterans).  Sygnal's processForm() helper function takes any HTML form element, and automatically extracts the values from all input fields contained within it.  By default processForm() listens to both 'input' and 'submit' events, but can be configured to listen to any combination of standard or custom events on the form itself or its inputs.

The Observable from `processForm` always returns objects with the current value of every field in the form along with the name of the JS event that initiated it, so the following will print something like:

```javascript
{
  'first-name': 'Bob',
  'last-name': 'Smith',
  eventType: 'submit'
}
```

```javascript
import { processForm } from 'sygnal'

function MyComponent({ state }) {
  return (
    <form className="my-form">
      <input name="first-name" />
      <input name="last-name" />
      <button type="submit">Submit</button>
    </form>
  )
}

MyComponent.intent = ({ DOM }) => {
  const submit$ = processForm(DOM.select('.my-form'), { events: 'submit' })
  
  return {
    HANDLE_FORM: submit$
  }
}

MyComponent.model = {
  HANDLE_FORM: {
    LOG: (state, data) => data
  }
}
```


## Prerequisites / Using a Starter Template

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
npm run preview
```

Alternatively, you can use any other bundler of your choice (Webpack, Babel, Rollup, etc.).  To use JSX in your components while using alternative bundlers, you will need to configure your bundler to use Sygnal's JSX pragma. This is slightly different for each bundler, but looks generally like:

```javascript
// this example is for Vite or esbuild, but most bundlers have options similar to this for handling JSX transpiling
{
  ...,
  esbuild: {
    // add the import for Sygnal's JSX and Fragment handler to the top of each .jsx and .tsx page automatically
    jsxInject: `import { jsx, Fragment } from 'sygnal/jsx'`,
    // tell the transpiler to use Sygnal's 'jsx' funtion to render JSX elements
    jsxFactory: `jsx`,
    // tell the transpiler to use Sygnal's 'Fragment' funtion to render JSX fragments (<>...</>)
    jsxFragment: 'Fragment'
  },
}
```

NOTE: Some minifiers will cause JSX fragments to fail by renaming the Fragment pragma function. This can be fixed by preventing renaming of 'Fragment'. For Vite this is done by installing terser, and adding the following to your vite.config.js file:

```javascript
{
  ...,
  build: {
    minify: 'terser',
    terserOptions: {
      mangle: {
        reserved: ['Fragment'],
      },
    }
  },
}
```

## More Examples

### Two Way Binding

```javascript
function TwoWay({ state }) {
  return (
    <div>
      <h1>Hello { state.name }</h1>
      {/* set the 'value' of the input to the current state */}
      <input className="name" value={ state.name } />
    </div>
  )
}

TwoWay.initialState = { name: 'World!' }

TwoWay.intent = ({ DOM }) => {
  return {
    // select the input DOM element using it's class name
    // then map changes to the value ('input' event) to extract the value
    // that value will then be passed to the 2nd parameter of reducers in 'model'
    CHANGE_NAME: DOM.select('.name').events('input').map(e => e.target.value)
  }
}

TwoWay.model = {
  // update the name in the state whenever the 'CHANGE_NAME' action is triggered
  // this time we use the 2nd parameter of the reducer function which gets the value passed
  // by the stream that triggered the action
  CHANGE_NAME: (state, data) => {
    return { name: data }
  }
}
```


### Multiple Actions

```javascript
// import the xtream observable library so we can do some stream operations
import { xs } from 'sygnal'

function Counter({ state }) {
  return (
    <div>
      <h1>Current Count: { state.count }</h1>
      <input type="button" className="increment" value="+" />
      <input type="button" className="decrement" value="-" />
      <input className="number" value={ state.count } />
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => {
  // rather than pass Observables directly to the actions, it is sometimes helpful
  // to collect them in variables first
  // it is convention (but not required) to name variables containing Observables with a trailing '$'
  // the 'mapTo' function causes the Observable to emit the specified value whenever the stream fires
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
}

Counter.model = {
  // add the value passed from the stream that triggered the action to the current count
  // this will either be 1 or -1, so will increment or decrement the count accordingly
  INCREMENT: (state, data) => ({ count: state.count + data }),
  SET_COUNT: (state, data) => ({ count: parseInt(data || 0) })
}
```



## More Documentation To Come...

Sygnal is the result of several years of building Cycle.js apps, and our attempts to make that process more enjoyable.  It has been used for moderate scale production applications, and we are making it available to the world in the hopes it is useful.

Until better documentation is available, here are some well-commented projects using most of Sygnal's features:
- Sygnal ToDoMVC ( [GitHub](https://github.com/tpresley/sygnal-todomvc) | [Live Demo](https://tpresley.github.io/sygnal-todomvc/) ) - The [ToDoMVC](https://todomvc.com/) framework comparison app implemented in Sygnal
- Sygnal 2048 ( [GitHub](https://github.com/tpresley/sygnal-2048) | [Live Demo](https://tpresley.github.io/sygnal-2048/) ) - The [2048 Game](https://github.com/gabrielecirulli/2048 "Original 2048 GitHub repo") implemeted in Sygnal
- Sygnal Calculator ( [GitHub](https://github.com/tpresley/sygnal-calculator) | [Live Demo](https://tpresley.github.io/sygnal-calculator/) ) - A simple calculator implemeted in Sygnal
