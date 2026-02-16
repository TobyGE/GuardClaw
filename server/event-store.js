import fs from 'fs';
import path from 'path';

export class EventStore {
  constructor(maxEvents = 10000) {
    this.events = [];
    this.maxEvents = maxEvents;
    this.listeners = [];
    this.dataDir = path.join(process.cwd(), '.guardclaw');
    this.eventsFile = path.join(this.dataDir, 'events.json');
    
    // Load events from disk on startup
    this.loadEvents();
    
    // Auto-save every 30 seconds
    this.saveInterval = setInterval(() => this.saveEvents(), 30000);
  }

  addEvent(event) {
    this.events.push(event);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify all listeners
    this.notifyListeners(event);
    
    // Save immediately for important events (high risk or blocked)
    if (event.safeguard?.riskScore >= 7 || event.safeguard?.allowed === false) {
      this.saveEvents();
    }
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

  updateEvent(id, updates) {
    const event = this.events.find(e => e.id === id);
    if (event) {
      Object.assign(event, updates);
      this.notifyListeners(event);
      return true;
    }
    return false;
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
    this.saveEvents();
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

  loadEvents() {
    try {
      if (fs.existsSync(this.eventsFile)) {
        const data = fs.readFileSync(this.eventsFile, 'utf8');
        const parsed = JSON.parse(data);
        this.events = parsed.events || [];
        console.log(`[EventStore] Loaded ${this.events.length} events from disk`);
      } else {
        console.log('[EventStore] No existing events file, starting fresh');
      }
    } catch (error) {
      console.error('[EventStore] Failed to load events:', error.message);
      this.events = [];
    }
  }

  saveEvents() {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      // Save events to disk
      const data = {
        savedAt: new Date().toISOString(),
        count: this.events.length,
        events: this.events
      };
      fs.writeFileSync(this.eventsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[EventStore] Failed to save events:', error.message);
    }
  }

  shutdown() {
    // Save on shutdown
    this.saveEvents();
    clearInterval(this.saveInterval);
  }
}
