# memcache-client

A correct, performant memcache client that emphasizes stability and simplicity over large-system features such as
sharding and consistent hashing. The expectation is that developers handling distributed data sets will prefer to
handle sharding or consistent hashing with their own logic -- or may have legacy distribution strategies in place
already. One additional feature of this client is the guarantee of handling binary memcache values correctly over
the simple ascii protocol. This client does not implement the new binary protocol.

Specifically, this client implements: https://github.com/memcached/memcached/blob/master/doc/protocol.txt

This library does draw inspiration from both 3rd-Eden, elbart, and ddopson: but it is a ground-up rewrite.

### Status

* 1.0.1 is now available. 
* Additional documentation forthcoming, better code documentation.

## Install

    npm install mc

## Usage

### Creation

The constructor takes three parameters: a server list (or just a server), an adapter, and a strategy. Adapter and
Strategy functions are described more thoroughly below.

    var mc = require('mc');

    // All defaults
    var cli1 = new mc.Client();

    // Default adapter and strategy
    var cli2 = new mc.Client(['2.3.4.5', '3.4.5.6']);
    
    // Single connection, default strategy and off-the-shelf json adapter
    var cli3 = new mc.Client('1.2.3.4', mc.Adapter.json);

    // Sharded connection, provided adapter and strategy
    var cli4 = new mc.Client(['1.2.3.4','2.3.4.5'], mc.Adapter.raw, mc.Strategy.hash);

    // Sharded connection, default adapter, provided strategy
    var cli5 = new mc.Client(['1.2.3.4','2.3.4.5'], null, mc.Strategy.hash);

### Connection

#### Single connection to localhost

    var mc = require('mc');
    var client = new mc.Client();
    client.connect(function() {
      console.log("I am now connected to the localhost memcache on port 11211!");
    }

#### Single connection to a specified host

    var client = new mc.Client('1.2.3.4');
    client.connect(function() {
      console.log("I am now connected to the memcache on host 1.2.3.4 using the default port 11211!");
    }

#### Connection to an array of hosts using the default CRC-hash sharding strategy

    var client = new mc.Client(['1.2.3.4', '2.3.4.5', '3.4.5.6', '4.5.6.7']);
    client.connect(function() {
      console.log("I am now connected to the memcache on four hosts using the default port 11211!");
    }

#### Connection to an array of hosts using a custom sharding strategy but no adapter

    var strategy = function(key, max) {
      return key % max;
    }

    var client = new mc.Client(['1.2.3.4', '2.3.4.5', '3.4.5.6', '4.5.6.7'], null, strategy );
    client.connect(function() {
      console.log("I am now connected to the memcache on four hosts using the default port 11211!");
    }

### Error responses

All memcache calls take as the last parameter a callback that should in turn accept error and response parameters
in that order. The error param will always have a type property, and may also have a description property. Errors
may be returned for ordinary conditions such as a key that is not found, or in exceptional cases, such as failure
in the server connection.

### Set, Add, Replace, Prepend, Append, Cas

The following snippet sets with the default options, which may be omitted. Note that the value may be a string or
a buffer object. The flags option is not used by memcache; this is a user-space value of 32 bits (or 16 bits some
ancient installations). The exptime is the time-to-live terminus in standard unixtime. A '0' exptime indicates no
expiration. The add, replace, prepend and append methods are all identical, with the exception of the non-success
results, noted below.

    client.set( 'myKey', 'myVal', { flags: 0, exptime: 0}, function(err, status) {
      if (!err) { 
        console.log(status); // 'STORED' on success!
      }
    });

    client.add( 'myKey', 'myVal', function(err, response) { // Flags parameter is optional.
      if (!err) { // Error types can be NOT_STORED
        console.log(status); // 'STORED' on success!
      }
    });

    client.cas( 'myKey', 'myNewVal', casvalue, {flags: 0, exptime: 0}, function(err, status) {
      if (!err) { // Error types can be EXISTS, or NOT_FOUND
        console.log(status); // 'STORED' on success!
      }
    });

Success Response:

* STORED: Success. The result was stored.

Failure Responses:

* NOT_STORED: Failure. 'add' was attempted on an existing key, or 'replace' on a non-existent key.
* EXISTS: Failure. 'cas' was attempted on a key that had been changed since fetch.
* NOT_FOUND: Failure. 'cas' was attempted on a non-existent key. (Some servers return EXISTS in this case also.)

### Increment/Decrement

The value parameter in these methods is optional, and defaults to 1.
Possible error types: NOT_FOUND, when the key does not exist; CLIENT_ERROR, when the value is not numeric.

    client.incr( 'myKey', 2, function(err, value) {
      if (!err) {
        console.log(value); // Value returned on success
      }
    });
    client.decr( 'myKey', function(err, value) { // No value parameter, defaults to 1.
      if (!err) {
        console.log(value);
      }
    ));

### Get/Gets

Get may take a single key, or an array of keys. Keys may not contain whitespace: a string with whitespace will be
interpreted as multiple keys. The return result is always a map of each key to the value generated by the current
adapter. The default adapter is the string adapter. The 'gets' method maps keys to an object with two properties:
'val' which maps to the results of the adapter, and 'cas' which contains the unique key.

For more on Adapters, see below.

A couple of samples.

    client.setAdapter(mc.Adapter.string);
    client.get( 'myKey', function(err, response) {
      if (!err) {
        console.log(response['myKey']);  // should output a simple string.
    } }

    client.gets( 'myKey', function(err, response) {
      if (!err) {
        if (response['myKey') {
          mc.cas( 'myKey', 'myNewVal', response['myKey].cas, { flags: 0, exptime: 0 }, function (err, status) {
            if (!err) {
              console.log(status); // 'STORED' if the calue was not changed by another process.
    } } } } }

### Version

Version will return an array of versions for each server in the memcache array.

    client.version( function(err, version) {
      if (!err) {
        console.log(version);
      }
    }

Output might be:

    [ '1.4.5', '1.4.5', '1.4.6' ]

### Stats

All stats calls will return an array of stats values from each of the servers in the array.

    client.stats( function(err, stats) {
      if (!err) {
        // E.g.: how many bytes are being stored?
        // Check your local memcache installation for all the options!
        console.log(stats[0].bytes);
      }
    }

Stats may also take several sub-commands. Currently documented commands are: 'slabs', 'items', and 'sizes'. These
subcommands return appropriate datastructures as indicated below. Other stats variants, currently undocumented or 
not-yet-invented, will be parsed by the default parser.

#### Subcommands:
   
    client.stats( 'sizes', function(err, stats) {
      if (!err) {
        console.log(stats);
        // [ { bytes: <bytes>, items: <items> } ]
      }
    }
	
    client.stats( 'items', function(err, stats) {
      if (!err) {
        console.log(stats);
        // [ { slabs: [ , { number: <items>, age: <age>, ... etc. } ] } ]
        // Note that slabs is a one-based array.
      }
    }

    client.stats( 'slabs', function(err, stats) {
      if (!err) {
        console.log(stats);
        // [ { active_slabs: <num slabs>, total_malloced: <total mem>, slabs: [ , { chunk_size: <size>, ... } ] } ]
        // Note that here also, slabs is a one based array.
      }
    }

## Adapters

The client may be configured with a prebuilt or a custom response adapter. The pre-built adapters are:

* `mc.Adapter.string` [default]
* `mc.Adapter.raw`
* `mc.Adapter.binary`
* `mc.Adapter.json`

The role of an adapter is to format the results of a `get` or `gets` call for the convenience of the application.

The `raw` adapter is instructive. It returns:

    {
      buffer: <the raw byte buffer, for binary values>
      size:   <the length of the buffer>
      flags:  <any flags associated with the item>
      key:    <the key this value is associated with>
      cas:    <the check number; only returned by gets; used for check-and-set storage>
    }

The application my provide any function as an adapter that operates on this raw object and returns whatever other
object is suitable for the application. For example, applications might compress the value (although at this time
there is no input adapter to balance the equation out, a possible future feature.)

By way of example, the implementation of the json adapter follows:

    Adapter.json = function(results) {
      try {
        return JSON.parse(results.buffer.toString('utf8'));      
      } catch (x) {
        return { val: results.buffer.toString('utf8') };
      }
    };

(And thus, you see, that invalid json will result in an object mapping 'val' to whatever *was* in memcache.)

## Strategies

The default sharding strategy is none for a single connection, or CRC sharding on the key for arrays of more than
one. These are available for explicit selection:

* 'mc.Strategy.solo'
* 'mc.Strategy.hash'

Custom strategies, however, may be supplied to achieve other sharding policies. The strategy is a function taking
two parameters: a key and the size of the array. It must return an integer greater than or equal to zero and less
than the max value provided. E.g.:

    function numericShard(key, max) {
      return key % max;
    }

## Testing

Unit tests may be run by executing 'make test'. All methods have basic happy-case and error case coverage. Beyond
unit tests, an integration test package, which expects a memcache running locally on port 11211 can be run by the
command 'make integration'. These longer running tests exercise the full api in a real-world simulation including
network failure scenarios. There is an even longer running app: test/simulation/runlong.js which may be used when
testing more complicated network / server failure scenarios.

## Changelog

### v 1.0.1

* Fix bug for gets command.

### v 1.0.0

* Full production testing of version 0.9.0 complete, promoted to ready-for-prime-time.

### v 0.9.0

* Clustering strategies and content adapters now in beta. (See documentation, below.)
* Refactor connection and client logic.
* Rewrite tests for refactored model, better unit division.

### v 0.8.0

* Result adapter model
    * JSON Parser
    * Binary 
    * Simple String (Default)
    * Raw

### v 0.6.1

* Fix integration tests for multi-get format changes.

### v 0.6.0

* Documentation Complete
* Installation Ready
* Correctly handle network errors
* Protocol implementation:
    * stats, incl sub-commands 'slabs', 'items', 'sizes'
    * delete
    * get/gets
    * set/add/replace/append/prepend/cas
    * increment/decrement
    * version
* Multi-get support
* Correct binary storage/retrieval
* Test framework for unit tests
* Test framework for integration tests
* Default expiration settings
