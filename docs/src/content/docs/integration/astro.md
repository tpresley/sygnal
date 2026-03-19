---
title: Astro
description: Using Sygnal with Astro
---

Sygnal includes a first-class Astro integration for using Sygnal components in Astro sites.

## Setup

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal()]
})
```

## Usage

Use Sygnal components in `.astro` files with client directives for hydration:

```astro
---
import Counter from '../components/Counter.jsx'
---

<Counter client:load />
<Counter client:visible />
<Counter client:idle />
```

## How It Works

- The server renders an empty placeholder
- The client-side code hydrates Sygnal components using `run()`
- Props passed in the Astro template are injected into the component
- Previous instances are cleaned up before rehydration
