import { z } from 'zod'
import { CATEGORIES } from './expenses.js'

// The new-expense form's rules. Field values arrive as the text the user typed; the
// parsed output has the amount as a number: { description, amount, category, date }.
export const AMOUNT_MESSAGE = 'Enter an amount greater than 0 and at most 10000.'

export const expenseSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Enter a description.')
    .max(80, 'Keep the description to 80 characters or fewer.'),
  amount: z
    .string()
    .trim()
    .refine((text) => /^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0 && Number(text) <= 10000, AMOUNT_MESSAGE)
    .transform(Number),
  category: z.string().refine((category) => CATEGORIES.includes(category), 'Choose a category.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD.'),
})

export const EMPTY_EXPENSE = { description: '', amount: '', category: '', date: '' }
