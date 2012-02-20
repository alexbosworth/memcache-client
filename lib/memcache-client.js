//    mc - the Memcache Client for Node
//    
//    Flexible support for application driven clustering and content types with no-hassle networking.

// The only dependency is a local queue implementation, and node.js's networking libary.
var net = require('net'),
    Queue = require('./queue');


// Strategy
// --------
//
// Strategies are used for associating keys with specific memcache servers across a cluster. Only a basic hashing
// strategy is provided with this implementation, with the expectation that most application developers will want
// to provide application specific strategies. A strategy is a function that takes two parameters: a string (key)
// and an integer representing the size of server cluster. This function should return an index into the cluster.
var Strategy = {};

// The hash strategy is a simple string reduction. Shorter keys will obviously be more performant here.
Strategy.hash = function(key, max) {  
  var hash = 0;
  var char;
  for (var i = 0; i < key.length; i++) {
    char = this.charCodeAt(i);
    hash = ((hash<<5)-hash)+char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash % max;
};

// In the case of a single memcache server, we optimize everything else away.
Strategy.solo = function() {
  return 0;
};

module.exports.Strategy = Strategy;

// Adapter
// -------
//
// Adapters are content processors for get calls. The philosophy here is that the application convenience is king
// and the application developer should have all the tools to make the application a clean, readable, performant,
// and correct expression. This library provides a small set of convenience adapters for the most common uses but
// the real intent for application developers to provide adapters for more typical industrial conditions such as,
// for example, compressed json structures.
//
// The adapter should take a results structure (defined below), and it should return a value that the application
// will expect.
var Adapter = {};

// The raw adapter adds a string 'val' property to the results structure. The results structure is:
//     { buffer: <a buffer object containing the value returned from the server>,
//       flags:  <the flags set on the object>,
//       size:   <the number of bytes in the buffer>,
//     }
Adapter.raw = function(results) {
  results.val = results.buffer.toString('utf8');
  return results;
};

// The json adapter assumes that the value is a valid json string, and returns a javascript object. If the string
// is NOT valid json, the result is an object with the val property referencing the actual value.
Adapter.json = function(results) {
  try {
    return JSON.parse(results.buffer.toString('utf8'));      
  } catch (x) {
    return { val: results.buffer.toString('utf8') };
  }
};

// The binary adapter simply returns the buffer as is, discarding the flags and size information.
Adapter.binary = function(results) {
  return results.buffer;
};

// The string adapter returns the string representation of the value.
Adapter.string = function(results) {
  return results.buffer.toString('utf8');
};

// Built-in adapters are made available to application developers to hand to the memcache client, or cluster.
module.exports.Adapter = Adapter;

// Client
// ------
//
// The Client is the heart of the matter.
function Client(servers, adapter, strategy) {
  this.adapter = adapter || Adapter.string;
  this.ttl = 0;         // Default time to live = forever.
  this.connections = [];
  for (var server in servers) {
    this.connections.push(new Connection(server));
  }
  if (this.connections.length == 1) { this.strategy = Strategy.solo; }
  else {this.strategy = strategy || Strategy.hash; }
}

Client.prototype.setTimeToLive = function (ttl) {
  this.ttl = ttl;
};

Client.prototype.setAdapter = function(adapter) {
  this.adapter = adapter;
};

Client.prototype.connect = function (cb) {
  var count  = this.connections.length;
  for (var connection in this.connections) {
    connection.open(function() {
      count--;
      if (count === 0) { cb(); }
    });
  }
};

Client.prototype.getConnection = function(key) {
  return this.connections[this.strategy(key, this.connections.length, this)];
};

Client.prototype.multiGet = function(key, command, cb) {
  var buckets = [];
  var count = 0;
  for (var k in key) {
    var bucket = this.strategy(key, this.connections.length, this);
    if (buckets[bucket]) { buckets[bucket] += (' ' + k); }
    else {
      count++; // New bucket!
      buckets[bucket] = k; 
    }
  }
  for (var i = 0; i < buckets.length; i++) {
    if (buckets[i]) {
      this.connctions[i].write(process_get, cb, command + ' ' + buckets[i]);
    }
  }
};

Client.prototype.get = function (key, cb) {
  if (Array.isArray(key)) {
    this.multiGet(key, 'get', cb);
  } else {
    this.getConnection(key).write(process_get, cb, 'get ' + key);
  }
};

Client.prototype.gets = function (key, cb) {
  if (Array.isArray(key)) {
    this.multiGet(key, 'gets', cb);
  } else {
    this.getConnection(key).write(process_get, cb, 'gets ' + key);
  }
};

Client.prototype.store = function (operation, key, val, opts, cb) {
  var exptime = 0;
  var flags = 0;
  var cas;
  if (!cb) { cb = opts; }
  else {
    exptime = opts.exptime || (this.ttyl ? Math.floor((new Date()).getTime() / 1000) + this.ttyl : 0);
    flags = opts.flags || 0;
    cas = opts.cas;
  }
  // Ensure any numeric values are expressed as a string.
  key = String(key);
  val = String(val);
  if (key.length > 250) {
    cb({
      type: 'CLIENT_ERROR',
      description: 'Key too long, max 250 char'
    }, null);
    return null;
  }
  var conn = this.getConnection(key, this.connections.length, this);
  if (cas) {
    conn.write(process_min_response, cb, [operation, key, flags, exptime, val.length, cas].join(' '), val);
  } else {
    conn.write(process_min_response, cb, [operation, key, flags, exptime, val.length].join(' '), val);
  }
};

Client.prototype.set = function (key, val, opts, cb) {
  this.store('set', key, val, opts, cb);
};

Client.prototype.add = function (key, val, opts, cb) {
  this.store('add', key, val, opts, cb);
};

Client.prototype.cas = function (key, val, cas, opts, cb) {
  if (!cb) {
    cb = opts;
    opts = {
      cas: cas
    };
  }
  this.store('cas', key, val, opts, cb);
};

Client.prototype.replace = function (key, val, opts, cb) {
  this.store('replace', key, val, opts, cb);
};

Client.prototype.append = function (key, val, opts, cb) {
  this.store('append', key, val, opts, cb);
};

Client.prototype.prepend = function (key, val, opts, cb) {
  this.store('prepend', key, val, opts, cb);
};

Client.prototype.incr = function (key, val, cb) {
  if (!cb) {
    cb = val;
    val = 1;
  }
  var conn = this.connections[this.getConnection(key, this.connections.length, this)];
  conn.write(process_numeric_response, cb, ['incr ', key, val].join(' '));
};

Client.prototype.decr = function (key, val, cb) {
  if (!cb) {
    cb = val;
    val = 1;
  }
  var conn = this.connections[this.getConnection(key, this.connections.length, this)];
  conn.write(process_numeric_response, cb, ['decr ', key, val].join(' '));
};

Client.prototype.del = function (key, cb) {
  var conn = this.connections[this.getConnection(key, this.connections.length, this)];
  conn.write(process_min_response, cb, 'delete ' + key);
};

Client.prototype.version = function (cb) {
  var count = this.connections.length;
  var versions = [];
  for (var conn in this.connections) {
    conn.write(process_version, function(err, version) {
      count--;
      if (err) { versions.push(err); }
      else { versions.push(version); }
      if (count === 0) {
        cb(null, versions);
      }
    }, 'version');
  }
};

Client.prototype.stats = function (type, cb) {
  if (!cb) {
    cb = type;
    type = '';
  }
  var handler;
  switch (type) {
  case 'items':
    handler = process_items_stats;
    break;
  case 'sizes':
    handler = process_sizes_stats;
    break;
  case 'slabs':
    handler = process_slabs_stats;
    break;
  case '':
    handler = process_stats;
    break;
  default: // Forward compatible: treat any future state type as matching the default pattern.
    handler = process_stats;
  }
  var stats = [];
  var count = this.connections.length;
  for (var conn in this.connections) {
    conn.write(handler, function(err, response) {
      count--;
      if (err) { stats.push(err); }
      else { stats.push(response); }
      if (count === 0) {
        cb(null, stats);
      }
    }, 'stats ' + type);    
  }
};
      
// Response parsing functions
// --------------------------
//
// The following private methods parse the response from the server.
var crlf = '\r\n';

var version_str = 'VERSION ';
var version_str_len = version_str.length;

var stat_str = 'STAT ';
var stat_str_len = stat_str.length;

var end_str = 'END' + crlf;
var end_str_trunc = 'END';
var end_str_len = end_str.length;

var items_str = 'STAT items:';
var items_str_len = items_str.length;

function process_version(line) {
  var results = {};
  results.bytes_parsed = line.next;
  if (line.str) {
    results.data = line.str.substring(version_str_len);
  }
  return results;
}

function process_items_stats(line, buffer) {
  var results = {};
  var stats = buffer.toString('utf8');
  var term = stats.indexOf(end_str);
  if (term == -1) {
    results.bytes_parsed = -1;
  }
  else {
    var data = {};
    data.slabs = [];
    var keystart = stats.indexOf(items_str, 0);
    var valend;
    var valstart;
    while (keystart != -1 && keystart < term) {
      keystart += items_str_len;
      valend = stats.indexOf(crlf, keystart);
      valstart = stats.indexOf(' ', keystart) + 1;
      var cat = stats.substr(keystart, valstart - keystart - 1).split(':');
      var val = stats.substr(valstart, valend - valstart);
      if (!data.slabs[cat[0]]) {
        data.slabs[cat[0]] = {};
      }
      data.slabs[cat[0]][cat[1]] = val;
      keystart = stats.indexOf(items_str, valend);
    }
    results.bytes_parsed = term + end_str_len;
    results.data = data;
  }
  return results;
}

function process_slabs_stats(line, buffer) {
  var results = {};
  var stats = buffer.toString('utf8');
  var term = stats.indexOf(end_str);
  if (term == -1) {
    results.bytes_parsed = -1;
  }
  else {
    var data = {};
    data.slabs = [];
    var keystart = stats.indexOf(stat_str, 0);
    var valend;
    var valstart;
    while (keystart != -1 && keystart < term) {
      keystart += stat_str_len;
      valend = stats.indexOf(crlf, keystart);
      valstart = stats.indexOf(' ', keystart) + 1;
      var cat = stats.substr(keystart, valstart - keystart - 1).split(':');
      var val = stats.substr(valstart, valend - valstart);
      if (isNaN(cat[0])) {
        data[cat[0]] = val;
      }
      else {
        if (!data.slabs[cat[0]]) {
          data.slabs[cat[0]] = {};
        }
        data.slabs[cat[0]][cat[1]] = val;
      }
      keystart = stats.indexOf(stat_str, valend);
    }
    results.bytes_parsed = term + end_str_len;
    results.data = data;
  }
  return results;
}

function process_sizes_stats(line, buffer) {
  var results = {};
  var stats = buffer.toString('utf8');
  var term = stats.indexOf(end_str);
  if (term == -1) {
    results.bytes_parsed = -1;
  }
  else {
    var data = {};
    var valend = stats.indexOf(crlf, 0);
    var info = stats.substr(stat_str_len, valend - stat_str_len).split(' ');
    data.bytes = info[0];
    data.items = info[1];
    results.data = data;
  }
  return results;
}

function process_stats(line, buffer) {
  var results = {};
  var vstring = buffer.toString('utf8');
  var term = vstring.indexOf(end_str);
  if (term == -1) {
    results.bytes_parsed = -1;
  }
  else {
    var data = {};
    var keystart = vstring.indexOf(stat_str, 0);
    var valend;
    var valstart;
    while (keystart != -1 && keystart < term) {
      keystart += stat_str_len;
      valend = vstring.indexOf(crlf, keystart);
      valstart = vstring.indexOf(' ', keystart) + 1;
      var cat = vstring.substr(keystart, valstart - keystart - 1);
      var val = vstring.substr(valstart, valend - valstart);
      data[cat] = val;
      keystart = vstring.indexOf(stat_str, valend);
    }
    results.bytes_parsed = term + end_str_len;
    results.data = data;
  }
  return results;
}

function process_get(line, buffer, adapter) {
  var results = {};
  var data = {};
  var count = 0;
  while (line.str && line.str != end_str_trunc) {
    var item = {};
    var meta = line.str.split(' ');
    var key = meta[1];
    item.flags = meta[2];
    item.size = parseInt(meta[3], 10);
    var val_end = line.next + item.size;
    if (val_end > buffer.length) { // Bail immediately if we have an incomplete value.
      results.bytes_parsed = -1;   // We'll wait for more and re-run.
      return results;
    }
    item.buffer = buffer.slice(line.next, val_end);
    if (meta[4]) {
      item.cas = meta[4];
      data[key] = {};
      data[key]['val'] = adapter(item);
      data[key]['cas'] = item.cas;
    } else {
      data[key] = adapter(item);	
    }
    line = process_line(buffer, val_end + 2); // Two bytes for the extra crlf in mc protocol
    count++;
  }
  if (line.str && line.str === end_str_trunc) {
    if (count === 0) {
      results.error = { type: 'NOT_FOUND', description: '' };
      results.data = null;
    } else {
      results.data = data;
    }
    results.bytes_parsed = line.next;
  }
  else {
    results.bytes_parsed = -1;
  }
  return results;
}

function process_min_response(line) {
  var results = {};
  results.bytes_parsed = line.next;
  if (line.str) {
    switch (line.str) {
    case 'NOT_FOUND':
    case 'EXISTS':
    case 'NOT_STORED':
      results.error = {};
      results.error.type = line.str;
      results.error.description = '';
      break;
    default:
      results.data = line.str;
    }
  }
  return results;
}

function process_numeric_response(line) {
  var results = {};
  results.bytes_parsed = line.next;
  if (line.str) {
    if (line.str == 'NOT_FOUND') {
      results.error = {};
      results.error.type = line.str;
      results.error.description = '';
      results.data = null;
    }
    else if (line.str.substr(0, 12) == 'CLIENT_ERROR') {
      results.error = {};
      results.error.type = 'CLIENT_ERROR';
      results.error.description = line.str.substr(13);
      results.data = null;
    }
    else {
      results.data = +line.str;
    }
  }
  return results;
}

module.exports.Client = Client;

// Connection
// ----------
//
// The memcache client keeps open connections to all servers in the cluster. A connection object manages all 
function Connection(server) {
  var hostElems = server.split(':');
  this.host = hostElems[0] || 'localhost';
  this.port = hostElems[1] || 11211;
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

