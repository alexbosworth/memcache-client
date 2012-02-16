var sinon = require('sinon')
  , should = require('should')
  , mc = require('../../lib/memcache-client')
  , net = require('net');

describe('MemcacheClient', function () {

  var cli;

  beforeEach(function () {
    cli = new mc.Client();
    cli.sock = new net.Socket();
  });

  it("should exist after construction", function () {
    cli.should.exist;
  });

  it("should write command to server with crlf", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('ABCDEF\r\n');
    cli.sendServer('ABCDEF');
    mock.verify();
  });

  // Get
  it("should handle a correct get request in accordance with the memcache spec.", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('get test-get\r\n');
    var spy = sinon.spy();
    cli.get('test-get', spy);
    cli.buffer = new Buffer('VALUE test-get 0 4\r\nlala\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    should.exist(args[1]['test-get']);
    args[1]['test-get'].flags.should.equal('0');
    args[1]['test-get'].size.should.equal(4);
    args[1]['test-get'].val.should.equal('lala');
    mock.verify();
  });

  // Gets
  it("should handle a correct gets request in accordance with the memcache spec.", function () {
    var mock = sinon.mock(cli.sock);
    mock.expects('write').once().withArgs('gets test-get\r\n');
    var spy = sinon.spy();
    cli.gets('test-get', spy);
    cli.buffer = new Buffer('VALUE test-get 0 4 1000\r\nlala\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]['test-get']);
    args[1]['test-get'].flags.should.equal('0');
    args[1]['test-get'].size.should.equal(4);
    args[1]['test-get'].val.should.equal('lala');
    args[1]['test-get'].cas.should.equal('1000');
    mock.verify();
  });

  // Get Not Found
  it("should handle a get request that does not find a value correctly.", function() {
    var mock = sinon.mock(cli.sock);
    mock.expects('write').once().withArgs('gets test-get\r\n');
    var spy = sinon.spy();
    cli.gets('test-get', spy);
    cli.buffer = new Buffer('END\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Multi get
  it("should handle a multiget with mixed values correctly.", function() {
    var mock = sinon.mock(cli.sock);
    mock.expects('write').once().withArgs('get test1 test2 test3\r\n');
    var spy = sinon.spy();
    cli.get(['test1', 'test2', 'test3'], spy);
    cli.buffer = new Buffer('VALUE test1 0 4 1000\r\nlala\r\nVALUE test3 0 4 1000\r\noboe\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    should.exist(args[1]['test1']);
    should.exist(args[1]['test3']);
    should.not.exist(args[1]['test2']);
    args[1]['test1'].flags.should.equal('0');
    args[1]['test1'].size.should.equal(4);
    args[1]['test1'].val.should.equal('lala');
    args[1]['test3'].val.should.equal('oboe');
    mock.verify();
  });

  // Set
  it("should handle a correct set request in accordance with the memcache spec.", function () {
    var mock = sinon.mock(cli.sock);
    mock.expects('write').withArgs('set test-get 0 0 4\r\n');
    mock.expects('write').once().withArgs('lala\r\n');
    var spy = sinon.spy();
    cli.set('test-get', 'lala', spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Set with numeric key and value
  it("should correctly handle set requests with numeric keys and values", function () {
    var mock = sinon.mock(cli.sock);
    mock.expects('write').withArgs('set 43 0 0 2\r\n');
    mock.expects('write').withArgs('21\r\n');
    var spy = sinon.spy();
    cli.set(43, 21, spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Add missing
  it("should handle a correct add request without an existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('add test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.add('test-get', 'lala', spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Add, exists
  it("should handle a correct add request with an existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('add test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.add('test-get', 'lala', spy);
    cli.buffer = new Buffer('NOT_STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Replace, exists
  it("should handle a correct replace request with an existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('replace test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.replace('test-get', 'lala', spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Replace, Missing
  it("should handle a correct replace request with a non existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('replace test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.replace('test-get', 'lala', spy);
    cli.buffer = new Buffer('NOT_STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Append, exists
  it("should handle a correct append request with an existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('append test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.append('test-get', 'lala', spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Append, missing
  it("should handle a correct append request with a non existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('append test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.append('test-get', 'lala', spy);
    cli.buffer = new Buffer('NOT_STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Prepend, exists
  it("should handle a correct prepend request with an existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('prepend test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.prepend('test-get', 'lala', spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Prepend, missing
  it("should handle a correct prepend request with a non existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('prepend test-get 0 0 4', 'lala');
    var spy = sinon.spy();
    cli.prepend('test-get', 'lala', spy);
    cli.buffer = new Buffer('NOT_STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_STORED');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Increment, exists
  it("should handle a correct increment request with an existing numeric value.", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('incr test-num 1\r\n');
    var spy = sinon.spy();
    cli.incr('test-num', 1, spy);
    cli.buffer = new Buffer('3\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal(3);
    mock.verify();
  });

  // Increment, Missing
  it("should correctly report an error for an increment operation on a non-existent key", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('incr test-numb 3\r\n');
    var spy = sinon.spy();
    cli.incr('test-numb', 3, spy);
    cli.buffer = new Buffer('NOT_FOUND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    args[0].description.should.equal('');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Increment, non-numeric
  it("should correctly report an error for an increment operation on a non-numeric value.", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('incr test-get 4\r\n');
    var spy = sinon.spy();
    cli.incr('test-get', 4, spy);
    cli.buffer = new Buffer('CLIENT_ERROR cannot increment or decrement non-numeric value\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('CLIENT_ERROR');
    args[0].description.should.equal('cannot increment or decrement non-numeric value');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Decrement, exists
  it("should handle a correct decrement request with an existing numeric value", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('decr test-get 1\r\n');
    var spy = sinon.spy();
    cli.decr('test-get', 1, spy);
    cli.buffer = new Buffer('3\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal(3);
    mock.verify();
  });

  // Decrement, missing
  it("should correctly report an error for an decrement operation on a non-existing key.", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('decr test-get 1\r\n');
    var spy = sinon.spy();
    cli.decr('test-get', 1, spy);
    cli.buffer = new Buffer('NOT_FOUND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    args[0].description.should.equal('');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Decrement, non-numeric
  it("should correctly report an error for an decrement operation on a non-numeric value.", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('decr test-get 4\r\n');
    var spy = sinon.spy();
    cli.decr('test-get', 4, spy);
    cli.buffer = new Buffer('CLIENT_ERROR cannot increment or decrement non-numeric value\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('CLIENT_ERROR');
    args[0].description.should.equal('cannot increment or decrement non-numeric value');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Delete
  it("should correctly delete an existing key.", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('delete test-del\r\n');
    var spy = sinon.spy();
    cli.del('test-del', spy);
    cli.buffer = new Buffer('DELETED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('DELETED');
    mock.verify();
  });

  // Delete, missing
  it("should correctly report an error when deleting a non-existent key", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('delete test-del\r\n');
    var spy = sinon.spy();
    cli.del('test-del', spy);
    cli.buffer = new Buffer('NOT_FOUND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Version
  it("should correctly report the version of the server", function () {
    var mock = sinon.mock(cli.sock).expects('write').once().withArgs('version\r\n');
    var spy = sinon.spy();
    cli.version(spy);
    cli.buffer = new Buffer('VERSION 1.4.5\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('1.4.5');
    mock.verify();
  });

  // Cas - AOK
  it("should handle a correct cas request with an existing key as per memcache spec.", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('cas test-get 0 0 4 1000', 'lala');
    var spy = sinon.spy();
    cli.cas('test-get', 'lala', 1000, spy);
    cli.buffer = new Buffer('STORED\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].should.equal('STORED');
    mock.verify();
  });

  // Cas - Missing
  it("should correctly respond with an error to a cas request with a missing key", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('cas test-get 0 0 4 1000', 'lala');
    var spy = sinon.spy();
    cli.cas('test-get', 'lala', 1000, spy);
    cli.buffer = new Buffer('NOT_FOUND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('NOT_FOUND');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Cas - Invalid cas number
  it("should correctly respond with an error to a cas request with an invalid cas number", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('cas test-get 0 0 4 1000', 'lala');
    var spy = sinon.spy();
    cli.cas('test-get', 'lala', 1000, spy);
    cli.buffer = new Buffer('EXISTS\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.exist(args[0]);
    args[0].type.should.equal('EXISTS');
    should.not.exist(args[1]);
    mock.verify();
  });

  // Stats
  it("should correctly respond to a stats request", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('stats ');
    var spy = sinon.spy();
    cli.stats(spy);
    cli.buffer = new Buffer('STAT pid 1010\r\nSTAT uptime 12345\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].pid.should.equal('1010');
    args[1].uptime.should.equal('12345');
    mock.verify();
  });

  // Stats Items
  it("should correctly respond to a stats items request", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('stats items');
    var spy = sinon.spy();
    cli.stats('items', spy);
    cli.buffer = new Buffer('STAT items:1:number 2\r\nSTAT items:1:age 529885\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].slabs[1].number.should.equal('2');
    args[1].slabs[1].age.should.equal('529885');
    mock.verify();
  });

  // Stats Sizes
  it("should correctly respond to a stats sizes request", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('stats sizes');
    var spy = sinon.spy();
    cli.stats('sizes', spy);
    cli.buffer = new Buffer('STAT 101010 21\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].bytes.should.equal('101010');
    args[1].items.should.equal('21');
    mock.verify();
  });

  // Stats Slabs
  it("should correctly respond to a stats slabs request", function () {
    var mock = sinon.mock(cli).expects('sendServer').once().withArgs('stats slabs');
    var spy = sinon.spy();
    cli.stats('slabs', spy);
    cli.buffer = new Buffer('STAT 1:cas_hits 5\r\nSTAT 1:cas_badval 0\r\nSTAT active_slabs 1\r\nSTAT total_malloced 1048512\r\nEND\r\n');
    cli.processBuffer();
    spy.calledOnce.should.be.true;
    var args = spy.args[0];
    should.not.exist(args[0]);
    should.exist(args[1]);
    args[1].active_slabs.should.equal('1');
    args[1].total_malloced.should.equal('1048512');
    args[1].slabs[1].cas_badval.should.equal('0');
    args[1].slabs[1].cas_hits.should.equal('5');
    mock.verify();
  });

});
