import type { ProjectStatusColor } from '@repo/types/project-settings'

/**
 * Status colours → the `--status-<key>` tokens (index.css, light + dark).
 * Written out in full so Tailwind sees each class.
 */
export const STATUS_DOT_CLASS: Record<ProjectStatusColor, string> = {
  grey: 'bg-status-grey',
  blue: 'bg-status-blue',
  amber: 'bg-status-amber',
  green: 'bg-status-green',
  violet: 'bg-status-violet',
  sky: 'bg-status-sky',
  emerald: 'bg-status-emerald',
  red: 'bg-status-red',
}
