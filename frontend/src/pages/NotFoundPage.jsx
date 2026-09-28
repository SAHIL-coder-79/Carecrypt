import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="text-sm text-teal-800 hover:underline">
        Go to the start page
      </Link>
    </div>
  )
}
