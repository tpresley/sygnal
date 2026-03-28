#!/usr/bin/env node

import * as p from '@clack/prompts'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

const TEMPLATES = {
  vite: {
    label: 'Vite (SPA)',
    hint: 'Single-page app with Vite + HMR',
  },
  vike: {
    label: 'Vike (SSR)',
    hint: 'File-based routing with SSR, layouts, and data fetching',
  },
  astro: {
    label: 'Astro',
    hint: 'Content-focused site with island hydration',
  },
}

function parseArgs(argv) {
  const args = { positional: null }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--template' || arg === '-t') {
      args.template = argv[++i]
    } else if (arg.startsWith('--template=')) {
      args.template = arg.slice('--template='.length)
    } else if (arg === '--typescript' || arg === '--ts') {
      args.language = 'ts'
    } else if (arg === '--javascript' || arg === '--js') {
      args.language = 'js'
    } else if (arg === '--no-install') {
      args.install = false
    } else if (arg === '--install') {
      args.install = true
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (!arg.startsWith('-')) {
      args.positional = arg
    }
  }
  return args
}

function printHelp() {
  console.log(`
Usage: create-sygnal-app [project-name] [options]

Options:
  -t, --template <name>  Template to use: vite, vike, astro
      --ts, --typescript  Use TypeScript
      --js, --javascript  Use JavaScript
      --install           Install dependencies (default)
      --no-install        Skip installing dependencies
  -h, --help             Show this help message

Examples:
  create-sygnal-app my-app --template vite --ts
  create-sygnal-app my-app -t vike --no-install
  npx create-sygnal-app my-app --template astro --js
`.trim())
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  // Validate --template value if provided
  if (args.template && !TEMPLATES[args.template]) {
    console.error(`Unknown template: "${args.template}". Available templates: ${Object.keys(TEMPLATES).join(', ')}`)
    process.exit(1)
  }

  const interactive = !args.template || !args.language

  if (interactive) {
    p.intro('Create Sygnal App')
  }

  // Project name — use positional arg or prompt
  const projectName = args.positional || await p.text({
    message: 'Project name:',
    placeholder: 'my-sygnal-app',
    defaultValue: 'my-sygnal-app',
    validate(value) {
      if (!value) return 'Project name is required'
      if (/[^\w\-.]/.test(value)) return 'Project name can only contain letters, numbers, hyphens, dots, and underscores'
    },
  })

  if (p.isCancel(projectName)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // Template — use flag or prompt
  const template = args.template || await p.select({
    message: 'Template:',
    options: Object.entries(TEMPLATES).map(([value, { label, hint }]) => ({
      value,
      label,
      hint,
    })),
  })

  if (p.isCancel(template)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // Language — use flag or prompt
  const language = args.language || await p.select({
    message: 'Language:',
    options: [
      { value: 'js', label: 'JavaScript' },
      { value: 'ts', label: 'TypeScript' },
    ],
  })

  if (p.isCancel(language)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  // Install — use flag or prompt
  const installDeps = args.install ?? await p.confirm({
    message: 'Install dependencies?',
    initialValue: true,
  })

  if (p.isCancel(installDeps)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  const targetDir = resolve(process.cwd(), projectName)

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    const msg = `Directory "${projectName}" already exists and is not empty.`
    if (interactive) {
      p.cancel(msg)
    } else {
      console.error(msg)
    }
    process.exit(1)
  }

  const s = interactive ? p.spinner() : null

  // Copy template
  if (s) s.start('Scaffolding project...')
  const templateName = language === 'ts' ? `template-${template}-ts` : `template-${template}`
  const templateDir = join(__dirname, templateName)
  copyDir(templateDir, targetDir)

  // Update package.json name
  const pkgPath = join(targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.name = basename(projectName)
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
  if (s) s.stop('Project scaffolded.')
  else console.log(`Scaffolded ${templateName} into ${projectName}`)

  // Install
  if (installDeps) {
    if (s) s.start('Installing dependencies...')
    else console.log('Installing dependencies...')
    try {
      execSync('npm install', { cwd: targetDir, stdio: 'ignore' })
      if (s) s.stop('Dependencies installed.')
      else console.log('Dependencies installed.')
    } catch {
      const msg = 'Failed to install dependencies. Run `npm install` manually.'
      if (s) s.stop(msg)
      else console.error(msg)
    }
  }

  // Done
  const relative = targetDir === process.cwd() ? '.' : projectName

  if (interactive) {
    p.note([
      `cd ${relative}`,
      'npm run dev',
    ].join('\n'), 'Next steps')

    p.outro('Happy building!')
  } else {
    console.log(`\nDone. Run:\n  cd ${relative}\n  npm run dev`)
  }
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      writeFileSync(destPath, readFileSync(srcPath))
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
