import EventItem from './EventItem';

function EventList({ events }) {
  if (events.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-gc-text-dim">
        <p className="text-lg">No events yet. Waiting for agent activity...</p>
        <p className="text-sm mt-2">Events will appear here in real-time</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gc-border">
      {events.map((event, index) => (
        <EventItem key={event.id || index} event={event} />
      ))}
    </div>
  );
}

export default EventList;
