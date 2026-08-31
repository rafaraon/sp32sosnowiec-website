import { Hono } from 'hono'
import type { Env, AdminUser } from '../types'
import { adminAuth, requireAdmin } from '../auth'

type Variables = { user: AdminUser }

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

adminRouter.use('*', adminAuth)

adminRouter.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ email: user.email, role: user.role })
})
