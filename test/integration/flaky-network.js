var sinon = require('sinon')
  , should = require('should')
  , mc = require('../../lib/memcache-client')
  , net = require('net');

var count = 1;

function readFromServer(iter, cli) {
  var delay = Math.floor(Math.random() * 3000);
  setTimeout(function () {
    cli.get('k' + iter, function (err, response) {
      if (err) {
	// Hack.
        if (err.type !== 'NOT_FOUND' && err.type !== 'CONNECTION_ERROR') {
          err.type.should.equal('CONNECTION_ERROR');
	}
      }
      else {
        Number(response.val).should.equal(iter);
      }
      count++;
    });
  }, delay);
}

describe('MemcacheClient', function () {
  it("should handle a dropped collection without data corruption", function (done) {
    var cli = new mc.Client();
    cli.connect(function () {
      for (var i = 1; i <= 50000; i++) {
        cli.set('k' + i, i, function (err, response) {
          if (err) {            
            err.type.should.equal('CONNECTION_ERROR');
          }
          else {
            response.should.equal('STORED');
          }
        });
        readFromServer(i, cli);
      }
    });
    setTimeout(function () {
      cli.sendServer('quit\r\n');
    }, 200);
    var t = setInterval(function () {
      if (count >= 50000) {
        clearInterval(t);
        cli.close();
        done();
      }
    }, 500);
  });
});
