let wsMessageCount = 0;
let wsConnected = false;
let wsLastMessage = null;

let sseEndpoints = new Map();

export function trackWsMessage(type) {
  wsMessageCount++;
  wsLastMessage = { type, ts: Date.now() };
}

export function setWsConnected(connected) {
  wsConnected = connected;
}

export function getWsInfo() {
  return {
    connected: wsConnected,
    messageCount: wsMessageCount,
    lastMessage: wsLastMessage,
  };
}

export function trackSseEvent(endpoint) {
  const existing = sseEndpoints.get(endpoint) || { count: 0, lastMessage: null };
  existing.count++;
  existing.lastMessage = Date.now();
  sseEndpoints.set(endpoint, existing);
}

export function getSseInfo() {
  const result = {};
  sseEndpoints.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function resetWsTracking() {
  wsMessageCount = 0;
  wsConnected = false;
  wsLastMessage = null;
  sseEndpoints.clear();
}
