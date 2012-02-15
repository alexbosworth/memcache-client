var net = require('net'),
    Queue = require('./queue');

function Client(port, host) {
  this.port = port || 11211;
  this.host = host || 'localhost';
  this.queue = new Queue(); // Request Queue
  this.sock = undefined;   // Our socket to the server.
  this.retry = true;      // Should we reconnect on connection failure?
  this.backoff = 10;     // Backoff in micros
  this.ttl = 0;         // Default time to live = forever.
}

Client.prototype.setTimeToLive = function (ttl) {
  this.ttl = ttl;
};

Client.prototype.prepConnection = function (handler, cb) {
  if (!this.sock) {
    cb({
      type: 'CONNECTION_ERROR',
      description: 'No Connection to Server'
    }, null);
    return false;
  }
  else {
    this.queue.enqueue({
      handler: handler,
      callback: cb
    });
  }
  return true;
};

Client.prototype.get = function (key, cb) {
  if (this.prepConnection(process_get, cb)) {
    this.sendServer('get ' + key);
  }
};

Client.prototype.gets = function (key, cb) {
  if (this.prepConnection(process_get, cb)) {
    this.sendServer('gets ' + key);
  }
};

Client.prototype.store = function (operation, key, val, opts, cb) {
  var exptime = 0;
  var flags = 0;
  var cas;
  if (!cb) {
    cb = opts;
  }
  else {
    exptime = opts.exptime || (this.ttyl ? Math.floor((new Date()).getTime() / 1000) + this.ttyl : 0);
    flags = opts.flags || 0;
    cas = opts.cas;
  }
  key = String(key);
  val = String(val);
  if (key.length > 250) {
    cb({
      type: 'CLIENT_ERROR',
      description: 'Key too long, max 250 char'
    }, null);
    return null;
  }
  if (this.prepConnection(process_min_response, cb)) {
    if (cas) {
      this.sendServer([operation, key, flags, exptime, val.length, cas].join(' '), val);
    }
    else {
      this.sendServer([operation, key, flags, exptime, val.length].join(' '), val);
    }
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
  if (this.prepConnection(process_numeric_response, cb)) {
    this.sendServer('incr ' + key + ' ' + val);
  }
};

Client.prototype.decr = function (key, val, cb) {
  if (!cb) {
    cb = val;
    val = 1;
  }
  if (this.prepConnection(process_numeric_response, cb)) {
    this.sendServer('decr ' + key + ' ' + val);
  }
};

Client.prototype.del = function (key, cb) {
  if (this.prepConnection(process_min_response, cb)) {
    this.sendServer('delete ' + key);
  }
};

Client.prototype.version = function (cb) {
  if (this.prepConnection(process_version, cb)) {
    this.sendServer('version');
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

  if (this.prepConnection(handler, cb)) {
    this.sendServer('stats ' + type);
  }
};

Client.prototype.reconnect = function () {
  if (this.backoff < 128000) {
    this.backoff *= 2;
  }
  var self = this;
  setTimeout(function () {
    self.connect();
  }, this.backoff);
};

Client.prototype.close = function () {
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

Client.prototype.connect = function (cb) {
  var self = this;
  if (this.sock || !this.retry) return; // We do not want to try to connect.
  this.sock = net.connect(this.port, this.localhost, function () {
    // Connect listener: called on successful connect.
    self.sock.setNoDelay(true);
    self.backoff = 10; // Reset backoff on success
    self.sock.addListener('data', function (data) {
      self.readFromServer(data);
    });

    // Close event happens after err or end events have happened.
    self.sock.addListener('close', function () {
      if (self.retry) {
        self.sock = undefined;
        var lost = self.queue.dequeue();
        while (lost) {
          lost.callback({
            type: "CONNECTION_ERROR",
            description: 'Lost Connection to Server'
          }, null);
          lost = self.queue.dequeue();
        }

        self.reconnect();
      }
    });

    // Note on additional events:
    //   end     -- the server dropped the connect; our logic is handled by 'close'
    //   timeout -- we do not specify a timeout, there should be no timeout events emitted.
    //   data    -- registered elsewhere
    //   drain   -- not used.
    //   error   -- followed by a close event, we listen for and use that event.
    if (cb) cb();
  });
};

// Socket handling.
var crlf = '\r\n';

Client.prototype.sendServer = function (command, value) {
  if (!this.sock) {
    this.queue.pop().callback({
      type: 'CONNECTION_ERROR',
      description: 'No Available Connection'
    }, null);
  }
  try {
    this.sock.write(command + crlf);
    if (value) {
      this.sock.write(value + crlf);
    }
  }
  catch (x) {
    this.queue.pop().callback({
      type: 'CONNECTION_ERROR',
      description: x.message
    }, null);
  }
};

Client.prototype.readFromServer = function (data) {
  var buff = data;
  if (this.buffer && this.buffer.length > 0) { // We have pending data from server : merge
    buff = new Buffer(this.buffer.length + data.length);
    this.buffer.copy(buff);
    data.copy(buff, this.buffer.length);
  }
  this.buffer = buff;
  this.processBuffer();
};

// PARSING THE MEMCACHE RESPONSE.
var version_str = 'VERSION ';
var version_str_len = version_str.length;

var stat_str = 'STAT ';
var stat_str_len = stat_str.length;

var end_str = 'END' + crlf;
var end_str_trunc = 'END';
var end_str_len = end_str.length;

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

Client.prototype.processBuffer = function () {
  while (this.buffer.length > 0) {
    var dispatcher = this.queue.peek();
    if (!dispatcher) {
      console.log("ERROR: No request in queue to handle response.");
      // TODO adapt responsibly.
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
      var results = dispatcher.handler(peekResponse, this.buffer);

      if (results.bytes_parsed == -1) { // Do nothing. Need more data.
        break; // Wait for a new data event.
      }
      else {
        this.buffer = this.buffer.slice(results.bytes_parsed);
        this.queue.dequeue();
        dispatcher.callback(results.error, results.data);
      }
    }
  }
};

function process_version(line) {
  var results = {};
  results.bytes_parsed = line.next;
  if (line.str) {
    results.data = line.str.substring(version_str_len);
  }
  return results;
}

var items_str = 'STAT items:';
var items_str_len = items_str.length;

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

function process_get(line, buffer) {
  var results = {
    data: []
  };
  while (line.str && line.str != end_str_trunc) {
    var item = {};
    var meta = line.str.split(' ');
    item.key = meta[1];
    item.flags = meta[2];
    item.size = parseInt(meta[3], 10);
    if (meta[4]) {
      item.cas = meta[4];
    }
    var val_end = line.next + item.size;

    if (val_end > buffer.length) { // Bail immediately if we have an incomplete value.
      results.bytes_parsed = -1;   // We'll wait for more and re-run.
      return results;
    }
    item.buffer = buffer.slice(line.next, val_end);
    item.val = item.buffer.toString('utf8');  // TODO: Add typed clients, remove this convenience action.
    results.data.push(item);
    line = process_line(buffer, val_end + 2); // Two bytes for the extra crlf in mc protocol
  }
  if (line.str && line.str === end_str_trunc) {
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
