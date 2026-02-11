export class EventStore {
  constructor(maxEvents = 10000) {
    this.events = [];
    this.maxEvents = maxEvents;
    this.listeners = [];
  }

  addEvent(event) {
    this.events.push(event);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify all listeners
    this.notifyListeners(event);
  }

  getRecentEvents(limit = 100) {
    return this.events.slice(-limit);
  }

  getEventCount() {
    return this.events.length;
  }

  getEventById(id) {
    return this.events.find(e => e.id === id);
  }

  getEventsByType(type) {
    return this.events.filter(e => e.type === type);
  }

  getEventsWithHighRisk(minScore = 7) {
    return this.events.filter(e => 
      e.safeguard && e.safeguard.riskScore >= minScore
    );
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  notifyListeners(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[EventStore] Listener error:', error);
      }
    });
  }

  clear() {
    this.events = [];
  }

  getStats() {
    const total = this.events.length;
    const withSafeguard = this.events.filter(e => e.safeguard).length;
    const highRisk = this.events.filter(e => e.safeguard?.riskScore >= 7).length;
    const blocked = this.events.filter(e => e.safeguard?.allowed === false).length;

    return {
      total,
      withSafeguard,
      highRisk,
      blocked,
      safetyRate: total > 0 ? ((total - highRisk) / total * 100).toFixed(1) : 100
    };
  }
}
