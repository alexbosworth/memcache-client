# memcache-client

A correct, performant memcache client that emphasizes stability and simplicity over large-system features such as
sharding and consistent hashing. The expectation is that developers handling distributed data sets will prefer to
handle sharding or consistent hashing with their own logic -- or may have legacy distribution strategies in place
already. One additional feature of this client is the guarantee of handling binary memcache values correctly over
the simple ascii protocol. This client does not implement the new binary protocol.

Specifically, this client implements: https://github.com/memcached/memcached/blob/master/doc/protocol.txt

This library does draw inspiration from both 3rd-Eden, elbart, and ddopson: but it is a ground-up rewrite.

### Roadmap

    v 0.8.0  : JSON, Binary adapters
    v 1.0.0  : Clustering plugin adapter

### Changelog

#### v 0.6.0

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

## Install

    npm install mc

## Usage

### Connection

    var mc = require('mc');
    var client = new mc.Client('localhost', 11211);
    client.connect(function() {
      console.log("I am now connected to memcache!");
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
interpreted as multiple keys. The return result is always a map of each key found to a container including value.
If no results were found, either for one or multiple keys, the callback will be handed an error structure of type
'NOT_FOUND'. If some of the keys in a multi-get call were not found no error will be set and the keys will not be
present in the response object.

The response object:

    {
      buffer: <the raw byte buffer, for binary values>
      value:  <the string representation of this buffer, for the common use case>
      size:   <the length of the string
      flags:  <any flags associated with the item>
      key:    <the key this value is associated with>
      cas:    <the check number; only returned by gets; used for check-and-set storage>
    }

A couple of samples.

    client.get( 'myKey', function(err, response) {
      if (!err) {
        console.log(response['myKey']);
    } }

    client.gets( 'myKey', function(err, response) {
      if (!err) {
        if (response['myKey') {
          mc.cas( 'myKey', 'myNewVal', response['myKey].cas, { flags: 0, exptime: 0 }, function (err, status) {
            if (!err) {
              console.log(status); // 'STORED' if the calue was not changed by another process.
    } } } } }

### Version

    client.version( function(err, version) {
      if (!err) {
        console.log(version);
      }
    }

### Stats

    client.stats( function(err, stats) {
      if (!err) {
        // E.g.: how many bytes are being stored?
        // Check your local memcache installation for all the options!
        console.log(stats.bytes);
      }
    }

Stats may also take several sub-commands. Currently documented commands are: 'slabs', 'items', and 'sizes'. These
subcommands return appropriate datastructures as indicated below. Other stats variants, currently undocumented or 
not-yet-invented, will be parsed by the default parser.

#### Subcommands:
   
    client.stats( 'sizes', function(err, stats) {
      if (!err) {
        console.log(stats);
        // { bytes: <bytes>, items: <items> }
      }
    }
	
    client.stats( 'items', function(err, stats) {
      if (!err) {
        console.log(stats);
        // { slabs: [ , { number: <items>, age: <age>, ... etc. } ] } 
        // Note that slabs is a one-based array.
      }
    }

    client.stats( 'slabs', function(err, stats) {
      if (!err) {
        console.log(stats);
        // { active_slabs: <num slabs>, total_malloced: <total mem>, slabs: [ , { chunk_size: <size>, ... } ] }
        // Note that here also, slabs is a one based array.
      }
    }

## Testing

Unit tests may be run by executing 'make test'. All methods have basic happy-case and error case coverage. Beyond
unit tests, an integration test package, which expects a memcache running locally on port 11211 can be run by the
command 'make integration'. These longer running tests exercise the full api in a real-world simulation including
network failure scenarios. There is an even longer running app: test/simulation/runlong.js which may be used when
testing more complicated network / server failure scenarios.

