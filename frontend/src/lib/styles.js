// Class strings shared by components that cannot use the <Button> component
// (for example a react-router <NavLink> or a <label>).

const BUTTON = {
  base: 'inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-50',
  primary: 'bg-teal-700 text-white shadow-sm hover:bg-teal-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-700 text-white shadow-sm hover:bg-red-800',
  md: 'px-3.5 py-2 text-sm',
  sm: 'px-2.5 py-1.5 text-xs',
}

export function buttonClass(variant = 'primary', size = 'md', className = '') {
  return `${BUTTON.base} ${BUTTON[variant]} ${BUTTON[size]} ${className}`
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'
