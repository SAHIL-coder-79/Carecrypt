import { useState } from 'react'
import { Segmented } from '../../components/analytics/common.jsx'
import { CheckCircleIcon } from '../../components/icons.jsx'
import EventItem from '../../components/security/EventItem.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Card, EmptyState, LoadingState, PageHeader } from '../../components/ui.jsx'
import { useApiData } from '../../lib/useApiData.js'

// Security events: suspected inference on analytics, staff attempts to open
// patient data, locked accounts. Open events can be resolved with a note.
export default function SecurityEventsPage() {
  const [status, setStatus] = useState('OPEN')
  const events = useApiData(`/api/security/events?status=${status}`)

  return (
    <div>
      <PageHeader
        eyebrow="Security events"
        title="Security events"
        description="Findings raised automatically by the server. Resolving an inference event lets that administrator ask custom analytics questions again."
      />
      {events.error ? (
        <ServerRefusal error={events.error} title="The security console is for security administrators" />
      ) : (
        <Card
          title={status === 'OPEN' ? 'Open events' : status === 'RESOLVED' ? 'Resolved events' : 'All events'}
          action={
            <Segmented
              label="Event status"
              value={status}
              onChange={setStatus}
              options={[
                ['OPEN', 'Open'],
                ['RESOLVED', 'Resolved'],
                ['ALL', 'All'],
              ]}
            />
          }
        >
          {!events.data ? (
            <LoadingState rows={2} />
          ) : events.data.events.length === 0 ? (
            <EmptyState icon={CheckCircleIcon} title={status === 'OPEN' ? 'No open security events' : 'No events'} />
          ) : (
            <ul className="space-y-3">
              {events.data.events.map((e) => (
                <EventItem key={e.id} event={e} onResolved={events.reload} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
