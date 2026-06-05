const EventEmitter = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(20);

function emitOrderEvent(eventName, payload) {
  bus.emit(eventName, payload);
}

module.exports = { bus, emitOrderEvent };
