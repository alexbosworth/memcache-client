
var sinon = require('sinon')
, should = require('should')
, MemcacheClient = require('../../lib/memcache-client')
, net = require('net')
, EventEmitter = require('events').EventEmitter;

describe('MemcacheClient', function() {

    var mc;
    var stub = sinon.stub(net, 'connect', function() {
	var sock = new net.Socket();
	var sockstub = sinon.stub(sock, 'addListener');
	return sock;
    });
    beforeEach(function() {
	mc = new MemcacheClient();
    });
    
    it("should exist after construction", function() {
	mc.should.exist;
    });

    it("should write command to server with crlf", function() {
	var mock = sinon.mock(mc.sock).expects('write').once().withArgs('ABCDEF\r\n');
	mc.sendServer('ABCDEF');
	mock.verify();
    });

});	
