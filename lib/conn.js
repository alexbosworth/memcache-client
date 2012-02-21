var net = require('net'),
    Queue = require('./queue');

// Connection
// ----------
//
// The memcache client keeps open connections to all servers in the cluster. A connection object manages all 
function Connection(server) {
  var hostElems = server.split(':');
  this.host = hostElems[0] || 'localhost';
  this.port = hostElems[1] || '11211';
  this.buffer = undefined;
  this.queue = new Queue(); // Request Queue
  this.sock = undefined;   // Our socket to the server.
  this.retry = true;      // Should we reconnecton connection failure?
  this.backoff = 10;     // Backoff in micros
}

Connection.prototype.open = function(cb) {  
  var self = this;
  if (this.sock || !this.retry) return; // We do not want to try to connect.

  this.sock = net.connect(this.port, this.host, function () {
    // Connect listener: called on successful connect.      
    self.sock.setNoDelay(true);
    self.backoff = 10; // Reset backoff on success
    self.sock.addListener('data', function (data) {
      self.read(data);
    });

    // In case of a shutdown event.
    self.sock.addListener('close', function () {
      self.sock = undefined;
      self.flushQueue("CONNECTION_ERROR", 'Connection to Server terminated.');
      if (self.retry) { self.reconnect(); }
    });

    // Note on additional events:
    //   end     -- the server dropped the connect; our logic is handled by 'close'
    //   timeout -- we do not specify a timeout, there should be no timeout events emitted.
    //   data    -- registered elsewhere
    //   drain   -- not used.
    if (cb) cb();
  });      

  // Do not try to reconnect on errer: if it is on connection open, it will not be recoverable;
  // Otherwise, it will be followed by a connection close, which will handle the retry.
  this.sock.on('error', function(err) {
    self.sock = undefined;
    self.flushQueue("CONNECTION_ERRROR", err.code + ' : ' + err.message);
  });
};

// Our listeners should catch the dropped connection and reconnect.
Connection.prototype.restart = function() {
  this.sock.end();
  this.sock = null;
};

Connection.prototype.reconnect = function () {
  if (this.backoff < 128000) {
    this.backoff *= 2;
  }
  var self = this;
  setTimeout(function () {
    self.connect();
  }, this.backoff);
};

Connection.prototype.close = function () {
  this.retry = false;
  if (this.sock) {
    // See https://github.com/joyent/node/blob/master/lib/net.js
    switch (this.sock.readyState) {
    case 'opening':
      this.sock.addListener('connect', function () {
        this.sock.end();
        this.sock = null;
      });
      break;
    case 'open':
    case 'readOnly':
    case 'writeOnly':
      this.sock.end();
      this.sock = null;
      break;
    case 'closed':
      break;
    default:
    }
  }
};

Connection.prototype.flushQueue = function (code, message) {
  var lost = this.queue.dequeue();
  while (lost) {
    lost.callback({
      type: code,
      description: message
      }, null);
    lost = this.queue.dequeue();
  }
};

Connection.prototype.write = function (handler, callback, command, value) {
  // Lost our connection. Expect the error callback to be handled by error event, not here.
  if (!this.sock) {
    callback({ type: 'CONNECTION_ERROR', description: 'No Connection Available.'}, null);
    return;
  }
  try {
    this.sock.write(command + crlf);
    if (value) {
      this.sock.write(value + crlf);
    }
    this.queue.enqueue({ handler: handler, callback: callback });
  }
  catch (x) {
    callback({ type: 'CONNECTION_ERROR', description: 'Lost connection to server.' }, null);
  }
};

Client.prototype.read = function (data) {
  var buff = data;
  if (this.buffer && this.buffer.length > 0) { // We have pending data from server : merge
    buff = new Buffer(this.buffer.length + data.length);
    this.buffer.copy(buff);
    data.copy(buff, this.buffer.length);
  }
  this.buffer = buff;
  this.processBuffer();
};

function process_line(buffer, start) {
  var i = start || 0;
  var max = buffer.length - 1;
  while (i < max) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) {
      return {
        str: buffer.toString('utf8', start, i),
        next: i + 2
      };
    }
    i++;
  }
  return {
    str: null,
    next: -1
  };
}
// Migrate to connection.
Connection.prototype.processBuffer = function () {
  while (this.buffer.length > 0) {
    var dispatcher = this.queue.peek();
    if (!dispatcher) {
      // Something is seriously wrong! We are receiving data unexpectedly.
      this.restart();
    }
    var peekResponse = process_line(this.buffer);
    if (!peekResponse.str) { // No full line available. Need more data off the wire.
      break;
    }
    else if (peekResponse.str.substr(0, 5) === 'ERROR') {
      this.buffer = this.buffer.slice(peekResponse.next);
      this.queue.dequeue().callback({
        type: peekResponse.str,
        description: ''
      }, null);
    }
    else {
      var results = dispatcher.handler(peekResponse, this.buffer, this.adapter);

      if (results.bytes_parsed == -1) { // Do nothing. Need more data.
        break; // Wait for a new data event.
      } else {
        this.buffer = this.buffer.slice(results.bytes_parsed);
        this.queue.dequeue();
        dispatcher.callback(results.error, results.data);
      }
    }
  }
};
