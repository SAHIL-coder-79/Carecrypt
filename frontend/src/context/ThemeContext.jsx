import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {},
  setThemeWithWipe: () => {},
})

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('carecrypt-theme') || 'light'
    }
    return 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('carecrypt-theme', theme)
  }, [theme])

  // Circular reveal wipe transition as demonstrated in the reference video:
  // export function setTheme(p: ThemePref, origin?: Element | null) {
  //   wipe({ origin, is: () => theme = p; applyTheme() })
  // }
  function setThemeWithWipe(newTheme, originElement) {
    if (typeof document === 'undefined' || !document.startViewTransition) {
      setTheme(newTheme)
      return
    }

    let x = window.innerWidth / 2
    let y = window.innerHeight / 2

    if (originElement && typeof originElement.getBoundingClientRect === 'function') {
      const rect = originElement.getBoundingClientRect()
      x = rect.left + rect.width / 2
      y = rect.top + rect.height / 2
    }

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    const transition = document.startViewTransition(() => {
      setTheme(newTheme)
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    })

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ]
      document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 620,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    })
  }

  const toggleTheme = (originElement) => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setThemeWithWipe(nextTheme, originElement)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeWithWipe }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
