var sinon = require('sinon')
  , should = require('should')
  , MemcacheClient = require('../../lib/memcache-client')
  , net = require('net');

var count = 1;

function readFromServer(iter, mc) {
  var delay = Math.floor(Math.random() * 3000);
  setTimeout(function () {
    mc.get('k' + iter, function (err, response) {
      if (err) {
        err.type.should.equal('CONNECTION_ERROR');
      }
      else {
        Number(response[0].val).should.equal(iter);
      }
      count++;
    });
  }, delay);
};

describe('MemcacheClient', function () {
  it("should handle a dropped collection without data corruption", function (done) {
    var mc = new MemcacheClient();
    mc.connect(function () {
      for (var i = 1; i <= 50000; i++) {
        mc.set('k' + i, i, function (err, response) {
          if (err) {
            err.type.should.equal('CONNECTION_ERROR');
          }
          else {
            response.should.equal('STORED');
          }
        });
        readFromServer(i, mc);
      }
    });
    setTimeout(function () {
      mc.sendServer('quit\r\n');
    }, 200);
    var t = setInterval(function () {
      if (count >= 50000) {
        clearInterval(t);
        mc.close();
        done();
      }
    }, 500);
  });
});