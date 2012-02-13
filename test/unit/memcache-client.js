var sinon = require('sinon')
, should = require('should')
, MemcacheClient = require('../../lib/memcache-client')
, net = require('net');

describe('MemcacheClient', function () {

  var mc;
  var stub = sinon.stub(net, 'connect', function () {
    var sock = new net.Socket();
    var sockstub = sinon.stub(sock, 'addListener');
    return sock;
  });

  beforeEach(function () {
    mc = new MemcacheClient();
  });

  it("should exist after construction", function () {
    mc.should.exist;
  });

  it("should write command to server with crlf", function () {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('ABCDEF\r\n');
    mc.sendServer('ABCDEF');
    mock.verify();
  });
  
  // Get
  it("should handle a correct get request in accordance with the memcache spec.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('get test-get\r\n');
    var spy  = sinon.spy();
    mc.get('test-get', spy);
    mc.buffer = new Buffer('VALUE fred 0 4\r\nlala\r\nEND\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1][0].key.should.equal('fred');
    args[1][0].flags.should.equal('0');
    args[1][0].size.should.equal(4);
    args[1][0].val.should.equal('lala');
    mock.verify();
   });

  // Gets
  it("should handle a correct gets request in accordance with the memcache spec.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('gets test-get\r\n');
    var spy  = sinon.spy();
    mc.gets('test-get', spy);
    mc.buffer = new Buffer('VALUE fred 0 4 1000\r\nlala\r\nEND\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1][0].key.should.equal('fred');
    args[1][0].flags.should.equal('0');
    args[1][0].size.should.equal(4);
    args[1][0].val.should.equal('lala');
    args[1][0].cas.should.equal('1000');
    mock.verify();
  });

  // Set
  it("should handle a correct set request in accordance with the memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('set test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.set('test-get','lala',spy);
    mc.buffer = new Buffer('STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });
 
  // Add missing
  it("should handle a correct add request without an existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('add test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.add('test-get','lala',spy);
    mc.buffer = new Buffer('STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });
 
  // Add, exists
  it("should handle a correct add request with an existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('add test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.add('test-get','lala',spy);
    mc.buffer = new Buffer('NOT_STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Replace, exists
  it("should handle a correct replace request with an existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('replace test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.replace('test-get','lala',spy);
    mc.buffer = new Buffer('STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Replace, Missing
  it("should handle a correct replace request with a non existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('replace test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.replace('test-get','lala',spy);
    mc.buffer = new Buffer('NOT_STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Append, exists
  it("should handle a correct append request with an existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('append test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.append('test-get','lala',spy);
    mc.buffer = new Buffer('STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Append, missing
  it("should handle a correct append request with a non existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('append test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.append('test-get','lala',spy);
    mc.buffer = new Buffer('NOT_STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Prepend, exists
  it("should handle a correct prepend request with an existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('prepend test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.prepend('test-get','lala',spy);
    mc.buffer = new Buffer('STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Prepend, missing
  it("should handle a correct prepend request with a non existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('prepend test-get 0 0 4', 'lala');
    var spy  = sinon.spy();
    mc.prepend('test-get','lala',spy);
    mc.buffer = new Buffer('NOT_STORED\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Increment, exists
  it("should handle a correct increment request with an existing numeric value.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('incr test-num 1\r\n');
    var spy  = sinon.spy();
    mc.incr('test-num',1,spy);
    mc.buffer = new Buffer('3\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal(3);
    mock.verify();
  });

  // Increment, Missing
  it("should correctly report an error for an increment operation on a non-existent key", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('incr test-numb 3\r\n');
    var spy  = sinon.spy();
    mc.incr('test-numb',3,spy);
    mc.buffer = new Buffer('NOT_FOUND\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    args[0].description.should.equal('');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Increment, non-numeric
  it("should correctly report an error for an increment operation on a non-numeric value.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('incr test-get 4\r\n');
    var spy  = sinon.spy();
    mc.incr('test-get',4,spy);
    mc.buffer = new Buffer('CLIENT_ERROR cannot increment or decrement non-numeric value\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('CLIENT_ERROR');
    args[0].description.should.equal('cannot increment or decrement non-numeric value');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Decrement, exists
  it("should handle a correct decrement request with an existing numeric value", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('decr test-get 1\r\n');
    var spy  = sinon.spy();
    mc.decr('test-get',1,spy);
    mc.buffer = new Buffer('3\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal(3);
    mock.verify();
  });

  // Decrement, missing
  it("should correctly report an error for an decrement operation on a non-existing key.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('decr test-get 1\r\n');
    var spy  = sinon.spy();
    mc.decr('test-get',1,spy);
    mc.buffer = new Buffer('NOT_FOUND\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    args[0].description.should.equal('');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Decrement, non-numeric
  it("should correctly report an error for an decrement operation on a non-numeric value.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('decr test-get 4\r\n');
    var spy  = sinon.spy();
    mc.decr('test-get',4,spy);
    mc.buffer = new Buffer('CLIENT_ERROR cannot increment or decrement non-numeric value\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('CLIENT_ERROR');
    args[0].description.should.equal('cannot increment or decrement non-numeric value');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Delete
  it("should correctly delete an existing key.", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('delete test-del\r\n');
    var spy = sinon.spy();
    mc.del('test-del',spy);
    mc.buffer = new Buffer('DELETED\r\n');
    mc.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('DELETED');
    mock.verify();
  });

  // Delete, missing
  it("should correctly report an error when deleting a non-existent key", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('delete test-del\r\n');
    var spy  = sinon.spy();
    mc.del('test-del',spy);
    mc.buffer = new Buffer('NOT_FOUND\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    should.not.exist(args[1]);
    mock.verify();
  });
  
  // Version
  it("should correctly report the version of the server", function() {
    var mock = sinon.mock(mc.sock).expects('write').once().withArgs('version\r\n');
    var spy  = sinon.spy();
    mc.version(spy);
    mc.buffer = new Buffer('VERSION 1.4.5\r\n');
    mc.processBuffer();	
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('1.4.5');
    mock.verify();
  });

  // Cas - AOK
  it("should handle a correct cas request with an existing key as per memcache spec.", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('cas test-get 0 0 4 1000', 'lala');
    var spy  = sinon.spy();
    mc.cas('test-get','lala',1000,spy);
    mc.buffer = new Buffer('STORED\r\n');
    mc.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Cas - Missing
  it("should correctly respond with an error to a cas request with a missing key", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('cas test-get 0 0 4 1000', 'lala');
    var spy  = sinon.spy();
    mc.cas('test-get','lala',1000,spy);
    mc.buffer = new Buffer('NOT_FOUND\r\n');
    mc.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Cas - Invalid cas number
  it("should correctly respond with an error to a cas request with an invalid cas number", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('cas test-get 0 0 4 1000', 'lala');
    var spy  = sinon.spy();
    mc.cas('test-get','lala',1000,spy);
    mc.buffer = new Buffer('EXISTS\r\n');
    mc.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('EXISTS');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Stats
  it("should correctly respond to a stats request", function() {
    var mock = sinon.mock(mc).expects('sendServer').once().withArgs('stats');
    var spy  = sinon.spy();
    mc.stats(spy);
    mc.buffer = new Buffer('STAT pid 1010\r\nSTAT uptime 12345\r\nEND\r\n');
    mc.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].pid.should.equal('1010');
    args[1].uptime.should.equal('12345');
    mock.verify();
  });  


});
