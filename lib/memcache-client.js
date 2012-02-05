var net = require('net');
var Queue = require('./queue');

function MemcacheClient(port, host) {
  this.port = port || 11211;
  this.host = host || 'localhost';
  this.requests = 0; // Debug, remove for release
  this.responses = 0; // Debug, remove for release
  this.queue = new Queue(); // Request Queue
  this.sock = undefined; // Our socket to the server.
  this.retry = true; // Should we reconnect on connection failure?
  this.backoff = 10; // Backoff in micros
  this.connect(); // Connect on object creation.
  this.ttl = 0;
}

MemcacheClient.prototype.setTimeToLive = function(ttl) {
  this.ttl = ttl;
};

MemcacheClient.prototype.prepConnection = function(handler, cb) {
  if (!this.sock) {
    cb('ERROR: No Connection to Server', null);
    return false;
  } else {
    this.queue.enqueue({
      handler: handler,
      callback: cb
    });
  }
  return true;
};

MemcacheClient.prototype.get = function (key, cb) {
  if (this.prepConnection(process_get, cb)) {
    this.sendServer('get ' + key);
  }
};

MemcacheClient.prototype.gets = function (key, cb) {
  if (this.prepConnection(process_get, cb)) {
    this.sendServer('gets ' + key);
  }
};

MemcacheClient.prototype.store = function(operation, key, val, opts, cb) {
  var exptime = 0;
  var flags   = 0;
  var cas;
  if (!cb) { cb = opts; }
  else {
    exptime = opts.exptime || ( this.ttyl ? Math.floor((new Date()).getTime() / 1000) + this.ttyl : 0 );
    flags   = opts.flags  || 0;
    cas     = opts.cas;
  }
  if (key.length > 250) {
    cb('ERROR: Key too long, max 250 char', null);
    return null;
  }
  if (this.prepConnection(process_min_response, cb)) {
    if (cas) {
      this.sendServer([operation, key, flags, exptime, val.length, cas].join(' '),  val);
    } else {
      this.sendServer([operation, key, flags, exptime, val.length].join(' '), val);
    }
  }
};

MemcacheClient.prototype.set = function (key, val, opts, cb) {
  this.store('set', key, val, opts, cb);
};

MemcacheClient.prototype.add = function (key, val, opts, cb) {
  this.store('add', key, val, opts, cb);
};

MemcacheClient.prototype.cas = function (key, val, cas, opts, cb) {
  if (!cb) {
    cb = opts;
    opts = {
      cas: cas
    };
  }
  this.store('cas', key, val, opts, cb);
};

MemcacheClient.prototype.replace = function (key, val, opts, cb) {
  this.store('replace', key, val, opts, cb);
};

MemcacheClient.prototype.append = function (key, val, opts, cb) {
  this.store('append', key, val, opts, cb);
};

MemcacheClient.prototype.prepend = function (key, val, opts, cb) {
  this.store('prepend', key, val, opts, cb);
};

MemcacheClient.prototype.incr = function (key, val, cb) {
  if (!cb) {
    cb = val;
    val = 1;
  }
  if (this.prepConnection(process_min_response, cb)) {
    this.sendServer('incr ' + key + ' ' + val);
  }
};

MemcacheClient.prototype.decr = function (key, val, cb) {
  if (!cb) {
    cb = val;
    val = 1;
  }
  if (this.prepConnection(process_min_response, cb)) {
    this.sendServer('decr ' + key + ' ' + val);
  }
};

MemcacheClient.prototype.del = function (key, cb) {
  if (this.prepConnection(process_min_response, cb)) {
    this.sendServer('delete ' + key);
  }
};

MemcacheClient.prototype.version = function (cb) {
  if (this.prepConnection(process_version, cb)) {
    this.sendServer('version');
  }
};

MemcacheClient.prototype.stats = function (cb) {
  if (this.prepConnection(process_stats, cb)) {
    this.sendServer('stats');
  }
};

MemcacheClient.prototype.reconnect = function () {
  if (this.backoff < 128000) {
    this.backoff *= 2;
  }
  var self = this;
  setTimeout(function () {
    self.connect();
  }, this.backoff);
};

MemcacheClient.prototype.close = function () {
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

MemcacheClient.prototype.connect = function () {
  var self = this;
  if (this.sock || !this.retry) return; // We do not want to try to connect.
  this.sock = net.connect(this.port, this.localhost, function () {
    // Connect listener: called on successful connect.
    self.sock.setNoDelay(true);
    self.backoff = 10; // Reset backoff on success
  });

  this.sock.addListener('data', function (data) {
    self.readFromServer(data);
  });

  // Errors typically occur on failed connection; but in any case, we will want to pass
  // this back to the app, if it is interested.
  this.sock.addListener('error', function () {
    // TODO: clear pending requests and inform application of the error.
  });

  // Close event happens after err or end events have happened.
  this.sock.addListener('close', function () {
    if (self.retry) {
      self.sock = undefined;
      self.reconnect();
    }
  });

  // Note on additional events:
  //   end     -- the server dropped the connect; our logic is handled by 'close'
  //   timeout -- we do not specify a timeout, there should be no timeout events emitted.
  //   data    -- registered elsewhere
  //   drain   -- not used.
};

// Socket handling.
var crlf = '\r\n';

MemcacheClient.prototype.sendServer = function (command, value) {
  this.requests++;
  this.sock.write(command + crlf);
  if (value) {
    this.sock.write(value);
    this.sock.write(crlf);
  }
};

MemcacheClient.prototype.readFromServer = function (data) {
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
  while(i < max) {
    if (buffer[i] === 0x0d && buffer[i+1] === 0x0a) {
      return { str: buffer.toString('utf8',start,i), next: i+2};
    }
    i++;
  }
  return {str: null, next: -1};
}

MemcacheClient.prototype.processBuffer = function () {
  while (this.buffer.length > 0) {
    var dispatcher = this.queue.peek();
    if (!dispatcher) {
      console.log("ERROR: No request in queue to handle response.");
      // TODO adapt responsibly.
    }
    var peekResponse = process_line(this.buffer);    
    if (!peekResponse.str || peekResponse.str.substr(0, 5) === 'ERROR') {
      this.buffer = this.buffer.slice(peekResponse.next);
      this.queue.dequeue().callback(peekResponse.str, null);
    } else {
      var results = dispatcher.handler(peekResponse, this.buffer);

      if (results.bytes_parsed == -1) { // Do nothing. Need more data.
        break; // Wait for a new data event.
      } else {
        this.buffer = this.buffer.slice(results.bytes_parsed);
        this.responses++;
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

function process_stats(line, buffer) {
  var results = {};
  var vstring = buffer.toString('utf8');
  var term = vstring.indexOf(end_str);
  if (term == -1) {
    results.bytes_parsed = -1;
  } else {
    var data = {};
    var keystart = vstring.indexOf(stat_str, 0);
    var valend;
    var valstart;
    while (keystart != -1 && keystart < term) {
      keystart += stat_str_len;
      valend   = vstring.indexOf(crlf, keystart);
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
  var results = { data: [] };
  while (line.str && line.str != end_str_trunc) {
    var item = {};
    var meta = line.str.split(' ');
    item.key = meta[1];
    item.flags = meta[2];
    item.size = parseInt(meta[3],10);
    if (meta[4]) { item.cas = meta[4]; }
    var val_end = line.next + item.size;
    
    if (val_end > buffer.length) {               // Bail immediately if we have an incomplete value.
      results.bytes_parsed = -1;                 // We'll wait for more and re-run.
      return results;
    }
    item.buffer = buffer.slice(line.next, val_end);
    item.val    = item.buffer.toString('utf8');  // TODO: waste of time for bin buffers. Optimize.
    results.data.push(item);
    line = process_line(buffer, val_end + 2);    // Two bytes for the extra crlf in mc protocol
  }
  if (line.str && line.str === end_str_trunc) {
    results.bytes_parsed = line.next;
  } else {
    results.bytes_parsed = -1;
  }
  return results;
}

function process_min_response(line) {
  var results = {};
  results.bytes_parsed = line.next;
  if (line.str) {
    results.data = line.str;
  }
  return results;
}

module.exports = MemcacheClient;
