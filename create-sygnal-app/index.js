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

async function main() {
  p.intro('Create Sygnal App')

  // Project name — use CLI arg if provided
  const argName = process.argv[2]

  const projectName = argName || await p.text({
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

  const template = await p.select({
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

  const language = await p.select({
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

  const installDeps = await p.confirm({
    message: 'Install dependencies?',
    initialValue: true,
  })

  if (p.isCancel(installDeps)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  const targetDir = resolve(process.cwd(), projectName)

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    p.cancel(`Directory "${projectName}" already exists and is not empty.`)
    process.exit(1)
  }

  const s = p.spinner()

  // Copy template
  s.start('Scaffolding project...')
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
  s.stop('Project scaffolded.')

  // Install
  if (installDeps) {
    s.start('Installing dependencies...')
    try {
      execSync('npm install', { cwd: targetDir, stdio: 'ignore' })
      s.stop('Dependencies installed.')
    } catch {
      s.stop('Failed to install dependencies. Run `npm install` manually.')
    }
  }

  // Done
  const relative = targetDir === process.cwd() ? '.' : projectName

  p.note([
    `cd ${relative}`,
    'npm run dev',
  ].join('\n'), 'Next steps')

  p.outro('Happy building!')
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
