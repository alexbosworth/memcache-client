# memcache-client

A correct, performant memcache client that emphasizes stability and simplicity over large-system features such as
sharding and consistent hashing. The expectation is that developers handling distributed data sets will prefer to
handle sharding or consistent hashing with their own logic -- or may have legacy distribution strategies in place
already. One additional feature of this client is the guarantee of handling binary memcache values correctly over
the simple ascii protocol. This client does not implement the new binary protocol.

Specifically, this client implements: https://github.com/memcached/memcached/blob/master/doc/protocol.txt

This library does draw inspiration from both 3rd-Eden, elbart, and ddopson: but it is a ground-up rewrite.

## Status

All critical aspects of the protocol are now implemented and tested, however the whole business has yet to pass a
serious test of scale, time, with anomalous conditions thrown in to ensure fault tolerance and resiliency to sys-
temic aberrations. A full test-suite to demonstrate correctness and probe edge cases is also pending. Use at your
own risk!

### TODO:

    ( ) stats (with arguments)
    ( ) validate flaky network

### Done:
    (x) full test coverage
    (x) mock server responses for client-server tests
    (x) more robust handling of server errors
    (x) validate binary
    (x) delete
    (x) increment
    (x) decrement
    (x) gets
    (x) cas
    (x) add
    (x) replace
    (x) append
    (x) prepend
    (x) add unit test story
    (x) settable global expiration default
    (x) get
    (x) set
    (x) stats (without arguments)
    (x) version
    (x) connection management

## Install

TBD

## Usage

### Connection

    var MemcacheClient = require('memcache-client');
    var mc = new MemcacheClient('localhost', 11211);

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

    mc.set( 'myKey', 'myVal', { flags: 0, exptime: 0}, function(err, status) {
      if (!err) { 
        console.log(status); // 'STORED' on success!
      }
    });

    mc.add( 'myKey', 'myVal', function(err, response) { // Flags parameter is optional.
      if (!err) { // Error types can be NOT_STORED
        console.log(status); // 'STORED' on success!
      }
    });

    mc.cas( 'myKey', 'myNewVal', casvalue, {flags: 0, exptime: 0}, function(err, status) {
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

    mc.incr( 'myKey', 2, function(err, value) {
      if (!err) {
        console.log(value); // Value returned on success
      }
    });
    mc.decr( 'myKey', function(err, value) { // No value parameter, defaults to 1.
      if (!err) {
        console.log(value);
      }
    ));

### Get/Gets

Get may take either a single key or an array of keys. The return result will alwyas be an array, although when no
results are delivered from the server, this array will be empty. On error, the array will be null. Returned items
have the following properties:

    {
      buffer: <the raw byte buffer, for binary values>
      value:  <the string representation of this buffer, for the common use case>
      size:   <the length of the string
      flags:  <any flags associated with the item>
      key:    <the key this value is associated with>
      cas:    <the check number; only returned by gets; used for check-and-set storage>
    }

A couple of samples.

    mc.get( 'myKey', function(err, vals) {
      if (!err) {
        console.log('Values: ' + vals.length);
        if (vals.length) {
          console.log(vals[0].value);
    } } }

    mc.gets( 'myKey', function(err, vals) {
      if (!err) {
        if (vals.length) {
          mc.cas( 'myKey', 'myNewVal', vals[0].cas, { flags: 0, exptime: 0 }, function (err, status) {
            if (!err) {
              console.log(status); // 'STORED' if the calue was not changed by another process.
    } } } } }

### Version

    mc.version( function(err, version) {
      if (!err) {
        console.log(version);
      }
    }

### Stats

    mc.stats( function(err, stats) {
      if (!err) {
        // E.g.: how many bytes are being stored?
        // Check your local memcache installation for all the options!
        console.log(stats.bytes);
      }
    }

## Testing

Unit tests may be run by executing 'make test'. Current status: incomplete.
