import assert from 'node:assert/strict'
import test from 'node:test'
import { cn } from '../../src/design-system/lib/cn.ts'
import { buttonVariants } from '../../src/design-system/primitives/button.variants.ts'
import { badgeVariants } from '../../src/design-system/primitives/badge.variants.ts'

const BUTTON_VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const
const BUTTON_SIZES = ['sm', 'md', 'lg', 'icon'] as const
const BADGE_VARIANTS = ['neutral', 'info', 'success', 'warning', 'danger', 'outline'] as const

const classesOf = (value: string) => value.split(/\s+/).filter(Boolean)

test('cn resolves conflicts using the tw: prefix', () => {
  assert.equal(cn('tw:px-2', 'tw:px-4'), 'tw:px-4')
  assert.equal(cn('tw:bg-fs-primary', 'tw:bg-fs-danger'), 'tw:bg-fs-danger')
})

test('cn keeps FlowSuite font-size and text color tokens as different groups', () => {
  assert.deepEqual(classesOf(cn('tw:text-fs-sm', 'tw:text-fs-muted')).sort(), ['tw:text-fs-muted', 'tw:text-fs-sm'])
  assert.equal(cn('tw:text-fs-sm', 'tw:text-fs-lg'), 'tw:text-fs-lg')
})

test('every Button variant/size only emits tw:-prefixed classes (no collision with legacy CSS)', () => {
  for (const variant of BUTTON_VARIANTS) {
    for (const size of BUTTON_SIZES) {
      for (const cls of classesOf(buttonVariants({ variant, size }))) {
        assert.ok(cls.startsWith('tw:'), `${variant}/${size}: ${cls}`)
      }
    }
  }
})

test('every Badge variant only emits tw:-prefixed classes', () => {
  for (const variant of BADGE_VARIANTS) {
    for (const cls of classesOf(badgeVariants({ variant }))) {
      assert.ok(cls.startsWith('tw:'), `${variant}: ${cls}`)
    }
  }
})

test('variants use FlowSuite tokens instead of raw palette colors', () => {
  const all = [
    ...BUTTON_VARIANTS.map((variant) => buttonVariants({ variant })),
    ...BADGE_VARIANTS.map((variant) => badgeVariants({ variant })),
  ].join(' ')
  assert.doesNotMatch(all, /tw:(bg|text|border)-(red|blue|gray|slate|green|amber|emerald)-/)
  assert.doesNotMatch(all, /#[0-9a-f]{3,6}/i)
})

test('defaults: Button is default/md, Badge is neutral', () => {
  assert.equal(buttonVariants(), buttonVariants({ variant: 'default', size: 'md' }))
  assert.equal(badgeVariants(), badgeVariants({ variant: 'neutral' }))
})
