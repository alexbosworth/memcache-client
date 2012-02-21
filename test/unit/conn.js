var sinon = require('sinon')
  , should = require('should')
  , Connection = require('../../lib/conn')
  , net = require('net');

describe('Connection', function () {
  
  it('should construct successfully with valid server settings.', function() {
    var conn = new Connection('fred:1000');
    conn.host.should.equal('fred');
    conn.port.should.equal('1000');
  });
  
  it('should use a default port if not provided', function() {
    var conn = new Connection('fred');
    conn.host.should.equal('fred');
    conn.port.should.equal('11211');
  });
  
  it ('should use default settings if none provided', function() {
    var conn = new Connection();
    conn.host.should.equal('localhost');
    conn.port.should.equal('11211');
  });
});
